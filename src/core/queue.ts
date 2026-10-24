export interface QueueOptions {
  /** Minimum delay between the start of two calls to the same provider. */
  minGapMs?: number;
  /** Maximum calls started per rolling window, per provider. */
  maxPerWindow?: number;
  /** Rolling window for maxPerWindow. */
  windowMs?: number;
}

function envNumber(raw: string | undefined, fallback: number, min: number): number {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n >= min ? n : fallback;
}

/**
 * Start-rate pacing per provider, separate from the 429 cooldown in the route.
 * One model call costs 3 upstream HTTP requests. 10 starts/min with a 6s gap
 * spreads them evenly: a 1s gap let bursts through (7 in ~17s got DeepSeek's
 * "too frequent", and a ~1h account lockout followed one). Typical sessions run
 * 6-7 calls/min, so only fast tool-call streaks slow down. Env-overridable.
 */
export const requestPacing: QueueOptions = {
  minGapMs: envNumber(process.env.WMB_MIN_GAP_MS, 6_000, 0),
  maxPerWindow: envNumber(process.env.WMB_MAX_RPM, 10, 1),
};

export class ProviderQueue {
  private queues = new Map<string, Promise<void>>();
  private starts = new Map<string, number[]>();

  constructor(private readonly options: QueueOptions = {}) {}

  async enqueue<T>(providerId: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const prev = this.queues.get(providerId) ?? Promise.resolve();

    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    this.queues.set(providerId, next);

    try {
      await prev; // Wait for previous request to complete
      await this.waitForSlot(providerId, signal);
      return await fn();
    } finally {
      resolve();
    }
  }

  private async waitForSlot(providerId: string, signal?: AbortSignal): Promise<void> {
    const { minGapMs = 0, maxPerWindow, windowMs = 60_000 } = this.options;
    const now = Date.now();
    const recent = (this.starts.get(providerId) ?? []).filter(t => t > now - windowMs);

    let wait = 0;
    const last = recent.at(-1);
    if (last !== undefined) wait = Math.max(wait, last + minGapMs - now);
    if (maxPerWindow !== undefined && recent.length >= maxPerWindow) {
      // Wait until the oldest call still inside the window leaves it.
      wait = Math.max(wait, recent[recent.length - maxPerWindow] + windowMs - now);
    }

    if (wait > 0) await this.sleep(wait, signal);
    // Aborted while queued: don't spend a slot; fn() sees the signal and bails.
    if (signal?.aborted) return;
    recent.push(Date.now());
    this.starts.set(providerId, recent);
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  get pendingCount(): number {
    return this.queues.size;
  }
}
