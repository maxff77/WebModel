import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuthStore } from '../../../src/auth/store.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AuthStore', () => {
  let testDir: string;
  let store: AuthStore;

  beforeEach(() => {
    testDir = join(tmpdir(), `wmb-auth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    store = new AuthStore(testDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns "none" for unknown provider', () => {
    expect(store.getStatus('claude-web')).toEqual({
      providerId: 'claude-web',
      status: 'none',
      lastCheck: null,
    });
  });

  it('sets and gets status', () => {
    store.setStatus('claude-web', 'active');
    const s = store.getStatus('claude-web');
    expect(s.status).toBe('active');
    expect(s.lastCheck).toBeTypeOf('string');
  });

  it('persists to disk and reloads', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('deepseek-web', 'expired');

    const store2 = new AuthStore(testDir);
    expect(store2.getStatus('claude-web').status).toBe('active');
    expect(store2.getStatus('deepseek-web').status).toBe('expired');
  });

  it('getAllStatuses returns all known providers', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('chatgpt-web', 'none');
    const all = store.getAllStatuses();
    expect(all).toHaveLength(2);
    expect(all.map(s => s.providerId)).toContain('claude-web');
    expect(all.map(s => s.providerId)).toContain('chatgpt-web');
  });

  it('clearStatus removes a provider', () => {
    store.setStatus('claude-web', 'active');
    store.clearStatus('claude-web');
    expect(store.getStatus('claude-web').status).toBe('none');
  });

  it('setStatus overwrites previous status', () => {
    store.setStatus('claude-web', 'active');
    store.setStatus('claude-web', 'expired');
    expect(store.getStatus('claude-web').status).toBe('expired');
  });
});

describe('AuthStore per profile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `wmb-auth-profile-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('keeps each profile\'s status separate and follows the active profile', () => {
    let active = 'default';
    const store = new AuthStore(testDir, () => active);

    store.setStatus('claude-web', 'active');
    active = 'work';
    expect(store.getStatus('claude-web').status).toBe('none');

    store.setStatus('claude-web', 'expired');
    active = 'default';
    expect(store.getStatus('claude-web').status).toBe('active');

    active = 'work';
    expect(store.getStatus('claude-web').status).toBe('expired');
  });

  it('clears and lists statuses for the active profile only', () => {
    let active = 'default';
    const store = new AuthStore(testDir, () => active);

    store.setStatus('claude-web', 'active');
    store.setStatus('deepseek-web', 'expired');
    active = 'work';
    store.setStatus('claude-web', 'active');

    expect(store.getAllStatuses().map(s => s.providerId)).toEqual(['claude-web']);
    store.clearStatus('claude-web');
    expect(store.getStatus('claude-web').status).toBe('none');

    active = 'default';
    expect(store.getAllStatuses().map(s => [s.providerId, s.status])).toEqual([
      ['claude-web', 'active'],
      ['deepseek-web', 'expired'],
    ]);
  });

  it('reports whether a profile has any active session', () => {
    let active = 'default';
    const store = new AuthStore(testDir, () => active);

    store.setStatus('claude-web', 'active');
    expect(store.hasSession('default')).toBe(true);
    expect(store.hasSession('work')).toBe(false);

    active = 'work';
    store.setStatus('deepseek-web', 'expired');
    expect(store.hasSession('work')).toBe(false);
    store.setStatus('deepseek-web', 'active');
    expect(store.hasSession('work')).toBe(true);
  });

  it('records a login against the profile it started on, even after a switch', () => {
    let active = 'default';
    const store = new AuthStore(testDir, () => active);

    active = 'work';
    store.setStatus('deepseek-web', 'active', 'default');

    expect(store.getStatus('deepseek-web').status).toBe('none');
    expect(new AuthStore(testDir, () => 'default').getStatus('deepseek-web').status).toBe('active');
  });

  it('a store pinned to one profile sees a login another store wrote once reloaded', () => {
    const account = new AuthStore(testDir, () => 'cuenta1');
    const dashboard = new AuthStore(testDir, () => 'default');
    dashboard.setStatus('deepseek-web', 'active', 'cuenta1');

    expect(account.getStatus('deepseek-web').status).toBe('none');
    account.reload();
    expect(account.getStatus('deepseek-web').status).toBe('active');
  });

  it('migrates the legacy global auth.json into the default profile', () => {
    const lastCheck = '2026-10-01T00:00:00.000Z';
    writeFileSync(
      join(testDir, 'auth.json'),
      JSON.stringify({ 'claude-web': { status: 'active', lastCheck } }),
    );

    const store = new AuthStore(testDir);
    expect(store.getStatus('claude-web')).toEqual({ providerId: 'claude-web', status: 'active', lastCheck });
    expect(existsSync(join(testDir, 'auth.json'))).toBe(false);
  });

  it('does not leak the legacy global auth.json into another profile', () => {
    writeFileSync(
      join(testDir, 'auth.json'),
      JSON.stringify({ 'claude-web': { status: 'active', lastCheck: '2026-10-01T00:00:00.000Z' } }),
    );

    const store = new AuthStore(testDir, () => 'work');
    expect(store.getStatus('claude-web').status).toBe('none');
  });
});
