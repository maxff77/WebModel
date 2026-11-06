/**
 * One gate for every DeepSeek call in this process, across all accounts.
 * DeepSeek scores the traffic of the whole IP: a burst of starts gets
 * CHALLENGE_REQUIRED, and a refused challenge gets every session closed
 * (2026-11-04). Spacing starts and pausing after a refusal keeps the
 * account alive; the gap is banded rather than constant because an interval
 * of exactly 6000 ms forever is a timer signature, and the band costs no
 * mean latency.
 */
export type BackoffReason = 'challenge' | 'rate_limit';

export interface Pacer {
  /** Waits for this call's slot, then reserves it. */
  start(): Promise<void>;
  /** Pauses every call; returns the pause in ms. */
  backOff(reason: BackoffReason): number;
  /** A call came through: the rate-limit ladder starts over. */
  ok(): void;
}

export interface PacerOptions {
  /** Fraction of the gap the draw may add or remove; 0 keeps a constant gap. */
  jitter?: number;
  /** Injectable so tests are deterministic. */
  random?: () => number;
  challengeBackoffMs?: () => number;
  rateLimitBackoffMs?: () => number;
  /** Ceiling of the rate-limit ladder. */
  rateLimitCapMs?: number;
}

export function createPacer(gapMs: () => number, options: PacerOptions = {}): Pacer {
  const jitter = options.jitter ?? 0;
  const random = options.random ?? Math.random;
  const challengeBackoffMs = options.challengeBackoffMs ?? (() => 60_000);
  const rateLimitBackoffMs = options.rateLimitBackoffMs ?? (() => 30_000);
  const capMs = options.rateLimitCapMs ?? 600_000;

  let lastStart = 0;
  let backoffUntil = 0;
  let chain: Promise<void> = Promise.resolve();
  // Rate-limit refusals escalate; a quiet window resets the ladder.
  let step = 0;

  const jitteredGap = (): number => {
    const base = gapMs();
    if (jitter <= 0 || base <= 0) return base;
    return base * (1 - jitter + random() * 2 * jitter);
  };

  return {
    start(): Promise<void> {
      const turn = chain.then(async () => {
        const wait = Math.max(lastStart + jitteredGap() - Date.now(), backoffUntil - Date.now());
        if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
        lastStart = Date.now();
      });
      // A failed turn must not wedge the chain.
      chain = turn.catch(() => {});
      return turn;
    },
    backOff(reason: BackoffReason): number {
      let ms: number;
      if (reason === 'challenge') {
        // Fixed: the challenge is the IP being flagged, not a volume ladder.
        ms = challengeBackoffMs();
      } else {
        ms = Math.min(rateLimitBackoffMs() * 2 ** step, capMs);
        step += 1;
      }
      backoffUntil = Math.max(backoffUntil, Date.now() + ms);
      return ms;
    },
    ok(): void {
      step = 0;
    },
  };
}