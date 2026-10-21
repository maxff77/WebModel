import type { StreamEvent } from '../../core/stream.js';

/**
 * Read SSE lines from a Response body and normalize them to StreamEvents.
 * Shared by all providers to eliminate code duplication.
 */
export async function* readSSE(
  response: Response,
  normalize: (line: string) => StreamEvent[],
): AsyncIterable<StreamEvent> {
  if (!response.body) {
    // Reaching here means the prompt POST already happened.
    yield { type: 'error', message: 'No response body', possiblySent: true };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const events = normalize(trimmed);
      for (const event of events) {
        yield event;
      }
    }
  }

  if (buffer.trim()) {
    const events = normalize(buffer.trim());
    for (const event of events) {
      yield event;
    }
  }
}

/**
 * POST the prompt and stream the reply. The request may have reached the
 * provider once it is attempted, so failures from here are never retried.
 */
export async function* postAndRead(
  send: () => Promise<Response>,
  normalize: (line: string) => StreamEvent[],
): AsyncIterable<StreamEvent> {
  try {
    yield* readSSE(await send(), normalize);
  } catch (err) {
    yield { type: 'error', message: (err as Error).message, possiblySent: true };
  }
}
