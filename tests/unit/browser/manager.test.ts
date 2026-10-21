import { describe, it, expect, vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import { BrowserManager, type BrowserManagerOptions } from '../../../src/browser/manager.js';

function makeManager(
  launchers: BrowserManagerOptions['launchers'],
  overrides: Partial<BrowserManagerOptions> = {},
) {
  return new BrowserManager({
    profileDir: '/tmp/webmodel-profile',
    startupTimeout: 5000,
    idleShutdown: 0,
    loginTimeout: 5,
    mode: 'launch',
    launchers,
    ...overrides,
  });
}

describe('BrowserManager launchers', () => {
  it('launches the chrome engine with the injected launcher and its profile dir', async () => {
    const context = {} as BrowserContext;
    const launch = vi.fn().mockResolvedValue(context);

    const manager = makeManager({ chrome: launch });

    await expect(manager.ensureBrowser()).resolves.toBe(context);
    expect(launch).toHaveBeenCalledOnce();
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ profileDir: '/tmp/webmodel-profile', headless: true }),
    );
  });

  it('uses the launcher of the active engine', async () => {
    const chromeLaunch = vi.fn();
    const camoufoxContext = {} as BrowserContext;
    const camoufoxLaunch = vi.fn().mockResolvedValue(camoufoxContext);

    const manager = makeManager(
      { chrome: chromeLaunch, camoufox: camoufoxLaunch },
      { engine: 'camoufox' },
    );

    await expect(manager.ensureBrowser()).resolves.toBe(camoufoxContext);
    expect(camoufoxLaunch).toHaveBeenCalledOnce();
    expect(chromeLaunch).not.toHaveBeenCalled();
  });

  it('rejects an engine with no launcher configured', async () => {
    const manager = makeManager(undefined, { engine: 'camoufox' });

    await expect(manager.ensureBrowser()).rejects.toThrow(
      'No launcher configured for browser engine "camoufox"',
    );
  });

  it('activates another engine and releases the previous context', async () => {
    const chromeContext = { close: vi.fn().mockResolvedValue(undefined) } as unknown as BrowserContext;
    const camoufoxContext = {} as BrowserContext;
    const camoufoxLaunch = vi.fn().mockResolvedValue(camoufoxContext);
    const manager = makeManager({
      chrome: vi.fn().mockResolvedValue(chromeContext),
      camoufox: camoufoxLaunch,
    });

    expect(manager.getEngine()).toBe('chrome');
    await manager.ensureBrowser();

    await manager.activate('camoufox');

    expect(manager.getEngine()).toBe('camoufox');
    expect(chromeContext.close).toHaveBeenCalled();
    await expect(manager.ensureBrowser()).resolves.toBe(camoufoxContext);
  });

  it('propagates a launcher failure', async () => {
    const launch = vi.fn().mockRejectedValue(new Error('browser failed to start'));

    const manager = makeManager({ chrome: launch });

    await expect(manager.ensureBrowser()).rejects.toThrow('browser failed to start');
  });

  it('opens the login window through the injected launcher, headed', async () => {
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
      expect.objectContaining({ profileDir: '/tmp/webmodel-profile', headless: false }),
    );
    expect(page.goto).toHaveBeenCalledWith('https://chat.deepseek.com', expect.anything());

    onPageClose?.();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(true));
    expect(context.close).toHaveBeenCalled();
  });
});
