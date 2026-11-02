import { describe, it, expect, afterEach, vi } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { BaseProvider, type ChatRequest, type ModelInfo, type ProviderInfo } from '../../../src/core/provider.js';
import type { StreamEvent } from '../../../src/core/stream.js';
import { ProviderPool } from '../../../src/core/pool.js';
import { rateLimitCooldown } from '../../../src/routes/anthropic-compat.js';
import { DeepSeekProvider } from '../../../src/providers/deepseek/index.js';
import { AuthStore } from '../../../src/auth/store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One account: answers its own name unless a scripted reply is queued for the next call.
class Account extends BaseProvider {
  readonly info: ProviderInfo = {
    id: 'cap', name: 'Cap', website: 'https://x', loginUrl: 'https://x', needsBrowser: false,
  };
  calls = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** Each call waits on this before answering, so the test controls overlap. */
  hold: Promise<void> = Promise.resolve();
  authenticated = true;
  /** DeepSeek: `expired` still passes isAuthenticated() but reads logged out here. */
  loggedInHere = true;
  next: StreamEvent[][] = [];
  constructor(readonly name: string) { super(); }
  async login() {}
  async isAuthenticated() { return this.authenticated; }
  async isLoggedInHere() { return this.authenticated && this.loggedInHere; }
  async detectLoginComplete() { return true; }
  async models(): Promise<ModelInfo[]> { return [{ id: 'm', name: 'm', contextWindow: 1, maxOutput: 1 }]; }
  async *chat(_req: ChatRequest): AsyncIterable<StreamEvent> {
    this.calls++;
    this.maxInFlight = Math.max(this.maxInFlight, ++this.inFlight);
    try {
      await this.hold;
      yield* this.next.shift() ?? [{ type: 'text_delta', delta: this.name }, { type: 'done', reason: 'stop' }];
    } finally {
      this.inFlight--;
    }
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

  // 2026-10-31: DeepSeek dropped the active profile's session and its account marked itself
  // expired, but the row still read logged in, so the dashboard hid the Login button.
  it('an account that marks itself expired shows Login on the active profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wmb-auth-'));
    const main = new AuthStore(dir, () => '1a');
    main.setStatus('deepseek-web', 'active');
    const member = new AuthStore(dir, () => '1a');
    const pool = new ProviderPool([{ name: '1a', provider: new DeepSeekProvider(member) }], new DeepSeekProvider(main));
    ctx = createTestContext({ providers: [pool as any] });
    const row = async () => ((await (await ctx.app.request('/webmodel/providers')).json()) as any).providers[0].authenticated;

    expect(await row()).toBe(true);
    // What chat() writes when the page is on /sign_in.
    member.setStatus('deepseek-web', 'expired');
    expect(await row()).toBe(false);
  });

  it('calls alternate strictly between accounts', async () => {
    setup('A', 'B');
    const served = [];
    for (let i = 0; i < 4; i++) served.push((await ask()).text);
    expect(served).toEqual(['A', 'B', 'A', 'B']);
  });

  // 2026-11-02: one call in flight across every account made the turn as slow as one account.
  it('calls run at once, one per account; an extra call waits for a free account', async () => {
    const [a, b] = setup('A', 'B');
    let release!: () => void;
    a.hold = b.hold = new Promise(r => { release = r; });
    const calls = [ask(), ask(), ask()];
    await vi.waitFor(() => expect([a.calls, b.calls]).toEqual([1, 1]), { timeout: 500 });
    release();
    expect((await Promise.all(calls)).map(r => r.text).sort()).toEqual(['A', 'A', 'B']);
    expect([a.maxInFlight, b.maxInFlight]).toEqual([1, 1]);
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

  // 2026-11-02: bridge.log showed closed accounts probed again on every call, ~10 s each
  // (73 calls, most paying ~60 s for six dead accounts before a live one answered).
  it('an account whose session closed sits out; a dashboard login or the 5 min re-check brings it back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const [a] = setup('A', 'B');
      a.loggedInHere = false;
      a.next.push(loggedOut);
      expect((await ask()).text).toBe('B');
      expect((await ask()).text).toBe('B');
      expect(a.calls).toBe(1);
      // A re-login typed into its own window shows only when a call reaches the page.
      vi.setSystemTime(Date.now() + 5 * 60_000);
      expect((await ask()).text).toBe('A');
      expect((await ask()).text).toBe('B');
      a.next.push(loggedOut);
      expect((await ask()).text).toBe('B');
      a.loggedInHere = true;
      expect((await ask()).text).toBe('A');
    } finally {
      vi.useRealTimers();
    }
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
