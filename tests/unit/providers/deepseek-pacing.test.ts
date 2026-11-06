import { describe, it, expect } from 'vitest';
import { createPacer, type Pacer } from '../../../src/providers/deepseek/pacing.js';

// 40 ms slots: long enough to measure, short enough to keep the suite fast.
const SLOT = 40;

/** Runs `starts` back to back and returns how long they took. */
async function elapsed(pacer: Pacer, starts = 2): Promise<number> {
  const t0 = Date.now();
  for (let i = 0; i < starts; i++) await pacer.start();
  return Date.now() - t0;
}

describe('createPacer', () => {
  it('spaces call starts by the gap', async () => {
    expect(await elapsed(createPacer(() => SLOT))).toBeGreaterThanOrEqual(SLOT - 10);
  });

  it('serializes concurrent starts, so a burst becomes a queue', async () => {
    const pacer = createPacer(() => SLOT);
    const t0 = Date.now();
    await Promise.all([pacer.start(), pacer.start(), pacer.start()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * SLOT - 10);
  });

  it('a backoff holds the next start for its time', async () => {
    const pacer = createPacer(() => 0, { challengeBackoffMs: () => SLOT * 2 });
    await pacer.start();
    expect(pacer.backOff('challenge')).toBe(SLOT * 2);
    expect(await elapsed(pacer, 1)).toBeGreaterThanOrEqual(SLOT * 2 - 10);
  });
});

// A gap of exactly 6000 ms forever is a timer signature; the band breaks it.
describe('createPacer jitter', () => {
  it('waits the top of the band when the draw is 1', async () => {
    // Without jitter this is ~100 ms; the draw must stretch it to ~150 ms.
    const pacer = createPacer(() => 100, { jitter: 0.5, random: () => 1 });
    expect(await elapsed(pacer)).toBeGreaterThanOrEqual(140);
  });

  it('waits the bottom of the band when the draw is 0', async () => {
    const pacer = createPacer(() => 100, { jitter: 0.5, random: () => 0 });
    const ms = await elapsed(pacer);
    expect(ms).toBeGreaterThanOrEqual(40);
    // A pacer that ignored the draw and always used the top would take 150 ms.
    expect(ms).toBeLessThan(140);
  });

  it('waits the mean when the draw is in the middle', async () => {
    // The band must not shift the average: 0.5*100 is the unjittered gap.
    const pacer = createPacer(() => 100, { jitter: 0.5, random: () => 0.5 });
    const ms = await elapsed(pacer);
    expect(ms).toBeGreaterThanOrEqual(90);
    expect(ms).toBeLessThan(140);
  });
});

describe('createPacer backoff ladder', () => {
  it('doubles a rate-limit backoff up to the cap', () => {
    const pacer = createPacer(() => 0, { rateLimitBackoffMs: () => 100, rateLimitCapMs: 250 });
    expect(pacer.backOff('rate_limit')).toBe(100);
    expect(pacer.backOff('rate_limit')).toBe(200);
    expect(pacer.backOff('rate_limit')).toBe(250);
    expect(pacer.backOff('rate_limit')).toBe(250);
  });

  it('restarts the ladder once a call comes through', () => {
    // Time alone must not reset it: the 120 s rung would reset itself and the cap is never reached.
    const pacer = createPacer(() => 0, { rateLimitBackoffMs: () => 100 });
    expect(pacer.backOff('rate_limit')).toBe(100);
    expect(pacer.backOff('rate_limit')).toBe(200);
    pacer.ok();
    expect(pacer.backOff('rate_limit')).toBe(100);
  });

  it('a challenge backoff is fixed, not escalated', () => {
    const pacer = createPacer(() => 0, { challengeBackoffMs: () => 500, rateLimitBackoffMs: () => 100 });
    expect(pacer.backOff('challenge')).toBe(500);
    expect(pacer.backOff('challenge')).toBe(500);
  });
});