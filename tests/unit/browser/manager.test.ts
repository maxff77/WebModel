import { describe, it, expect, vi } from 'vitest';
import type { Browser, BrowserContext } from 'playwright-core';
import {
  BrowserManager,
  type ActiveProfile,
  type BrowserManagerOptions,
} from '../../../src/browser/manager.js';

const defaultProfile: ActiveProfile = {
  name: 'default',
  engine: 'chrome',
  dir: '/tmp/webmodel-profile/data',
};

function makeManager(
  launchers: BrowserManagerOptions['launchers'],
  overrides: Partial<BrowserManagerOptions> = {},
) {
  return new BrowserManager({
    profile: defaultProfile,
    startupTimeout: 5000,
    idleShutdown: 0,
    loginTimeout: 5,
    mode: 'launch',
    launchers,
    ...overrides,
  });
}

function fakeContext(page?: ReturnType<typeof fakePage>) {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  } as unknown as BrowserContext & {
    close: ReturnType<typeof vi.fn>;
    newPage: ReturnType<typeof vi.fn>;
  };
}

/** Page double that records the events the manager subscribes to. */
function fakePage() {
  const handlers = new Map<string, () => void>();
  return {
    isClosed: vi.fn(() => false),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, cb: () => void) => { handlers.set(event, cb); }),
    emit: (event: 'close' | 'crash') => handlers.get(event)?.(),
  };
}

describe('BrowserManager profiles', () => {
  it('launches the active profile with its engine, launcher and data directory', async () => {
    const context = {} as BrowserContext;
    const launch = vi.fn().mockResolvedValue(context);

    const manager = makeManager({ chrome: launch });

    await expect(manager.ensureBrowser()).resolves.toBe(context);
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/webmodel-profile/data', headless: true }),
    );
    expect(manager.getProfile().name).toBe('default');
    expect(manager.getEngine()).toBe('chrome');
  });

  it('launch mode runs headed when headless is off, so the user can watch the page', async () => {
    const launch = vi.fn().mockResolvedValue({} as BrowserContext);
    await makeManager({ chrome: launch }, { headless: false }).ensureBrowser();
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
  });

  it('uses the launcher of the profile engine', async () => {
    const chromeLaunch = vi.fn();
    const camoufoxLaunch = vi.fn().mockResolvedValue({} as BrowserContext);

    const manager = makeManager(
      { chrome: chromeLaunch, camoufox: camoufoxLaunch },
      { profile: { name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' } },
    );

    await manager.ensureBrowser();
    expect(camoufoxLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/p/ff/data' }),
    );
    expect(chromeLaunch).not.toHaveBeenCalled();
  });

  it('passes the persisted fingerprint to the camoufox launcher', async () => {
    const launch = vi.fn().mockResolvedValue({} as BrowserContext);
    const fingerprint = { navigator: { userAgent: 'firefox' } };
    const manager = makeManager(
      { camoufox: launch },
      { profile: { name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data', fingerprint } },
    );

    await manager.ensureBrowser();

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ fingerprint }));
  });

  it('uses a fingerprint regenerated on disk on the next launch', async () => {
    const profile = { name: 'ff', engine: 'camoufox' as const, dir: '/tmp/p/ff/data' };
    let persisted = { ...profile, fingerprint: { seed: 1 } };
    const launch = vi.fn().mockResolvedValue(fakeContext());
    const manager = makeManager({ camoufox: launch }, { profile, resolveProfile: () => persisted });

    await manager.ensureBrowser();
    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ fingerprint: { seed: 1 } }));

    persisted = { ...profile, fingerprint: { seed: 2 } };
    await manager.shutdown();
    await manager.ensureBrowser();

    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ fingerprint: { seed: 2 } }));
  });

  it('keeps the cached profile when it cannot be re-read at launch', async () => {
    const launch = vi.fn().mockResolvedValue(fakeContext());
    const manager = makeManager(
      { camoufox: launch },
      {
        profile: { name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data', fingerprint: { seed: 1 } },
        resolveProfile: () => {
          throw new Error('broken manifest');
        },
      },
    );

    await manager.ensureBrowser();

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: { seed: 1 } }));
    expect(manager.getProfile().name).toBe('ff');
  });

  it('closes the previous context when switching profiles in launch mode', async () => {
    const chromeContext = fakeContext();
    const camoufoxContext = {} as BrowserContext;
    const camoufoxLaunch = vi.fn().mockResolvedValue(camoufoxContext);
    const manager = makeManager({
      chrome: vi.fn().mockResolvedValue(chromeContext),
      camoufox: camoufoxLaunch,
    });

    await manager.ensureBrowser();
    await manager.activate({ name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' });

    expect(chromeContext.close).toHaveBeenCalled();
    expect(manager.getProfile().name).toBe('ff');
    expect(manager.getEngine()).toBe('camoufox');
    await expect(manager.ensureBrowser()).resolves.toBe(camoufoxContext);
  });

  it('propagates a launcher failure', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('browser failed to start'));

    const manager = makeManager({ chrome: launch });

    await expect(manager.ensureBrowser()).rejects.toThrow('browser failed to start');
  });

  it('launches camoufox when attach mode is requested', async () => {
    const context = {} as BrowserContext;
    const launch = vi.fn().mockResolvedValue(context);
    const manager = makeManager(
      { camoufox: launch },
      { profile: { name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' }, mode: 'attach' },
    );

    expect(manager.getMode()).toBe('launch');
    await expect(manager.ensureBrowser()).resolves.toBe(context);
    expect(launch).toHaveBeenCalledOnce();
  });

  it('recomputes the mode when a profile is activated', async () => {
    const userContext = fakeContext();
    const browser = {
      contexts: () => [userContext],
      newContext: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const connect = vi.fn().mockResolvedValue(browser as unknown as Browser);
    const manager = makeManager({}, { mode: 'attach', connect });

    await manager.ensureBrowser();
    await manager.activate({ name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' });
    expect(manager.getMode()).toBe('launch');

    await manager.activate(defaultProfile);
    expect(manager.getMode()).toBe('attach');
  });

  it('opens the login window with the active profile', async () => {
    let onPageClose: (() => void) | undefined;
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') onPageClose = cb;
      }),
    };
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    const launch = vi.fn().mockResolvedValue(context);

    const manager = makeManager({ chrome: launch });
    const onComplete = vi.fn();

    await manager.startLogin('deepseek-web', 'https://chat.deepseek.com', onComplete);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/webmodel-profile/data', headless: false }),
    );
    expect(page.goto).toHaveBeenCalledWith('https://chat.deepseek.com', expect.anything());

    onPageClose?.();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(true, 'default'));
    expect(context.close).toHaveBeenCalled();
  });

  it('opens the camoufox login window with the camoufox profile', async () => {
    let onPageClose: (() => void) | undefined;
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') onPageClose = cb;
      }),
    };
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    const launch = vi.fn().mockResolvedValue(context);

    const manager = makeManager(
      { camoufox: launch },
      { profile: { name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' } },
    );
    const onComplete = vi.fn();

    await manager.startLogin('deepseek-web', 'https://chat.deepseek.com', onComplete);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/p/ff/data', headless: false }),
    );

    onPageClose?.();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(true, 'ff'));
  });
});

describe('BrowserManager profile fallback', () => {
  const work: ActiveProfile = {
    name: 'work',
    engine: 'chrome',
    dir: '/tmp/p/work/data',
    fallbackProfile: 'personal',
  };
  const personal: ActiveProfile = {
    name: 'personal',
    engine: 'camoufox',
    dir: '/tmp/p/personal/data',
  };

  it('serves the request with the fallback profile when the active one fails to start', async () => {
    const fallbackContext = fakeContext();
    const chromeLaunch = vi.fn().mockRejectedValue(new Error('browser failed to start'));
    const camoufoxLaunch = vi.fn().mockResolvedValue(fallbackContext);
    const manager = makeManager(
      { chrome: chromeLaunch, camoufox: camoufoxLaunch },
      {
        profile: work,
        resolveProfile: (name) => (name === 'personal' ? personal : undefined),
        hasSession: () => true,
      },
    );

    await expect(manager.ensureBrowser()).resolves.toBe(fallbackContext);

    expect(manager.getProfile().name).toBe('personal');
    expect(manager.getEngine()).toBe('camoufox');
    expect(camoufoxLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/p/personal/data' }),
    );

    // The failover launched a browser, so it must be owned and closed, not
    // treated as an attach connection to the user's Chrome.
    expect(manager.getMode()).toBe('launch');
    await manager.shutdown();
    expect(fallbackContext.close).toHaveBeenCalled();
  });

  it('names the fallback profile and asks for login when it has no session', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('browser failed to start'));
    const manager = makeManager(
      { chrome: launch },
      { profile: work, resolveProfile: () => personal, hasSession: () => false },
    );

    await expect(manager.ensureBrowser()).rejects.toThrow(/profile "personal".*login/i);
    expect(manager.getProfile().name).toBe('work');
  });

  it('retries the fallback only once', async () => {
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error('work failed'))
      .mockRejectedValueOnce(new Error('personal failed'));
    const manager = makeManager(
      { chrome: launch, camoufox: launch },
      { profile: work, resolveProfile: () => personal, hasSession: () => true },
    );

    await expect(manager.ensureBrowser()).rejects.toThrow('personal failed');
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'crash'] as const)(
    'a page that %ss marks the profile down and the next acquisition uses the fallback',
    async (event) => {
      const dead = fakePage();
      const live = fakePage();
      const workContext = fakeContext(dead);
      const personalContext = fakeContext(live);
      const camoufoxLaunch = vi.fn().mockResolvedValue(personalContext);
      const manager = makeManager(
        { chrome: vi.fn().mockResolvedValue(workContext), camoufox: camoufoxLaunch },
        { profile: work, resolveProfile: () => personal, hasSession: () => true },
      );

      await expect(manager.getPageForOrigin('https://chat.deepseek.com')).resolves.toBe(dead);
      dead.emit(event);
      expect(manager.getStatus()).toBe('stopped');

      await expect(manager.getPageForOrigin('https://chat.deepseek.com')).resolves.toBe(live);
      expect(manager.getProfile().name).toBe('personal');
      expect(camoufoxLaunch).toHaveBeenCalledWith(
        expect.objectContaining({ profileDir: '/tmp/p/personal/data' }),
      );
      expect(workContext.close).toHaveBeenCalled();
    },
  );

  it('ignores a late close from a page of the previous context after failover', async () => {
    const dead = fakePage();
    const live = fakePage();
    const camoufoxLaunch = vi.fn().mockResolvedValue(fakeContext(live));
    const manager = makeManager(
      { chrome: vi.fn().mockResolvedValue(fakeContext(dead)), camoufox: camoufoxLaunch },
      { profile: work, resolveProfile: () => personal, hasSession: () => true },
    );

    await manager.getPageForOrigin('https://chat.deepseek.com');
    dead.emit('close');
    await expect(manager.getPageForOrigin('https://chat.deepseek.com')).resolves.toBe(live);
    expect(manager.getStatus()).toBe('running');

    // Playwright can deliver the old page's close after the next context is up.
    dead.emit('close');
    expect(manager.getStatus()).toBe('running');
    await expect(manager.getPageForOrigin('https://chat.deepseek.com')).resolves.toBe(live);
    expect(camoufoxLaunch).toHaveBeenCalledOnce();
  });

  it('relaunches the same profile when a page dies and no fallback is declared', async () => {
    const first = fakePage();
    const second = fakePage();
    const launch = vi.fn()
      .mockResolvedValueOnce(fakeContext(first))
      .mockResolvedValueOnce(fakeContext(second));
    const manager = makeManager(
      { chrome: launch },
      { profile: { name: 'work', engine: 'chrome', dir: '/tmp/p/work/data' } },
    );

    await manager.getPageForOrigin('https://chat.deepseek.com');
    first.emit('close');

    await expect(manager.getPageForOrigin('https://chat.deepseek.com')).resolves.toBe(second);
    expect(manager.getProfile().name).toBe('work');
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('keeps the profile down when the fallback has no session', async () => {
    const dead = fakePage();
    const chromeLaunch = vi.fn().mockResolvedValue(fakeContext(dead));
    const manager = makeManager(
      { chrome: chromeLaunch, camoufox: vi.fn() },
      { profile: work, resolveProfile: () => personal, hasSession: () => false },
    );

    await manager.getPageForOrigin('https://chat.deepseek.com');
    dead.emit('close');

    await expect(manager.getPageForOrigin('https://chat.deepseek.com')).rejects.toThrow(
      /profile "personal".*login/i,
    );
    // Still asking for login on the next request, not silently retrying the
    // profile whose page died.
    await expect(manager.getPageForOrigin('https://chat.deepseek.com')).rejects.toThrow(
      /profile "personal".*login/i,
    );
    expect(chromeLaunch).toHaveBeenCalledOnce();
  });
});

describe('BrowserManager attach mode', () => {
  function attachManager(overrides: Partial<BrowserManagerOptions> = {}) {
    const userContext = {
      close: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn(),
    };
    const browser = {
      contexts: vi.fn().mockReturnValue([userContext]),
      newContext: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const connect = vi.fn().mockResolvedValue(browser as unknown as Browser);
    const manager = makeManager({}, { mode: 'attach', connect, ...overrides });
    return { manager, browser, userContext, connect };
  }

  it('rejects a non-default chrome profile in attach mode', async () => {
    const { manager, browser, userContext, connect } = attachManager();
    await manager.ensureBrowser();

    await expect(
      manager.activate({ name: 'work', engine: 'chrome', dir: '/tmp/p/work/data' }),
    ).rejects.toThrow(/only.*"default" profile/i);

    expect(manager.getProfile().name).toBe('default');
    expect(connect).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
    expect(userContext.close).not.toHaveBeenCalled();
  });

  it('switching to a launch profile disconnects without closing the user Chrome', async () => {
    const camoufoxContext = {} as BrowserContext;
    const camoufoxLaunch = vi.fn().mockResolvedValue(camoufoxContext);
    const { manager, browser, userContext } = attachManager({
      launchers: { camoufox: camoufoxLaunch },
    });
    await manager.ensureBrowser();

    await manager.activate({ name: 'ff', engine: 'camoufox', dir: '/tmp/p/ff/data' });

    // Playwright's CDP Browser.close() closes the socket, not the browser.
    expect(browser.close).toHaveBeenCalledOnce();
    expect(userContext.close).not.toHaveBeenCalled();
    expect(manager.getMode()).toBe('launch');
    await expect(manager.ensureBrowser()).resolves.toBe(camoufoxContext);
  });

  it('shutdown disconnects from the user Chrome without closing it', async () => {
    const { manager, browser, userContext } = attachManager();
    await manager.ensureBrowser();

    await manager.shutdown();

    expect(browser.close).toHaveBeenCalledOnce();
    expect(userContext.close).not.toHaveBeenCalled();
  });
});
