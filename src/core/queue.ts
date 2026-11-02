import type { BaseProvider } from './provider.js';
import { ProviderPool } from './pool.js';

/**
 * One call at a time per provider (web providers share one browser tab). No pacing:
 * the route reacts to the provider's own "too frequent" / muted answers instead.
 */
export class ProviderQueue {
  /** The account turn keeps its own lanes (one call per account), so it skips the queue. */
  run<T>(provider: BaseProvider, fn: () => Promise<T>): Promise<T> {
    return provider instanceof ProviderPool ? fn() : this.enqueue(provider.info.id, fn);
  }

  private queues = new Map<string, Promise<void>>();

  async enqueue<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(providerId) ?? Promise.resolve();

    let resolve!: () => void;
    const next = new Promise<void>(r => { resolve = r; });
    this.queues.set(providerId, next);

    try {
      await prev; // Wait for previous request to complete
      return await fn();
    } finally {
      resolve();
    }
  }

  get pendingCount(): number {
    return this.queues.size;
  }
}
