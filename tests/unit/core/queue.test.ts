import { describe, it, expect } from 'vitest';
import { ProviderQueue } from '../../../src/core/queue.js';

describe('ProviderQueue', () => {
  it('executes requests sequentially per provider', async () => {
    const queue = new ProviderQueue();
    const order: number[] = [];

    const p1 = queue.enqueue('claude-web', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
      return 'first';
    });

    const p2 = queue.enqueue('claude-web', async () => {
      order.push(2);
      return 'second';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2]); // Strictly sequential
  });

  it('allows parallel execution across different providers', async () => {
    const queue = new ProviderQueue();
    const order: string[] = [];

    const p1 = queue.enqueue('claude-web', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push('claude');
    });

    const p2 = queue.enqueue('deepseek-web', async () => {
      order.push('deepseek');
    });

    await Promise.all([p1, p2]);
    // deepseek should finish first since it has no delay
    expect(order[0]).toBe('deepseek');
  });

  it('handles errors without blocking queue', async () => {
    const queue = new ProviderQueue();

    // First request fails
    await expect(
      queue.enqueue('claude-web', async () => { throw new Error('fail'); })
    ).rejects.toThrow('fail');

    // Second request should still work
    const result = await queue.enqueue('claude-web', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('returns function result', async () => {
    const queue = new ProviderQueue();
    const result = await queue.enqueue('test', async () => 42);
    expect(result).toBe(42);
  });

  it('enforces a minimum gap between starts for the same provider', async () => {
    const MIN_GAP_MS = 40;
    const TIMER_SLACK_MS = 10;
    const queue = new ProviderQueue({ minGapMs: MIN_GAP_MS });
    const starts: number[] = [];
    await Promise.all([
      queue.enqueue('p', async () => { starts.push(Date.now()); }),
      queue.enqueue('p', async () => { starts.push(Date.now()); }),
    ]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(MIN_GAP_MS - TIMER_SLACK_MS);
  });

  it('caps starts per rolling window', async () => {
    const WINDOW_MS = 120;
    const TIMER_SLACK_MS = 20;
    const queue = new ProviderQueue({ maxPerWindow: 2, windowMs: WINDOW_MS });
    const starts: number[] = [];
    const run = () => queue.enqueue('p', async () => { starts.push(Date.now()); });
    await Promise.all([run(), run(), run()]);
    expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(WINDOW_MS - TIMER_SLACK_MS);
  });
});
