import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseProvider, type ChatRequest, type ModelInfo, type ProviderInfo } from '../../../src/core/provider.js';
import type { StreamEvent } from '../../../src/core/stream.js';
import { ProviderPool } from '../../../src/core/pool.js';
import { createRefusalJournal } from '../../../src/core/refusal-journal.js';

class Account extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'cap', name: 'Cap', website: 'https://x', loginUrl: 'https://x', needsBrowser: false,
  };
  next: StreamEvent[][] = [];
  constructor(readonly name: string) { super(); }
  async login() {}
  async isAuthenticated() { return true; }
  async detectLoginComplete() { return true; }
  async models(): Promise<ModelInfo[]> { return [{ id: 'm', name: 'm', contextWindow: 1, maxOutput: 1 }]; }
  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    yield* this.next.shift() ?? [{ type: 'text_delta', delta: this.name }, { type: 'done', reason: 'stop' }];
  }
}

/** Runs a call through the pool and returns everything it emitted. */
async function ask(pool: ProviderPool): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of pool.chat({ model: 'm', messages: [], stream: true })) events.push(event);
  return events;
}

function records(file: string): any[] {
  return readFileSync(file, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
}

describe('refusal journal', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records a muted account with its profile, code, end date and time', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wmb-refusals-'));
    const file = join(dir, 'refusals.jsonl');
    const [a, b] = ['A', 'B'].map(name => new Account(name));
    const until = Date.now() + 60_000;
    a.next.push([{ type: 'error', message: 'muted', code: 'account_muted', until }]);
    const pool = new ProviderPool(
      [{ name: a.name, provider: a }, { name: b.name, provider: b }],
      undefined,
      createRefusalJournal(file),
    );

    expect(await ask(pool)).toContainEqual({ type: 'text_delta', delta: 'B' });
    expect(records(file)).toEqual([
      { at: expect.any(String), profile: 'A', code: 'account_muted', until },
    ]);
    expect(Number.isNaN(Date.parse(records(file)[0].at))).toBe(false);
  });

  it('records session expiry and rate limits too', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wmb-refusals-'));
    const file = join(dir, 'refusals.jsonl');
    const [a, b] = ['A', 'B'].map(name => new Account(name));
    a.next.push([{ type: 'error', message: 'session closed', code: 'auth_expired' }]);
    a.next.push([{ type: 'error', message: 'too frequent', code: 'upstream_rate_limit' }]);
    const pool = new ProviderPool(
      [{ name: a.name, provider: a }, { name: b.name, provider: b }],
      undefined,
      createRefusalJournal(file),
    );

    expect(await ask(pool)).toContainEqual({ type: 'text_delta', delta: 'B' });
    expect(await ask(pool)).toContainEqual({ type: 'text_delta', delta: 'B' });
    expect(records(file).map(record => [record.profile, record.code])).toEqual([
      ['A', 'auth_expired'],
      ['A', 'upstream_rate_limit'],
    ]);
    expect(records(file)[0].until).toBeUndefined();
  });

  it('a write failure leaves the request and the pool unchanged', async () => {
    dir = mkdtempSync(join(tmpdir(), 'wmb-refusals-'));
    const file = join(dir, 'not-a-file');
    mkdirSync(file);
    const [a, b] = ['A', 'B'].map(name => new Account(name));
    a.next.push([{ type: 'error', message: 'muted', code: 'account_muted', until: Date.now() + 60_000 }]);
    const pool = new ProviderPool(
      [{ name: a.name, provider: a }, { name: b.name, provider: b }],
      undefined,
      createRefusalJournal(file),
    );

    expect(await ask(pool)).toContainEqual({ type: 'text_delta', delta: 'B' });
    expect(await ask(pool)).toContainEqual({ type: 'text_delta', delta: 'B' });
  });
});
