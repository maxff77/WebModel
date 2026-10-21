import { createApp } from '../../src/server.js';
import { ProviderRegistry } from '../../src/core/registry.js';
import { AuthStore } from '../../src/auth/store.js';
import { MockProvider } from './mock-provider.js';
import { requestPacing } from '../../src/core/queue.js';
import type { BrowserEngine } from '../../src/browser/manager.js';
import type { ProfilesApi } from '../../src/routes/management.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  registry: ProviderRegistry;
  authStore: AuthStore;
  stateDir: string;
  cleanup: () => void;
}

export function createTestContext(opts?: {
  authToken?: string;
  providers?: MockProvider[];
  fallbackModel?: string;
  browserEngine?: BrowserEngine;
  /** Built from the context's temp stateDir, so tests can use a real ProfileStore. */
  profiles?: (stateDir: string) => ProfilesApi;
}): TestContext {
  // Route tests exercise behaviour, not real pacing; the 1s gap would only slow them.
  requestPacing.minGapMs = 0;
  requestPacing.maxPerWindow = undefined;

  const stateDir = join(tmpdir(), `wmb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });

  const registry = new ProviderRegistry(opts?.fallbackModel);
  const authStore = new AuthStore(stateDir);

  const providers = opts?.providers ?? [
    new MockProvider('claude-web', {
      authenticated: true,
      models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutput: 8192 }],
    }),
  ];

  for (const p of providers) {
    registry.register(p);
  }

  const app = createApp({
    registry,
    authStore,
    authToken: opts?.authToken ?? null,
    getBrowserEngine: opts?.browserEngine ? () => opts.browserEngine! : undefined,
    profiles: opts?.profiles?.(stateDir),
  });

  return {
    app,
    registry,
    authStore,
    stateDir,
    cleanup: () => rmSync(stateDir, { recursive: true, force: true }),
  };
}
