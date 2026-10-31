import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_PROFILE } from '../profiles/store.js';

export type AuthStatus = 'active' | 'expired' | 'none';

export interface ProviderAuthStatus {
  providerId: string;
  status: AuthStatus;
  lastCheck: string | null;
}

interface AuthData {
  [providerId: string]: {
    status: AuthStatus;
    lastCheck: string;
  };
}

/**
 * Login state per profile and provider. Reads and writes follow the active
 * profile, so switching profiles switches the visible auth state.
 */
export class AuthStore {
  private data: AuthData;
  private profile: string;

  constructor(
    private readonly stateDir: string,
    private readonly activeProfile: () => string = () => DEFAULT_PROFILE,
  ) {
    this.migrateLegacy();
    this.profile = this.activeProfile();
    this.data = this.load(this.profile);
  }

  private filePath(profile: string): string {
    return join(this.stateDir, 'profiles', profile, 'auth.json');
  }

  /** Reload when the active profile changed since the last call. */
  private sync(): void {
    const profile = this.activeProfile();
    if (profile === this.profile) return;
    this.profile = profile;
    this.data = this.load(profile);
  }

  /** Re-read the file: another store (the dashboard login) may have written it. */
  reload(): void {
    this.profile = this.activeProfile();
    this.data = this.load(this.profile);
  }

  getStatus(providerId: string): ProviderAuthStatus {
    this.sync();
    const entry = this.data[providerId];
    if (!entry) {
      return { providerId, status: 'none', lastCheck: null };
    }
    return { providerId, status: entry.status, lastCheck: entry.lastCheck };
  }

  getAllStatuses(): ProviderAuthStatus[] {
    this.sync();
    return Object.keys(this.data).map(id => this.getStatus(id));
  }

  /** Any provider logged in on `profile`; a fallback profile without one cannot serve. */
  hasSession(profile: string): boolean {
    return Object.values(this.load(profile)).some(entry => entry.status === 'active');
  }

  /** `profile` records a login against the profile it started on, not the current one. */
  setStatus(providerId: string, status: AuthStatus, profile = this.activeProfile()): void {
    const entry = { status, lastCheck: new Date().toISOString() };
    if (profile !== this.activeProfile()) {
      const data = this.load(profile);
      data[providerId] = entry;
      this.save(profile, data);
      return;
    }
    this.sync();
    this.data[providerId] = entry;
    this.save(this.profile, this.data);
  }

  clearStatus(providerId: string): void {
    this.sync();
    delete this.data[providerId];
    this.save(this.profile, this.data);
  }

  /** Pre-profiles state: the global auth.json becomes the default profile's. */
  private migrateLegacy(): void {
    const legacy = join(this.stateDir, 'auth.json');
    const target = this.filePath(DEFAULT_PROFILE);
    if (!existsSync(legacy) || existsSync(target)) return;
    mkdirSync(dirname(target), { recursive: true });
    try {
      renameSync(legacy, target);
    } catch {
      // Locked file or racing process: keep the legacy file and start empty;
      // a lost login status only costs a re-login.
    }
  }

  private load(profile: string): AuthData {
    try {
      const raw = readFileSync(this.filePath(profile), 'utf-8');
      return JSON.parse(raw) as AuthData;
    } catch {
      return {};
    }
  }

  private save(profile: string, data: AuthData): void {
    const path = this.filePath(profile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2));
  }
}
