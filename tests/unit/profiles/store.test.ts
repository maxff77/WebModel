import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_PROFILE, ProfileError, ProfileStore } from '../../../src/profiles/store.js';

let stateDir: string;

beforeEach(() => {
  stateDir = join(tmpdir(), `wmb-profiles-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('ProfileStore', () => {
  it('creates a profile with its manifest and data directory', async () => {
    const store = new ProfileStore(stateDir);

    const profile = await store.create('work', 'chrome');

    expect(profile).toMatchObject({ name: 'work', engine: 'chrome' });
    const root = join(stateDir, 'profiles', 'work');
    expect(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'))).toEqual({
      name: 'work',
      engine: 'chrome',
      createdAt: expect.any(String),
    });
    expect(existsSync(join(root, 'data'))).toBe(true);
    expect(store.resolve('work')).toEqual({
      name: 'work',
      engine: 'chrome',
      createdAt: expect.any(String),
      dir: join(root, 'data'),
    });
  });

  it('keeps the engine immutable by refusing to create a profile twice', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');

    await expect(store.create('work', 'camoufox')).rejects.toThrow(/already exists/);
  });

  it('rejects names that are not filesystem-safe slugs', async () => {
    const store = new ProfileStore(stateDir);

    const attempt = store.create('my profile', 'chrome');
    await expect(attempt).rejects.toBeInstanceOf(ProfileError);
    await expect(attempt).rejects.toMatchObject({ code: 'invalid' });
  });

  it('lists the profiles on disk, ignoring directories without a manifest', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');
    await store.create('personal', 'camoufox');
    mkdirSync(join(stateDir, 'profiles', 'junk'), { recursive: true });

    expect(store.list().map((p) => [p.name, p.engine])).toEqual([
      ['personal', 'camoufox'],
      ['work', 'chrome'],
    ]);
  });

  it('reports an unknown profile with the command that creates it', () => {
    const store = new ProfileStore(stateDir);

    expect(() => store.resolve('ghost')).toThrow(/profile create ghost/);
  });

  it('persists a fingerprint only for camoufox profiles', async () => {
    const store = new ProfileStore(stateDir, { generateFingerprint: () => ({ navigator: { userAgent: 'x' } }) });

    await store.create('ff', 'camoufox');
    await store.create('chrome', 'chrome');

    const fingerprint = JSON.parse(
      readFileSync(join(stateDir, 'profiles', 'ff', 'fingerprint.json'), 'utf-8'),
    );
    expect(fingerprint).toEqual({ navigator: { userAgent: 'x' } });
    expect(existsSync(join(stateDir, 'profiles', 'chrome', 'fingerprint.json'))).toBe(false);
    expect(store.resolve('ff').fingerprint).toEqual({ navigator: { userAgent: 'x' } });
    expect(store.resolve('chrome').fingerprint).toBeUndefined();
  });
});

describe('ProfileStore legacy migration', () => {
  it('creates the default profile on a fresh install', async () => {
    const store = new ProfileStore(stateDir);

    await store.migrateLegacy('chrome');

    expect(store.resolve(DEFAULT_PROFILE)).toMatchObject({ name: 'default', engine: 'chrome' });
    expect(existsSync(join(stateDir, 'profiles', 'default', 'data'))).toBe(true);
  });

  it('moves chrome-profile into the default profile without losing its data', async () => {
    mkdirSync(join(stateDir, 'chrome-profile'), { recursive: true });
    writeFileSync(join(stateDir, 'chrome-profile', 'Cookies'), 'session');
    const store = new ProfileStore(stateDir);

    await store.migrateLegacy('chrome');

    expect(store.resolve(DEFAULT_PROFILE).engine).toBe('chrome');
    expect(readFileSync(join(stateDir, 'profiles', 'default', 'data', 'Cookies'), 'utf-8')).toBe('session');
    expect(existsSync(join(stateDir, 'chrome-profile'))).toBe(false);
  });

  it('migrates a configured legacy Chrome dir (browser.profileDir)', async () => {
    const custom = join(stateDir, 'custom-chrome');
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, 'Cookies'), 'session');
    const store = new ProfileStore(stateDir);

    await store.migrateLegacy('chrome', custom);

    expect(readFileSync(join(stateDir, 'profiles', 'default', 'data', 'Cookies'), 'utf-8')).toBe('session');
  });

  it('retries the migration when there is no default manifest yet', async () => {
    // A previous migration failed after creating profiles/ (e.g. a locked Chrome profile).
    mkdirSync(join(stateDir, 'profiles'), { recursive: true });
    mkdirSync(join(stateDir, 'chrome-profile'), { recursive: true });
    writeFileSync(join(stateDir, 'chrome-profile', 'Cookies'), 'session');
    const store = new ProfileStore(stateDir);

    await store.migrateLegacy('chrome');

    expect(store.resolve(DEFAULT_PROFILE).engine).toBe('chrome');
    expect(readFileSync(join(stateDir, 'profiles', 'default', 'data', 'Cookies'), 'utf-8')).toBe('session');
  });

  it('adopts a camoufox profile with its engine when that is all the user has', async () => {
    mkdirSync(join(stateDir, 'camoufox-profile'), { recursive: true });
    const store = new ProfileStore(stateDir, { generateFingerprint: () => ({ ok: true }) });

    await store.migrateLegacy('chrome');

    expect(store.resolve(DEFAULT_PROFILE).engine).toBe('camoufox');
    expect(existsSync(join(stateDir, 'profiles', 'default', 'fingerprint.json'))).toBe(true);
  });

  it('prefers the configured engine when both legacy profiles exist', async () => {
    mkdirSync(join(stateDir, 'chrome-profile'), { recursive: true });
    mkdirSync(join(stateDir, 'camoufox-profile'), { recursive: true });
    const store = new ProfileStore(stateDir, { generateFingerprint: () => ({ ok: true }) });

    await store.migrateLegacy('camoufox');

    expect(store.resolve(DEFAULT_PROFILE).engine).toBe('camoufox');
    expect(existsSync(join(stateDir, 'chrome-profile'))).toBe(true);
  });

  it('does not re-migrate once profiles exist', async () => {
    const store = new ProfileStore(stateDir);
    await store.migrateLegacy('chrome');

    mkdirSync(join(stateDir, 'chrome-profile'), { recursive: true });
    await store.migrateLegacy('chrome');

    expect(existsSync(join(stateDir, 'chrome-profile'))).toBe(true);
    expect(store.list().map((p) => p.name)).toEqual([DEFAULT_PROFILE]);
  });
});
