import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserEngine } from '../browser/manager.js';

export const DEFAULT_PROFILE = 'default';

export interface ProfileManifest {
  name: string;
  engine: BrowserEngine;
  createdAt: string;
  /** Profile that serves requests when this one fails to start. */
  fallbackProfile?: string;
}

export interface ResolvedProfile extends ProfileManifest {
  /** Browser user-data directory: `<stateDir>/profiles/<name>/data`. */
  dir: string;
  /** Persisted fingerprint; only engines that support one (Camoufox) have it. */
  fingerprint?: unknown;
}

export type ProfileErrorCode = 'invalid' | 'exists' | 'not_found';

export class ProfileError extends Error {
  constructor(message: string, readonly code: ProfileErrorCode) {
    super(message);
    this.name = 'ProfileError';
  }
}

export interface ProfileStoreOptions {
  /** Test seam; the real generator is the optional camoufox-js dependency. */
  generateFingerprint?: () => unknown;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Profiles live on disk (`profiles/<name>/manifest.json`); the filesystem is
 * the source of truth, config only names the active profile.
 */
export class ProfileStore {
  constructor(private stateDir: string, private opts: ProfileStoreOptions = {}) {}

  private get root(): string {
    return join(this.stateDir, 'profiles');
  }

  private profileRoot(name: string): string {
    return join(this.root, name);
  }

  dataDir(name: string): string {
    return join(this.profileRoot(name), 'data');
  }

  get(name: string): ProfileManifest | undefined {
    try {
      const parsed = JSON.parse(readFileSync(join(this.profileRoot(name), 'manifest.json'), 'utf-8'));
      const { engine, createdAt, fallbackProfile } = parsed ?? {};
      if (parsed?.name !== name || (engine !== 'chrome' && engine !== 'camoufox') || typeof createdAt !== 'string') {
        return undefined;
      }
      if (fallbackProfile !== undefined && typeof fallbackProfile !== 'string') return undefined;
      return { name, engine, createdAt, ...(fallbackProfile !== undefined ? { fallbackProfile } : {}) };
    } catch {
      return undefined;
    }
  }

  list(): ProfileManifest[] {
    let names: string[];
    try {
      names = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    return names
      .map((name) => this.get(name))
      .filter((profile): profile is ProfileManifest => profile !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  resolve(name: string): ResolvedProfile {
    const manifest = this.get(name);
    if (!manifest) {
      throw new ProfileError(
        `Unknown profile "${name}". Create it with: web-model-bridge profile create ${name} --engine chrome`,
        'not_found',
      );
    }
    const fallback = manifest.fallbackProfile;
    if (fallback === name) {
      throw new ProfileError(`Profile "${name}" cannot be its own fallback.`, 'invalid');
    }
    if (fallback !== undefined && !this.get(fallback)) {
      throw new ProfileError(
        `Profile "${name}" declares fallback "${fallback}", which does not exist. ` +
        `Create it with: web-model-bridge profile create ${fallback} --engine chrome`,
        'not_found',
      );
    }
    return { ...manifest, dir: this.dataDir(name), fingerprint: this.readFingerprint(name) };
  }

  /** Declare the profile that serves requests when `name` fails to start. */
  setFallback(name: string, fallback: string): ProfileManifest {
    const manifest = this.get(name);
    if (!manifest) {
      throw new ProfileError(
        `Unknown profile "${name}". Create it with: web-model-bridge profile create ${name} --engine chrome`,
        'not_found',
      );
    }
    if (fallback === name) {
      throw new ProfileError(`Profile "${name}" cannot be its own fallback.`, 'invalid');
    }
    if (!this.get(fallback)) {
      throw new ProfileError(
        `Unknown profile "${fallback}". Create it with: web-model-bridge profile create ${fallback} --engine chrome`,
        'not_found',
      );
    }
    const updated: ProfileManifest = { ...manifest, fallbackProfile: fallback };
    writeFileSync(join(this.profileRoot(name), 'manifest.json'), JSON.stringify(updated, null, 2));
    return updated;
  }

  async create(name: string, engine: BrowserEngine): Promise<ProfileManifest> {
    if (!NAME_RE.test(name)) {
      throw new ProfileError(
        `Invalid profile name "${name}". Use 1-32 characters: lowercase letters, digits, "-" or "_", starting with a letter or digit.`,
        'invalid',
      );
    }
    if (this.get(name)) {
      throw new ProfileError(`Profile "${name}" already exists; a profile's engine cannot be changed.`, 'exists');
    }

    // Generate before touching disk so a missing camoufox dependency leaves nothing behind.
    const fingerprint = engine === 'camoufox' ? await this.generateFingerprint() : undefined;

    const root = this.profileRoot(name);
    mkdirSync(join(root, 'data'), { recursive: true });
    if (fingerprint !== undefined) this.writeFingerprint(root, fingerprint);
    return this.writeManifest(root, name, engine);
  }

  /**
   * First run after upgrading from the engine-based layout: adopt the legacy
   * profile matching the configured engine into `default`, keeping its cookies.
   * If only the other engine's profile exists, adopt that one with its engine.
   * The legacy directory is moved, so the login survives without re-login.
   * Guarded by the default manifest, so a failed move is retried next start.
   */
  async migrateLegacy(
    preferredEngine: BrowserEngine,
    legacyChromeDir = join(this.stateDir, 'chrome-profile'),
  ): Promise<void> {
    if (this.get(DEFAULT_PROFILE)) return;

    const legacy = [
      { dir: legacyChromeDir, engine: 'chrome' as const },
      { dir: join(this.stateDir, 'camoufox-profile'), engine: 'camoufox' as const },
    ];
    const ordered = preferredEngine === 'camoufox' ? [legacy[1], legacy[0]] : legacy;
    const source = ordered.find((candidate) => existsSync(candidate.dir));
    const engine = source?.engine ?? preferredEngine;

    const root = this.profileRoot(DEFAULT_PROFILE);
    mkdirSync(root, { recursive: true });
    if (source) {
      try {
        renameSync(source.dir, join(root, 'data'));
      } catch (err) {
        throw new Error(
          `Could not move the legacy profile ${source.dir} into ${join(root, 'data')}: ${(err as Error).message}\n` +
          'Close Chrome and any running bridge, then start again.',
        );
      }
    } else {
      mkdirSync(join(root, 'data'), { recursive: true });
    }

    if (engine === 'camoufox') {
      try {
        this.writeFingerprint(root, await this.generateFingerprint());
      } catch {
        // Optional dependency missing; the camoufox launcher reports the fix
        // when the profile is launched.
      }
    }

    this.writeManifest(root, DEFAULT_PROFILE, engine);
  }

  private readFingerprint(name: string): unknown {
    try {
      return JSON.parse(readFileSync(join(this.profileRoot(name), 'fingerprint.json'), 'utf-8'));
    } catch {
      return undefined;
    }
  }

  private writeFingerprint(root: string, fingerprint: unknown): void {
    writeFileSync(join(root, 'fingerprint.json'), JSON.stringify(fingerprint, null, 2));
  }

  private writeManifest(root: string, name: string, engine: BrowserEngine): ProfileManifest {
    const manifest: ProfileManifest = { name, engine, createdAt: new Date().toISOString() };
    writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  private async generateFingerprint(): Promise<unknown> {
    if (this.opts.generateFingerprint) return this.opts.generateFingerprint();
    let generate: () => unknown;
    try {
      // Deep import: the generator is not re-exported from the package index.
      ({ generateFingerprint: generate } = await import('camoufox-js/dist/fingerprints.js' as string));
    } catch (err) {
      throw new Error(
        `Cannot create a camoufox profile because camoufox-js is not installed: ${(err as Error).message}\n` +
        'Run: npm install camoufox-js',
      );
    }
    return generate();
  }
}
