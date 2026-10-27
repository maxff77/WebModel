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

/** Edit a manifest by hand, the way a user declares a fallback profile. */
function setFallback(name: string, fallbackProfile: string): void {
  const path = join(stateDir, 'profiles', name, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf-8'));
  writeFileSync(path, JSON.stringify({ ...manifest, fallbackProfile }, null, 2));
}

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

    expect(() => store.create('work', 'camoufox')).toThrow(/already exists/);
  });

  it('reads back a cloakbrowser profile', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('cloak', 'cloakbrowser');

    expect(store.get('cloak')?.engine).toBe('cloakbrowser');
  });

  it('rejects names that are not filesystem-safe slugs', async () => {
    const store = new ProfileStore(stateDir);

    expect(() => store.create('my profile', 'chrome')).toThrow(ProfileError);
    expect(() => store.create('my profile', 'chrome')).toThrow(/Invalid profile name/);
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

  it('reads the fallback profile declared in the manifest', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');
    await store.create('personal', 'camoufox');
    setFallback('work', 'personal');

    expect(store.resolve('work').fallbackProfile).toBe('personal');
    expect(store.resolve('personal').fallbackProfile).toBeUndefined();
  });

  it('writes the fallback into the profile manifest', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');
    await store.create('personal', 'camoufox');

    const profile = store.setFallback('work', 'personal');

    expect(profile.fallbackProfile).toBe('personal');
    expect(store.resolve('work').fallbackProfile).toBe('personal');
    const manifest = JSON.parse(readFileSync(join(stateDir, 'profiles', 'work', 'manifest.json'), 'utf-8'));
    expect(manifest).toMatchObject({ name: 'work', engine: 'chrome', fallbackProfile: 'personal' });
  });

  it('refuses to declare itself or an unknown profile as fallback', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');

    expect(() => store.setFallback('work', 'work')).toThrow(/cannot be its own fallback/i);
    expect(() => store.setFallback('work', 'ghost')).toThrow(/unknown profile "ghost"/i);
    expect(store.resolve('work').fallbackProfile).toBeUndefined();
  });

  it('rejects a profile that declares itself as its fallback', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');
    setFallback('work', 'work');

    expect(() => store.resolve('work')).toThrow(/cannot be its own fallback/i);
  });

  it('rejects a fallback profile that does not exist', async () => {
    const store = new ProfileStore(stateDir);
    await store.create('work', 'chrome');
    setFallback('work', 'ghost');

    expect(() => store.resolve('work')).toThrow(/fallback "ghost".*does not exist/i);
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
    const store = new ProfileStore(stateDir);

    await store.migrateLegacy('chrome');

    expect(store.resolve(DEFAULT_PROFILE).engine).toBe('camoufox');
  });

  it('prefers the configured engine when both legacy profiles exist', async () => {
    mkdirSync(join(stateDir, 'chrome-profile'), { recursive: true });
    mkdirSync(join(stateDir, 'camoufox-profile'), { recursive: true });
    const store = new ProfileStore(stateDir);

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
