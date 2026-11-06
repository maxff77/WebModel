import { describe, it, expect, vi } from 'vitest';
import { LiveBrowsers } from '../../../src/browser/live.js';
import type { BrowserStatus } from '../../../src/browser/manager.js';

/** A browser double whose only state is what the live set reads. */
function fakeBrowser() {
  let status: BrowserStatus = 'stopped';
  return {
    getStatus: () => status,
    start: () => { status = 'running'; },
    die: () => { status = 'stopped'; },
    shutdown: vi.fn(async () => { status = 'stopped'; }),
  };
}

function harness(maxLive: number) {
  const logs: string[] = [];
  const warm = vi.fn(async (browser: ReturnType<typeof fakeBrowser>) => { browser.start(); });
  const live = new LiveBrowsers({
    maxLive,
    create: () => fakeBrowser(),
    warm,
    log: line => logs.push(line),
  });
  // What a call does: take the browser and load its page.
  const open = async (name: string) => {
    const browser = await live.ensure(name);
    browser.start();
    return browser;
  };
  return { live, logs, warm, open };
}

describe('LiveBrowsers cap', () => {
  it('closes the least recently used idle browser when the cap is reached', async () => {
    const { live, open } = harness(2);
    const a = await open('a');
    const b = await open('b');

    await open('c');

    expect(a.shutdown).toHaveBeenCalledOnce();
    expect(b.shutdown).not.toHaveBeenCalled();
    expect(live.count()).toBe(2);
  });

  it('keeps the most recently used browser when making room', async () => {
    const { live, open } = harness(2);
    const a = await open('a');
    const b = await open('b');
    await live.ensure('a');

    await open('c');

    expect(b.shutdown).toHaveBeenCalledOnce();
    expect(a.shutdown).not.toHaveBeenCalled();
  });

  it('never closes a browser that is in use, even above the cap', async () => {
    const { live, open } = harness(2);
    const a = await open('a');
    const b = await open('b');
    live.hold('a');
    live.hold('b');

    await open('c');

    expect(a.shutdown).not.toHaveBeenCalled();
    expect(b.shutdown).not.toHaveBeenCalled();
    expect(live.count()).toBe(3);
  });

  it('treats zero as no cap', async () => {
    const { live, open } = harness(0);
    for (const name of ['a', 'b', 'c', 'd', 'e']) await open(name);

    expect(live.count()).toBe(5);
  });

  it('stops counting a browser that was closed outside the bridge', async () => {
    const { live, open } = harness(2);
    const a = await open('a');

    a.die();

    expect(live.count()).toBe(0);
  });

  it('closes a named browser on demand', async () => {
    const { live, open } = harness(3);
    const a = await open('a');

    await live.close('a');

    expect(a.shutdown).toHaveBeenCalledOnce();
    expect(live.count()).toBe(0);
  });

  it('does not evict a browser that is being warmed for its turn', async () => {
    const { live, open, warm } = harness(1);
    let warmed: ReturnType<typeof fakeBrowser> | undefined;
    let finish!: () => void;
    warm.mockImplementation(async browser => {
      warmed = browser;
      browser.start();
      await new Promise<void>(resolve => { finish = resolve; });
    });

    const prefetching = live.prefetch('a');
    await vi.waitFor(() => expect(live.count()).toBe(1));
    await open('b');

    expect(warmed!.shutdown).not.toHaveBeenCalled();
    expect(live.count()).toBe(2);

    finish();
    await prefetching;
  });

  it('waits for a warm in flight before closing', async () => {
    const { live, warm } = harness(2);
    let warmed: ReturnType<typeof fakeBrowser> | undefined;
    let finish!: () => void;
    warm.mockImplementation(async browser => {
      warmed = browser;
      browser.start();
      await new Promise<void>(resolve => { finish = resolve; });
    });

    const prefetching = live.prefetch('a');
    await vi.waitFor(() => expect(warmed).toBeDefined());
    const closing = live.close('a');
    finish();
    await Promise.all([prefetching, closing]);

    expect(warmed!.getStatus()).toBe('stopped');
    expect(warmed!.shutdown).toHaveBeenCalledOnce();
  });

  it('closes every browser on shutdown', async () => {
    const { live, open } = harness(3);
    const a = await open('a');
    const b = await open('b');

    await live.closeAll();

    expect(a.shutdown).toHaveBeenCalledOnce();
    expect(b.shutdown).toHaveBeenCalledOnce();
    expect(live.count()).toBe(0);
  });
});

describe('LiveBrowsers prefetch', () => {
  it('warms an account once while a warm is already in flight', async () => {
    const { live, warm } = harness(3);
    let finish!: () => void;
    warm.mockImplementation(async browser => {
      await new Promise<void>(resolve => { finish = resolve; });
      browser.start();
    });

    const first = live.prefetch('a');
    const second = live.prefetch('a');
    await vi.waitFor(() => expect(warm).toHaveBeenCalledTimes(1));
    finish();
    await Promise.all([first, second]);

    expect(warm).toHaveBeenCalledTimes(1);
    expect(live.count()).toBe(1);
  });

  it('logs a failed warm and leaves the account untouched', async () => {
    const { live, logs, warm } = harness(3);
    warm.mockRejectedValueOnce(new Error('boom'));

    await live.prefetch('a');

    expect(logs.some(line => line.includes('warm a failed') && line.includes('boom'))).toBe(true);
    expect(live.count()).toBe(0);
  });
});
