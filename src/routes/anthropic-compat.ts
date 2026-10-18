import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { ProviderRegistry } from '../core/registry.js';
import {
  formatAnthropicNonStream,
  formatMessageStart,
  formatContentBlockStart,
  formatContentBlockDelta,
  formatContentBlockStop,
  formatInputJsonDelta,
  formatMessageDelta,
  formatMessageStop,
  formatPing,
  streamEventToStopReason,
  type AnthropicContentBlock,
} from '../core/anthropic-formatter.js';
import { parseToolCalls, renderToolCalls } from '../core/tool-protocol.js';
import { ProviderQueue } from '../core/queue.js';
import { AuthRequiredError, InvalidBodyError, errorToHttpResponse } from '../core/errors.js';
import type { Message, ToolDef } from '../core/provider.js';

export function anthropicRoutes(registry: ProviderRegistry): Hono {
  const app = new Hono();
  const queue = new ProviderQueue();

  app.post('/v1/messages', async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      const res = errorToHttpResponse(new InvalidBodyError('invalid JSON'));
      return c.json(res.body, res.status as any);
    }

    if (!body.model || typeof body.model !== 'string') {
      const res = errorToHttpResponse(new InvalidBodyError('missing model field'));
      return c.json(res.body, res.status as any);
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      const res = errorToHttpResponse(new InvalidBodyError('missing messages field'));
      return c.json(res.body, res.status as any);
    }

    // Resolve provider from model ID
    let resolved;
    try {
      resolved = await registry.resolve(body.model);
    } catch (err) {
      const res = errorToHttpResponse(err as Error);
      return c.json(res.body, res.status as any);
    }

    const { provider, model } = resolved;

    if (!(await provider.isAuthenticated())) {
      const res = errorToHttpResponse(new AuthRequiredError(provider.info.id));
      return c.json(res.body, res.status as any);
    }

    // Convert Anthropic messages to internal format
    const messages: Message[] = [];
    const systemText = typeof body.system === 'string'
      ? body.system
      : Array.isArray(body.system) ? body.system.map(blockToText).join('\n\n') : '';
    if (systemText) messages.push({ role: 'system', content: systemText });
    for (const msg of body.messages) {
      messages.push({ role: msg.role, content: messageToText(msg.content) });
    }
    // Always set (maybe empty) so providers build the full agent transcript.
    const tools: ToolDef[] = (Array.isArray(body.tools) ? body.tools : [])
      .filter((t: any) => t?.name)
      .map((t: any) => ({
        type: 'function',
        function: { name: t.name, description: t.description ?? '', parameters: t.input_schema ?? {} },
      }));

    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    async function attempt() {
      let text = '';
      let thinking = '';
      let error: string | null = null;
      let code: string | undefined;
      let stopReason = 'end_turn';
      try {
        for await (const event of provider.chat({ model, messages, tools, stream: body.stream === true })) {
          if (event.type === 'text_delta') text += event.delta;
          else if (event.type === 'thinking_delta') thinking += event.delta;
          else if (event.type === 'error') { error = event.message; code = event.code; }
          else if (event.type === 'done') stopReason = streamEventToStopReason(event) ?? 'end_turn';
        }
      } catch (err) {
        error = (err as Error).message;
      }
      return { text, thinking, error, code, stopReason };
    }

    // Web providers drive one shared browser tab, so requests run one at a time;
    // a single retry absorbs transient tab errors (e.g. a navigation mid-request).
    // Retrying a rate limit at once only extends it; Claude Code backs off on 429.
    const run = () => queue.enqueue(provider.info.id, attempt);
    const failed = (r: Awaited<ReturnType<typeof attempt>>) => r.error && !r.text && !r.thinking;
    let reply = await run();
    if (failed(reply) && reply.code !== 'upstream_rate_limit') reply = await run();

    // Nothing usable: answer like the real API does, so Claude Code retries
    // instead of treating the error as the assistant's message.
    if (failed(reply)) {
      const limited = reply.code === 'upstream_rate_limit';
      return c.json(
        { type: 'error', error: { type: limited ? 'rate_limit_error' : 'api_error', message: reply.error } },
        (limited ? 429 : 502) as any,
      );
    }

    const parsed = parseToolCalls(reply.text);
    const prose = reply.thinking + parsed.text + (reply.error ? `\n\nError: ${reply.error}` : '');
    const blocks: AnthropicContentBlock[] = [
      ...(prose ? [{ type: 'text' as const, text: prose }] : []),
      ...parsed.calls.map(call => ({
        type: 'tool_use' as const,
        id: `toolu_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        name: call.name,
        input: call.input,
      })),
    ];
    if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
    const stopReason = parsed.truncated ? 'max_tokens' : parsed.calls.length ? 'tool_use' : reply.stopReason;

    // chisle: the whole reply is buffered so tool-call blocks can be parsed out
    // before emitting; incremental DSML detection only if streaming latency matters.
    if (body.stream === true) {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return stream(c, async (s) => {
        await s.write(formatMessageStart(msgId, body.model));
        await s.write(formatPing());
        for (const [i, block] of blocks.entries()) {
          if (block.type === 'text') {
            await s.write(formatContentBlockStart(i));
            await s.write(formatContentBlockDelta(i, block.text));
          } else {
            await s.write(formatContentBlockStart(i, { ...block, input: {} }));
            await s.write(formatInputJsonDelta(i, JSON.stringify(block.input)));
          }
          await s.write(formatContentBlockStop(i));
        }
        await s.write(formatMessageDelta(stopReason));
        await s.write(formatMessageStop());
      });
    }

    return c.json(formatAnthropicNonStream(msgId, body.model, blocks, stopReason));
  });

  return app;
}

/** Flatten one Anthropic content block into transcript text (tool round trips included). */
function blockToText(block: any): string {
  if (typeof block === 'string') return block;
  if (block?.type === 'text') return block.text ?? '';
  if (block?.type === 'tool_result') {
    const content = typeof block.content === 'string'
      ? block.content
      : Array.isArray(block.content) ? block.content.map(blockToText).join('\n') : '';
    const err = block.is_error ? ' is_error="true"' : '';
    return `<tool_result tool_use_id="${block.tool_use_id}"${err}>\n${content}\n</tool_result>`;
  }
  if (block?.type === 'image' || block?.type === 'document') return `[${block.type} omitted]`;
  return ''; // thinking, redacted_thinking, etc.
}

function messageToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const calls = content
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({ name: b.name, input: b.input ?? {} }));
  const text = content.map(blockToText).filter(Boolean).join('\n\n');
  return calls.length ? [text, renderToolCalls(calls)].filter(Boolean).join('\n\n') : text;
}
