import type { BrowserStatus } from './manager.js';

/** The browser methods the live set needs; BrowserManager satisfies it. */
export interface LiveBrowser {
  getStatus(): BrowserStatus;
  shutdown(): Promise<void>;
}

export interface LiveBrowsersOptions<T extends LiveBrowser> {
  /** Maximum live browsers. 0 or less means no limit. */
  maxLive: number;
  create: (name: string) => T;
  /** Launch and load the page that makes the browser warm for its next call. */
  warm: (browser: T) => Promise<void>;
  log?: (line: string) => void;
}

interface Entry<T> {
  browser: T;
  lastUse: number;
}

/**
 * The browsers of the accounts in turn: capped, kept warm one call ahead, and
 * evicted least-recently-used-first. A browser is evictable only while no call
 * holds it, so the cap is soft when every live browser is in use.
 */
export class LiveBrowsers<T extends LiveBrowser = LiveBrowser> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly held = new Set<string>();
  private readonly warming = new Map<string, Promise<void>>();
  private clock = 0;

  constructor(private readonly opts: LiveBrowsersOptions<T>) {}

  get max(): number {
    return this.opts.maxLive;
  }

  /** Live browsers right now; one that died or was closed stops counting. */
  count(): number {
    let live = 0;
    for (const entry of this.entries.values()) if (this.isLive(entry)) live++;
    return live;
  }

  /** The account's browser, making room first when it has to be launched. */
  async ensure(name: string): Promise<T> {
    // A request for an account already being warmed waits for that same launch.
    const inFlight = this.warming.get(name);
    if (inFlight) await inFlight;

    let entry = this.entries.get(name);
    if (!entry) {
      entry = { browser: this.opts.create(name), lastUse: 0 };
      this.entries.set(name, entry);
    }
    await this.makeRoom(name, entry);
    this.touch(name);
    return entry.browser;
  }

  /** A call started: its browser must not be evicted until release. */
  hold(name: string): void {
    this.held.add(name);
  }

  /** A call ended: the browser may be evicted again. */
  release(name: string): void {
    this.held.delete(name);
    this.touch(name);
  }

  /** Close the account's browser now, e.g. before the main browser takes its profile dir. */
  async close(name: string): Promise<void> {
    // A warm in flight would relaunch the browser right after the shutdown.
    const inFlight = this.warming.get(name);
    if (inFlight) await inFlight;
    const entry = this.entries.get(name);
    if (!entry) return;
    this.entries.delete(name);
    this.log(`browsers vivos=${this.count()} (tope=${this.opts.maxLive}) — close ${name}`);
    await this.stop(entry);
  }

  /** Close every browser the turn holds (bridge shutdown). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.warming.values()]);
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.log(`browsers vivos=0 (tope=${this.opts.maxLive}) — close all`);
    await Promise.all(entries.map(entry => this.stop(entry)));
  }

  /** Warm the account's browser once, ahead of its turn. Failures only log. */
  prefetch(name: string): Promise<void> {
    const inFlight = this.warming.get(name);
    if (inFlight) return inFlight;

    const run = (async () => {
      const browser = await this.ensure(name);
      await this.opts.warm(browser);
      this.touch(name);
    })()
      .catch(err => this.log(`warm ${name} failed: ${(err as Error).message}`))
      .finally(() => this.warming.delete(name));

    this.warming.set(name, run);
    return run;
  }

  private touch(name: string): void {
    const entry = this.entries.get(name);
    if (entry) entry.lastUse = ++this.clock;
  }

  private async makeRoom(name: string, entry: Entry<T>): Promise<void> {
    const cap = this.opts.maxLive;
    // A warm browser is reused in place; only a launch can exceed the cap.
    if (this.isLive(entry)) return;

    while (cap > 0 && this.count() >= cap) {
      const victim = this.lruIdle(name);
      if (!victim) break; // every live browser is in use: the cap is soft
      const closed = this.entries.get(victim)!;
      this.entries.delete(victim);
      this.log(`browsers vivos=${this.count()} (tope=${cap}) — close ${victim}`);
      await this.stop(closed);
    }
    this.log(`browsers vivos=${this.count() + 1} (tope=${cap}) — open ${name}`);
  }

  private lruIdle(keep: string): string | undefined {
    let oldest: { name: string; lastUse: number } | undefined;
    for (const [name, entry] of this.entries) {
      // A warm in flight is a use: closing it would throw that launch away.
      if (name === keep || this.held.has(name) || this.warming.has(name)) continue;
      if (!this.isLive(entry)) continue;
      if (!oldest || entry.lastUse < oldest.lastUse) oldest = { name, lastUse: entry.lastUse };
    }
    return oldest?.name;
  }

  private isLive(entry: Entry<T>): boolean {
    return entry.browser.getStatus() === 'running';
  }

  private async stop(entry: Entry<T>): Promise<void> {
    await entry.browser.shutdown().catch(() => {});
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }
}
