import { describe, it, expect } from 'vitest';
import { ProviderPool } from '../../../src/core/pool.js';
import type { StreamEvent } from '../../../src/core/stream.js';

const ok: StreamEvent[] = [
  { type: 'text_delta', delta: 'ok' },
  { type: 'done', reason: 'stop' },
];

// A fake account: records that it served, and answers with a scripted reply.
function fakeAccount(name: string, reply: () => StreamEvent[] = () => ok) {
  const runs: number[] = [];
  const provider = {
    info: { id: 'deepseek-web', name: 'DeepSeek' },
    isAuthenticated: async () => true,
    isLoggedInHere: async () => true,
    chat: async function* () {
      runs.push(Date.now());
      for (const e of reply()) yield e;
    },
  };
  return { name, provider: provider as any, runs };
}

const poolOf = (accounts: ReturnType<typeof fakeAccount>[]) =>
  new ProviderPool(accounts.map(a => ({ name: a.name, provider: a.provider })));

async function drain(pool: ProviderPool): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of pool.chat({ model: 'deepseek-v4', messages: [{ role: 'user', content: 'hi' }], stream: true })) {
    out.push(e);
  }
  return out;
}

describe('ProviderPool turn', () => {
  it('rotates one call per account in order', async () => {
    const order: string[] = [];
    const named = (name: string) => {
      const acc = fakeAccount(name);
      const chat = acc.provider.chat;
      acc.provider.chat = async function* (req: any) { order.push(name); yield* chat(req); };
      return acc;
    };
    const pool = poolOf([named('a'), named('b'), named('c')]);
    for (let i = 0; i < 3; i++) expect((await drain(pool)).at(-1)).toEqual({ type: 'done', reason: 'stop' });
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('serves two calls at once on two accounts, not one after the other', async () => {
    // Each account blocks until the test releases it: serial service would deadlock.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const [a, b] = [fakeAccount('a'), fakeAccount('b')];
    for (const acc of [a, b]) {
      acc.provider.chat = async function* () {
        acc.runs.push(Date.now());
        await gate;
        yield ok[0];
        yield ok[1];
      };
    }
    const pool = poolOf([a, b]);
    const both = Promise.all([drain(pool), drain(pool)]);
    // Both accounts must have entered before either finishes.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(a.runs.length + b.runs.length).toBe(2);
    release();
    expect((await both).map(r => r.at(-1))).toEqual([
      { type: 'done', reason: 'stop' },
      { type: 'done', reason: 'stop' },
    ]);
  });

  it('moves to the next account when one refuses', async () => {
    const a = fakeAccount('a', () => [{ type: 'error', message: 'closed', code: 'auth_expired' }]);
    const b = fakeAccount('b');
    const out = await drain(poolOf([a, b]));
    expect(b.runs.length).toBe(1);
    expect(out.at(-1)).toEqual({ type: 'done', reason: 'stop' });
  });

  // The challenge is the IP being flagged, not the account: another account can take the message.
  it('moves to the next account on challenge_required without benching the first', async () => {
    let first = true;
    const a = fakeAccount('a', () => (first ? (first = false, [{ type: 'error', message: 'captcha', code: 'challenge_required', possiblySent: true }]) : ok));
    const b = fakeAccount('b');
    const pool = poolOf([a, b]);
    expect((await drain(pool)).at(-1)).toEqual({ type: 'done', reason: 'stop' });
    expect(b.runs.length).toBe(1);
    // Next call: the flagged account is back in the turn, not benched for minutes.
    expect((await drain(pool)).at(-1)).toEqual({ type: 'done', reason: 'stop' });
    expect(a.runs.length).toBe(2);
  });

  it('surfaces the challenge when every account hits one', async () => {
    const capture = () => [{ type: 'error' as const, message: 'captcha', code: 'challenge_required', possiblySent: true }];
    const out = await drain(poolOf([fakeAccount('a', capture), fakeAccount('b', capture)]));
    expect(out).toEqual([{ type: 'error', message: 'captcha', code: 'challenge_required', possiblySent: true }]);
  });
});

describe('ProviderPool callbacks', () => {
  it('reports every attempted account as acquired and released, even across a refusal', async () => {
    const events: string[] = [];
    const a = fakeAccount('a', () => [{ type: 'error', message: 'closed', code: 'auth_expired' }]);
    const b = fakeAccount('b');
    const pool = new ProviderPool(
      [a, b].map(acc => ({ name: acc.name, provider: acc.provider })),
      undefined,
      undefined,
      {
        onAcquire: member => events.push(`acquire ${member.name}`),
        onRelease: member => events.push(`release ${member.name}`),
      },
    );

    await drain(pool);

    expect(events).toEqual(['acquire a', 'release a', 'acquire b', 'release b']);
  });

  it('releases the account when the request is aborted before it runs', async () => {
    const events: string[] = [];
    const a = fakeAccount('a');
    const pool = new ProviderPool(
      [{ name: a.name, provider: a.provider }],
      undefined,
      undefined,
      {
        onAcquire: member => events.push(`acquire ${member.name}`),
        onRelease: member => events.push(`release ${member.name}`),
      },
    );
    const abort = new AbortController();
    abort.abort();

    const out: StreamEvent[] = [];
    const req = {
      model: 'deepseek-v4',
      messages: [{ role: 'user' as const, content: 'hi' }],
      stream: true,
      signal: abort.signal,
    };
    for await (const event of pool.chat(req)) out.push(event);

    expect(out).toEqual([]);
    expect(a.runs).toHaveLength(0);
    expect(events).toEqual(['acquire a', 'release a']);
  });
});

describe('ProviderPool peek', () => {
  it('returns the account the next call would take without taking it', async () => {
    const pool = poolOf([fakeAccount('a'), fakeAccount('b')]);

    expect((await pool.peekNext())?.name).toBe('a');
    expect((await pool.peekNext())?.name).toBe('a');

    await drain(pool);
    expect((await pool.peekNext())?.name).toBe('b');
  });

  it('skips an account that cannot authenticate', async () => {
    const a = fakeAccount('a');
    a.provider.isAuthenticated = async () => false;
    const pool = poolOf([a, fakeAccount('b')]);

    expect((await pool.peekNext())?.name).toBe('b');
  });

  it('returns nothing while every account is busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const [a, b] = [fakeAccount('a'), fakeAccount('b')];
    for (const acc of [a, b]) {
      acc.provider.chat = async function* () {
        acc.runs.push(Date.now());
        await gate;
        yield ok[0];
        yield ok[1];
      };
    }
    const pool = poolOf([a, b]);
    const both = Promise.all([drain(pool), drain(pool)]);
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(await pool.peekNext()).toBeUndefined();

    release();
    await both;
  });
});