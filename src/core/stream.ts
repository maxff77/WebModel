export type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_call'; id: string; name: string; args: string }
  | { type: 'done'; reason: 'stop' | 'tool_use' | 'length' }
  // Set from the moment the prompt is posted: it may not have reached the
  // provider, but retrying could post the same message twice. Absent = not sent.
  // `until`: epoch ms when a sanction such as account_muted ends.
  | { type: 'error'; message: string; code?: string; possiblySent?: boolean; until?: number };
