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

function fakeContext() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn(),
  } as unknown as BrowserContext & { close: ReturnType<typeof vi.fn> };
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
