import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { BaseProvider, type ChatRequest, type ModelInfo, type ProviderInfo } from '../../../src/core/provider.js';
import type { StreamEvent } from '../../../src/core/stream.js';
import { ProviderPool } from '../../../src/core/pool.js';
import { rateLimitCooldown } from '../../../src/routes/anthropic-compat.js';

// One account: answers its own name unless a scripted reply is queued for the next call.
class Account extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'cap', name: 'Cap', website: 'https://x', loginUrl: 'https://x', needsBrowser: false,
  };
  calls = 0;
  authenticated = true;
  next: StreamEvent[][] = [];
  constructor(readonly name: string) { super(); }
  async login() {}
  async isAuthenticated() { return this.authenticated; }
  async detectLoginComplete() { return true; }
  async models(): Promise<ModelInfo[]> { return [{ id: 'm', name: 'm', contextWindow: 1, maxOutput: 1 }]; }
  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    this.calls++;
    yield* this.next.shift() ?? [{ type: 'text_delta', delta: this.name }, { type: 'done', reason: 'stop' }];
  }
}

const muted = (until: number): StreamEvent[] =>
  [{ type: 'error', message: 'muted', code: 'account_muted', until, possiblySent: true }];
const tooFrequent: StreamEvent[] = [{ type: 'error', message: 'Messages too frequent.', code: 'upstream_rate_limit', possiblySent: true }];
const loggedOut: StreamEvent[] = [{ type: 'error', message: 'session closed', code: 'auth_expired' }];

describe('Anthropic route over DeepSeek accounts in turn', () => {
  let ctx: TestContext;
  const cooldown = { ...rateLimitCooldown };
  afterEach(() => { ctx?.cleanup(); Object.assign(rateLimitCooldown, cooldown); });

  function setup(...names: string[]) {
    const accounts = names.map(n => new Account(n));
    const pool = new ProviderPool(accounts.map(a => ({ name: a.name, provider: a })));
    ctx = createTestContext({ providers: [pool as any] });
    return accounts;
  }

  async function ask() {
    const res = await ctx.app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'cap/m', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    });
    const body = await res.json() as any;
    return { status: res.status, body, text: body.content?.find((b: any) => b.type === 'text')?.text };
  }

  // 2026-10-30: a fresh active profile showed DeepSeek logged in (any account in the turn
  // counted), so the dashboard hid its Login button and a new account could not be added.
  it('the dashboard shows the active profile\'s login; the turn still serves', async () => {
    const [a, b, here] = ['A', 'B', 'here'].map(n => new Account(n));
    here.authenticated = false;
    const pool = new ProviderPool([a, b].map(m => ({ name: m.name, provider: m })), here);
    ctx = createTestContext({ providers: [pool as any] });

    const { providers } = await (await ctx.app.request('/webmodel/providers')).json() as any;
    expect(providers.find((p: any) => p.id === 'cap').authenticated).toBe(false);
    const { status, text } = await ask();
    expect(status).toBe(200);
    expect(text).toBe('A');
  });

  it('calls alternate strictly between accounts', async () => {
    setup('A', 'B');
    const served = [];
    for (let i = 0; i < 4; i++) served.push((await ask()).text);
    expect(served).toEqual(['A', 'B', 'A', 'B']);
  });

  it('a muted account hands the same call to the next one and stays out until its end date', async () => {
    const [a, b] = setup('A', 'B');
    a.next.push(muted(Date.now() + 80));
    expect((await ask()).text).toBe('B');
    expect((await ask()).text).toBe('B');
    expect(a.calls).toBe(1);
    await new Promise(r => setTimeout(r, 100));
    expect((await ask()).text).toBe('A');
    expect(b.calls).toBe(2);
  });

  it('"too frequent" cools only that account; the others keep serving', async () => {
    const [a] = setup('A', 'B');
    a.next.push(tooFrequent);
    expect((await ask()).text).toBe('B');
    expect((await ask()).text).toBe('B');
    expect(a.calls).toBe(1);
  });

  it('a logged-out account is skipped until it logs in again', async () => {
    const [a] = setup('A', 'B');
    a.authenticated = false;
    expect((await ask()).text).toBe('B');
    expect((await ask()).text).toBe('B');
    a.authenticated = true;
    expect((await ask()).text).toBe('A');
    expect(a.calls).toBe(1);
  });

  it('never re-sends to another account once the first one produced content', async () => {
    const [a, b] = setup('A', 'B');
    a.next.push([{ type: 'text_delta', delta: 'partial' }, ...tooFrequent]);
    const { status, text } = await ask();
    expect(status).toBe(200);
    expect(text).toContain('partial');
    expect(b.calls).toBe(0);
  });

  it('an error that is not a refusal goes to the client as is', async () => {
    const [a, b] = setup('A', 'B');
    a.next.push([{ type: 'error', message: 'Blocked by policy.', code: 'content_filter', possiblySent: true }]);
    expect((await ask()).status).toBe(502);
    expect(b.calls).toBe(0);
  });

  it('every account cooling: 429, like a single account today', async () => {
    Object.assign(rateLimitCooldown, { firstWaitMs: 10, maxWaitMs: 25 });
    const [a, b] = setup('A', 'B');
    a.next.push(tooFrequent);
    b.next.push(tooFrequent);
    const { status, body } = await ask();
    expect(status).toBe(429);
    expect(body).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } });
    expect([a.calls, b.calls]).toEqual([1, 1]);
  });

  it('none cooling but one logged out: 401 asks for a login', async () => {
    const [a, b] = setup('A', 'B');
    a.next.push(loggedOut);
    b.next.push(muted(Date.now() + 60_000));
    const { status, body } = await ask();
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'auth_expired' } });
  });

  it('every account muted: 403 with the first end date', async () => {
    const [a, b] = setup('A', 'B');
    // Whole seconds an hour ahead: a fixed date went stale once it passed (written 2026-10-27).
    const soon = Math.ceil(Date.now() / 1000) * 1000 + 3_600_000;
    a.next.push(muted(soon + 60_000));
    b.next.push(muted(soon));
    const { status, body } = await ask();
    expect(status).toBe(403);
    expect(body.error.message).toContain(new Date(soon).toISOString());
  });
});
