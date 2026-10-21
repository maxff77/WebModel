import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { BrowserManager, type ActiveProfile } from '../../../src/browser/manager.js';
import { DeepSeekProvider } from '../../../src/providers/deepseek/index.js';
import { DEEPSEEK_DEVICE_ID_KEY } from '../../../src/providers/deepseek/client.js';

// Captured session-create shape (see deepseek-chat.test.ts).
const createReply = {
  code: 0, msg: '',
  data: { biz_code: 0, biz_msg: '', biz_data: { chat_session: { id: 'session-1' }, ttl_seconds: 1800 } },
};
const powReply = { challenge: { algorithm: 'sha256', challenge: 'c', difficulty: 4, salt: 's', signature: 'sig' } };
const sse = 'data: {"p":"response/content","v":"hi"}\n\ndata: {"p":"response/status","v":"FINISHED"}\n\n';

interface FakePage {
  isClosed: () => boolean;
  goto: ReturnType<typeof vi.fn>;
  evaluate: (fn: unknown, arg?: unknown) => Promise<unknown>;
  on: (event: string, cb: () => void) => void;
  emit: (event: 'crash') => void;
}

function fakePage(evaluate: FakePage['evaluate']): FakePage {
  const handlers = new Map<string, () => void>();
  return {
    isClosed: () => false,
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    on: (event, cb) => { handlers.set(event, cb); },
    emit: (event) => handlers.get(event)?.(),
  };
}

function fakeContext(page: FakePage) {
  return { close: vi.fn().mockResolvedValue(undefined), newPage: vi.fn().mockResolvedValue(page) };
}

describe('Anthropic route fallback across a dead page', () => {
  let ctx: TestContext;
  let manager: BrowserManager;

  afterEach(async () => {
    await manager?.shutdown();
    ctx?.cleanup();
  });

  it('retries once on the fallback profile when the page dies before the prompt is sent', async () => {
    const work: ActiveProfile = {
      name: 'work', engine: 'chrome', dir: '/tmp/p/work/data', fallbackProfile: 'personal',
    };
    const personal: ActiveProfile = {
      name: 'personal', engine: 'camoufox', dir: '/tmp/p/personal/data',
    };

    // The work page crashes on the session-create call, before any prompt POST.
    const crashedPage = fakePage(async (_fn, arg) => {
      if (arg === DEEPSEEK_DEVICE_ID_KEY) return 'device-work';
      crashedPage.emit('crash');
      throw new Error('Target crashed');
    });
    // The fallback page answers the whole DeepSeek flow.
    let reply = 0;
    const replies = [{ data: createReply }, powReply, { data: sse }];
    const fallbackPage = fakePage(async (_fn, arg) =>
      arg === DEEPSEEK_DEVICE_ID_KEY ? 'device-personal' : replies[reply++]);

    const camoufoxLaunch = vi.fn().mockResolvedValue(fakeContext(fallbackPage));
    manager = new BrowserManager({
      profile: work,
      startupTimeout: 5000,
      idleShutdown: 0,
      loginTimeout: 5,
      mode: 'launch',
      launchers: {
        chrome: vi.fn().mockResolvedValue(fakeContext(crashedPage)),
        camoufox: camoufoxLaunch,
      },
      resolveProfile: (name) => (name === 'personal' ? personal : undefined),
      hasSession: () => true,
    });

    const provider = new DeepSeekProvider({} as any, undefined, (origin) => manager.getPageForOrigin(origin));
    provider.setBearerToken('test');
    provider.isAuthenticated = async () => true;

    ctx = createTestContext({ providers: [provider as any] });
    const res = await ctx.app.request('/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-web/deepseek-v4', max_tokens: 64, stream: false,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).content[0].text).toBe('hi');
    expect(camoufoxLaunch).toHaveBeenCalledOnce();
    expect(manager.getProfile().name).toBe('personal');
  });
});
