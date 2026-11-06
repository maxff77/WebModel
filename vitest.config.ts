import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The bridge defaults to an A/B of tool-call formats; tests pin one so prompts are stable.
    env: {
      WMB_TOOL_FORMAT: 'dsml',
      WMB_MIN_GAP_MS: '0',
      WMB_GAP_JITTER: '0',
      WMB_CHALLENGE_BACKOFF_MS: '0',
      WMB_RATE_LIMIT_BACKOFF_MS: '120',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/dashboard/**'],
    },
  },
});
