import { describe, it, expect } from 'vitest';
import { DeepSeekProvider } from '../../../src/providers/deepseek/index.js';
import type { StreamEvent } from '../../../src/core/stream.js';

// Fake tab: answers the provider's three in-page fetches in order
// (session create, PoW challenge, completion SSE).
function providerReplying(sse: string) {
  const replies = [
    { sessionId: 'session-1' },
    { challenge: { algorithm: 'sha256', challenge: 'c', difficulty: 4, salt: 's', signature: 'sig' } },
    { data: sse },
  ];
  const page = { evaluate: async () => replies.shift() };
  const provider = new DeepSeekProvider({} as any, undefined, async () => page as any);
  provider.setBearerToken('test');
  return provider;
}

async function events(provider: DeepSeekProvider): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of provider.chat({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }], stream: true })) out.push(e);
  return out;
}

describe('DeepSeekProvider.chat SSE handling', () => {
  it('reports the rate-limit hint as an upstream_rate_limit error instead of an empty reply', async () => {
    // Captured verbatim from chat.deepseek.com when requests come too fast.
    const sse = 'event: ready\ndata: {"request_message_id":1,"response_message_id":2,"model_type":"default"}\n\n'
      + 'event: hint\ndata: {"type":"error","content":"Messages too frequent. Try again later.","clear_response":true,"finish_reason":"rate_limit_reached"}\n\n'
      + 'event: close\ndata: {"click_behavior":"retry","auto_resume":false}\n\n';
    expect(await events(providerReplying(sse))).toEqual([
      { type: 'error', message: 'DeepSeek: Messages too frequent. Try again later.', code: 'upstream_rate_limit' },
    ]);
  });

  it('still streams normal content', async () => {
    const sse = 'data: {"v":{"response":{"fragments":[{"content":"Hola"}]}}}\n\n'
      + 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" mundo"}\n\n'
      + 'data: {"p":"response/status","v":"FINISHED"}\n\n';
    expect(await events(providerReplying(sse))).toEqual([
      { type: 'text_delta', delta: 'Hola' },
      { type: 'text_delta', delta: ' mundo' },
      { type: 'done', reason: 'stop' },
    ]);
  });

  it('streams THINK fragments as thinking and keeps the RESPONSE fragment appended later', async () => {
    // Shape captured from chat.deepseek.com with thinking_enabled: the snapshot opens a THINK
    // fragment, its APPENDs follow, then the answer arrives as a new RESPONSE fragment.
    const sse = 'data: {"v":{"response":{"thinking_enabled":true,"fragments":[{"id":2,"type":"THINK","content":"We","references":[]}]}}}\n\n'
      + 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":" need"}\n\n'
      + 'data: {"v":" 391."}\n\n'
      + 'data: {"p":"response/fragments/-1/elapsed_secs","o":"SET","v":0.76}\n\n'
      + 'data: {"p":"response/fragments","o":"APPEND","v":[{"id":3,"type":"RESPONSE","content":"39","references":[],"stage_id":1}]}\n\n'
      + 'data: {"p":"response/fragments/-1/content","o":"APPEND","v":"1"}\n\n'
      + 'data: {"p":"response/status","o":"SET","v":"FINISHED"}\n\n';
    expect(await events(providerReplying(sse))).toEqual([
      { type: 'thinking_delta', delta: 'We' },
      { type: 'thinking_delta', delta: ' need' },
      { type: 'thinking_delta', delta: ' 391.' },
      { type: 'text_delta', delta: '39' },
      { type: 'text_delta', delta: '1' },
      { type: 'done', reason: 'stop' },
    ]);
  });
});
