export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'done'; reason: 'stop' | 'tool_use' | 'length' }
  // `sent` is true once the prompt may have reached the provider: retrying
  // such a failure could post the same message twice.
  | { type: 'error'; message: string; code?: string; sent?: boolean };
