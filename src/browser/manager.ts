import type { Browser, BrowserContext, Page } from 'playwright-core';
import { findChromePath } from '../doctor.js';
import { platform } from 'node:os';
import { randomInt } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PROFILE, type ResolvedProfile } from '../profiles/store.js';
import { BrowserUnavailableError } from '../core/errors.js';

export type BrowserStatus = 'running' | 'idle' | 'stopped';
export type BrowserMode = 'attach' | 'launch';
export type LoginStatus = 'idle' | 'opening' | 'waiting_for_user' | 'success' | 'failed';

export interface LoginState {
  providerId: string | null;
  status: LoginStatus;
  message: string;
  startedAt: number | null;
}

export interface BrowserLaunchOptions {
  profileDir: string;
  headless: boolean;
  timeout: number;
}

export type BrowserLauncher = (options: BrowserLaunchOptions) => Promise<BrowserContext>;

/** Attach-mode seam, injected in tests instead of dialing a real CDP endpoint. */
export type CdpConnector = (cdpUrl: string, timeout: number) => Promise<Browser>;

export type BrowserEngine = 'chrome' | 'camoufox' | 'cloakbrowser' | 'apostate';

/** The manager only needs the identity, engine, data dir and fallback of a profile. */
export type ActiveProfile = Pick<
  ResolvedProfile,
  'name' | 'engine' | 'dir' | 'fallbackProfile'
>;

export function isBrowserEngine(value: unknown): value is BrowserEngine {
  return value === 'chrome' || value === 'camoufox' || value === 'cloakbrowser' || value === 'apostate';
}

/** Attach drives the user's own Chrome; every other engine is a browser we launch. */
export function effectiveMode(engine: BrowserEngine, mode: BrowserMode): BrowserMode {
  return engine === 'chrome' ? mode : 'launch';
}

/**
 * The user's own Chrome belongs to the default profile. Returns the message
 * to show when a profile would need attach mode but is not the default one.
 */
export function attachProfileError(
  profile: Pick<ResolvedProfile, 'name' | 'engine'>,
  requestedMode: BrowserMode,
): string | null {
  if (effectiveMode(profile.engine, requestedMode) !== 'attach' || profile.name === DEFAULT_PROFILE) {
    return null;
  }
  return `Attach mode uses your own Chrome, which is only available to the "${DEFAULT_PROFILE}" profile. ` +
    `Start with --browser-mode launch to use the "${profile.name}" profile.`;
}

export interface BrowserManagerOptions {
  profile: ResolvedProfile;
  startupTimeout: number;
  idleShutdown: number;
  loginTimeout: number;
  headless?: boolean;     // launch mode; default true
  cdpUrl?: string;        // e.g. "http://127.0.0.1:9222"
  mode?: BrowserMode;     // "attach" (default) | "launch"
  launchers?: Partial<Record<BrowserEngine, BrowserLauncher>>;
  connect?: CdpConnector;
  /** Load a profile by name; without it, a failed launch cannot fall back. */
  resolveProfile?: (name: string) => ResolvedProfile | undefined;
  /** Whether a profile has any session logged in; a fallback without one cannot serve. */
  hasSession?: (profile: string) => boolean;
}

const CHROME_ARGS = ['--no-first-run', '--no-default-browser-check'];

const HOST_OS = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';

async function launchChromeContext(options: BrowserLaunchOptions): Promise<BrowserContext> {
  const executablePath = findChromePath();
  if (!executablePath) {
    throw new Error('Chrome not found. Install Google Chrome first.');
  }
  const { chromium } = await import('playwright-core');
  return chromium.launchPersistentContext(options.profileDir, {
    headless: options.headless,
    executablePath,
    args: options.headless
      ? [...CHROME_ARGS, '--disable-background-timer-throttling']
      : CHROME_ARGS,
    timeout: options.timeout,
  });
}

async function launchCamoufoxContext(options: BrowserLaunchOptions): Promise<BrowserContext> {
  let Camoufox: (opts: Record<string, unknown>) => Promise<BrowserContext>;
  try {
    // Optional dependency: only users of this engine need it (and Node >= 22).
    ({ Camoufox } = await import('camoufox-js' as string));
  } catch (err) {
    throw new Error(
      `Camoufox is not installed or could not be loaded: ${(err as Error).message}\n` +
      'Run: npm install camoufox-js\n' +
      'Then download the browser binary with: npx camoufox-js fetch',
    );
  }
  try {
    // No fingerprint argument: Camoufox generates its own BrowserForge
    // fingerprint per launch, matched to its pinned build. Constrain it to the
    // host OS so the spoofed platform matches the fonts and hardware around it.
    return await Camoufox({
      user_data_dir: options.profileDir,
      headless: options.headless,
      timeout: options.timeout,
      os: HOST_OS,
      // Camoufox injects uBlock Origin by default. Its lists abort DeepSeek's
      // device-fingerprint endpoints (gator.volces.com, fp-it-acc.portal101.cn),
      // which a normal browser lets through. Removing it does not fix the
      // DeepSeek hCaptcha loop: hCaptcha still answers pass:false.
      exclude_addons: ['UBO'],
    });
  } catch (err) {
    throw new Error(
      `Camoufox could not start: ${(err as Error).message}\n\n` +
      'If the browser binary is missing, download it with: npx camoufox-js fetch',
    );
  }
}

async function launchCloakBrowserContext(options: BrowserLaunchOptions): Promise<BrowserContext> {
  let launchPersistentContext: (opts: Record<string, unknown>) => Promise<BrowserContext>;
  try {
    // Optional dependency: only users of this engine need it.
    ({ launchPersistentContext } = await import('cloakbrowser' as string));
  } catch (err) {
    throw new Error(
      `CloakBrowser is not installed or could not be loaded: ${(err as Error).message}\n` +
      'Run: npm install cloakbrowser\n' +
      'Then download the browser binary with: npx cloakbrowser install',
    );
  }
  // The wrapper stores one fingerprint seed per profile in
  // <profileDir>/.cloakbrowser-seed, so each account keeps its own stable
  // fingerprint. Unlike Camoufox, it passed DeepSeek's hCaptcha (2026-10-24).
  return launchPersistentContext({
    userDataDir: options.profileDir,
    headless: options.headless,
    launchOptions: { timeout: options.timeout },
  });
}

/**
 * Apostate draws a new machine on every launch unless given a seed, so each
 * profile keeps one in <profileDir>/.apostate-seed, as the CloakBrowser
 * wrapper does for itself.
 */
export async function profileSeed(profileDir: string): Promise<number> {
  const seedFile = join(profileDir, '.apostate-seed');
  const saved = Number((await readFile(seedFile, 'utf-8').catch(() => '')).trim());
  if (Number.isInteger(saved) && saved > 0) return saved;
  const seed = randomInt(10000, 100000);
  await mkdir(profileDir, { recursive: true });
  await writeFile(seedFile, String(seed));
  return seed;
}

async function launchApostateContext(options: BrowserLaunchOptions): Promise<BrowserContext> {
  let launchPersistentContext: (userDataDir: string, opts: Record<string, unknown>) => Promise<BrowserContext>;
  try {
    // Optional dependency: only users of this engine need it.
    ({ launchPersistentContext } = await import('@heretic-tech/apostate' as string));
  } catch (err) {
    throw new Error(
      `Apostate is not installed or could not be loaded: ${(err as Error).message}\n` +
      'Run: npm install @heretic-tech/apostate\n' +
      'Then download the browser binary with: npx apostate install',
    );
  }
  // Fully open source (GPL-3.0). It passed DeepSeek's hCaptcha and finished
  // the login (2026-10-29). Canvas/audio noise stays off: it is detectable.
  return launchPersistentContext(options.profileDir, {
    fingerprint: await profileSeed(options.profileDir),
    fingerprintPlatform: HOST_OS,
    headless: options.headless,
    timeout: options.timeout,
  });
}

const defaultLaunchers: Record<BrowserEngine, BrowserLauncher> = {
  chrome: launchChromeContext,
  camoufox: launchCamoufoxContext,
  cloakbrowser: launchCloakBrowserContext,
  apostate: launchApostateContext,
};

async function connectOverCDP(cdpUrl: string, timeout: number): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  return chromium.connectOverCDP(cdpUrl, { timeout });
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private _status: BrowserStatus = 'stopped';
  private _mode: BrowserMode;
  private _requestedMode: BrowserMode;
  private _profile: ResolvedProfile;
  private _loginState: LoginState = { providerId: null, status: 'idle', message: '', startedAt: null };
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** A page closed or crashed; the next acquisition must not reuse this browser. */
  private pageLost = false;
  private releasing = false;

  constructor(private opts: BrowserManagerOptions) {
    this._profile = opts.profile;
    this._requestedMode = opts.mode ?? 'attach';
    this._mode = effectiveMode(this._profile.engine, this._requestedMode);
  }

  /**
   * Connect to browser. In attach mode, connects to existing Chrome via CDP.
   * In launch mode, launches a new persistent context.
   */
  async ensureBrowser(): Promise<BrowserContext> {
    if (this.pageLost) {
      // A closed or crashed page marks the profile down. It stays down when
      // the fallback cannot serve, so the next request keeps asking for login
      // instead of silently retrying the profile that died.
      await this.failOver(`Profile "${this._profile.name}" page closed or crashed`);
      this.pageLost = false;
    }

    if (this.context) {
      this.resetIdleTimer();
      return this.context;
    }

    if (this._mode === 'attach') {
      const cdpUrl = this.opts.cdpUrl ?? 'http://127.0.0.1:9222';
      try {
        this.browser = await (this.opts.connect ?? connectOverCDP)(cdpUrl, this.opts.startupTimeout);
        const contexts = this.browser.contexts();
        this.context = contexts[0] ?? await this.browser.newContext();
        this._status = 'running';
        this.resetIdleTimer();
        return this.context;
      } catch (err) {
        const errorMsg = (err as Error).message;
        // Provide helpful error message
        if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connect')) {
          throw new Error(
            `Cannot connect to Chrome at ${cdpUrl}.\n\n` +
            `To use web-model-bridge, Chrome needs to run with remote debugging enabled:\n\n` +
            this.getChromeStartCommand() +
            `\n\nOr switch to launch mode: web-model-bridge --browser-mode launch`
          );
        }
        throw err;
      }
    }

    // Launch mode — start a new browser with persistent profile
    try {
      this.context = await this.launch(this.opts.headless ?? true);
    } catch (err) {
      this.context = await this.launchFallback(err as Error);
    }

    this._status = 'running';
    this.resetIdleTimer();
    return this.context;
  }

  /**
   * A launch failure switches to the profile's declared fallback for this and
   * later requests. A fallback with no session cannot serve: fail clearly.
   */
  private async launchFallback(cause: Error): Promise<BrowserContext> {
    const summary = `Profile "${this._profile.name}" failed to start (${cause.message})`;
    if (!(await this.failOver(summary))) throw cause;
    return this.launch(this.opts.headless ?? true);
  }

  /**
   * Release the current browser and move to the profile's declared fallback.
   * Returns false when no fallback is declared (the caller keeps the profile).
   * A fallback with no session cannot serve, so this throws naming it.
   */
  private async failOver(summary: string): Promise<boolean> {
    await this.release();
    const failed = this._profile;
    const fallbackName = failed.fallbackProfile;
    const fallback = fallbackName && fallbackName !== failed.name
      ? this.opts.resolveProfile?.(fallbackName)
      : undefined;
    if (!fallback) return false;

    if (this.opts.hasSession && !this.opts.hasSession(fallback.name)) {
      throw new BrowserUnavailableError(
        `${summary}. Fallback profile "${fallback.name}" has no login: ` +
        `open the Dashboard and login as "${fallback.name}".`,
      );
    }

    this._profile = fallback;
    // Failover always launches the fallback: it is another identity, never the
    // user's own Chrome, so attach semantics do not apply.
    this._mode = 'launch';
    return true;
  }

  // Cache: domain → page (avoid re-navigating for same domain)
  private domainPages = new Map<string, Page>();

  /**
   * Get a page navigated to the target origin (cached per domain).
   */
  async getPageForOrigin(origin: string): Promise<Page> {
    const ctx = await this.ensureBrowser();

    let page = this.domainPages.get(origin);
    if (page && page.isClosed()) {
      this.domainPages.delete(origin);
      page = undefined;
    }

    if (!page) {
      page = await ctx.newPage();
      const onPageLost = () => {
        // Playwright can deliver a close after its context was replaced; only
        // the context this page belongs to can mark the profile down.
        if (this.releasing || this.context !== ctx) return;
        this.pageLost = true;
        this._status = 'stopped';
      };
      page.on('close', onPageLost);
      page.on('crash', onPageLost);
      try {
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch {
        try {
          await page.goto(origin + '/', { waitUntil: 'commit', timeout: 10000 });
        } catch {
          // Page is now on the right domain even if load didn't fully complete
        }
      }
      this.domainPages.set(origin, page);
    }

    return page;
  }

  /**
   * Execute arbitrary code in browser context on a specific domain.
   */
  async evaluateOnDomain<T>(origin: string, fn: string, args?: unknown): Promise<T> {
    const page = await this.getPageForOrigin(origin);
    return page.evaluate(fn as any, args as any) as Promise<T>;
  }

  /**
   * Execute fetch in browser context. Navigates to the target domain first
   * so that cookies are available and CORS is not an issue.
   */
  async fetchInBrowser(url: string, init: RequestInit): Promise<Response> {
    const targetOrigin = new URL(url).origin;
    const page = await this.getPageForOrigin(targetOrigin);

    const result = await page.evaluate(
      async ([fetchUrl, fetchInit]: [string, { method?: string; headers?: Record<string, string>; body?: string }]) => {
        const res = await fetch(fetchUrl, {
          method: fetchInit.method || 'GET',
          headers: fetchInit.headers,
          body: fetchInit.body,
          credentials: 'include',
        });

        const headers: Record<string, string> = {};
        res.headers.forEach((v: string, k: string) => { headers[k] = v; });
        const text = await res.text();
        return { status: res.status, headers, body: text, ok: res.ok };
      },
      [url, {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      }] as [string, { method?: string; headers?: Record<string, string>; body?: string }],
    );

    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    });
  }

  /**
   * In attach mode: login is not needed — user already logged in.
   * In launch mode: open headed Chrome for login.
   */
  async startLogin(providerId: string, loginUrl: string, onComplete: (success: boolean, profile: string) => void): Promise<void> {
    // The profile the window actually opens on: it can change while a switch
    // releases the current browser, so report it to the caller.
    let loginProfile = this._profile.name;
    if (this._mode === 'attach') {
      // In attach mode, just open a new tab in the user's existing Chrome
      try {
        const ctx = await this.ensureBrowser();
        const page = await ctx.newPage();

        this._loginState = {
          providerId,
          status: 'waiting_for_user',
          message: `Opened ${loginUrl} in your Chrome. Log in and close the tab when done.`,
          startedAt: Date.now(),
        };

        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: this.opts.startupTimeout });

        // Wait for user to close the tab
        const waitDone = async () => {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              page.close().catch(() => {});
              resolve();
            }, this.opts.loginTimeout * 1000);

            page.on('close', () => {
              clearTimeout(timeout);
              resolve();
            });
          });

          this._loginState = {
            providerId,
            status: 'success',
            message: `Login completed for ${providerId}.`,
            startedAt: null,
          };
          onComplete(true, loginProfile);

          setTimeout(() => {
            if (this._loginState.status === 'success') {
              this._loginState = { providerId: null, status: 'idle', message: '', startedAt: null };
            }
          }, 10000);
        };

        waitDone().catch(() => {
          this._loginState = { providerId, status: 'failed', message: 'Login tab closed unexpectedly.', startedAt: null };
          onComplete(false, loginProfile);
        });

      } catch (err) {
        this._loginState = {
          providerId,
          status: 'failed',
          message: `Failed: ${(err as Error).message}`,
          startedAt: null,
        };
        onComplete(false, loginProfile);
      }
      return;
    }

    // Launch mode — same as before: open headed Chrome
    if (this._loginState.status === 'opening' || this._loginState.status === 'waiting_for_user') {
      throw new Error(`Login already in progress for ${this._loginState.providerId}.`);
    }

    this._loginState = { providerId, status: 'opening', message: 'Launching Chrome...', startedAt: Date.now() };

    try {
      // Intentional close, not a dead page: release() suppresses the close
      // event so login does not mark the profile down.
      await this.release();

      loginProfile = this._profile.name;
      const headedContext = await this.launch(false);

      const page: Page = await headedContext.newPage();

      // A window closing is not proof of a successful sign-in: track where the
      // page ended up so a closed login page is not reported as success.
      const loginPath = (() => {
        try { return new URL(loginUrl).pathname; } catch { return null; }
      })();
      const verifiable = loginPath !== null && loginPath !== '/';
      let lastPath = loginPath;
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        try { lastPath = new URL(frame.url()).pathname; } catch { /* keep last */ }
      });

      this._loginState = {
        providerId,
        status: 'waiting_for_user',
        message: `Browser window opened. Please log in at ${loginUrl}`,
        startedAt: Date.now(),
      };

      await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

      const waitForCompletion = async () => {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            page.close().catch(() => {});
            resolve();
          }, this.opts.loginTimeout * 1000);

          page.on('close', () => { clearTimeout(timeout); resolve(); });
          headedContext.on('close', () => { clearTimeout(timeout); resolve(); });
        });

        const completed = !verifiable || lastPath !== loginPath;
        await headedContext.close().catch(() => {});
        this.context = null;

        if (!completed) {
          this._loginState = {
            providerId,
            status: 'failed',
            message: 'Login window closed before sign-in completed. Try again and wait until the site leaves the login page.',
            startedAt: null,
          };
          onComplete(false, loginProfile);
          return;
        }

        this._loginState = { providerId, status: 'success', message: `Login completed for ${providerId}.`, startedAt: null };
        onComplete(true, loginProfile);

        setTimeout(() => {
          if (this._loginState.status === 'success') {
            this._loginState = { providerId: null, status: 'idle', message: '', startedAt: null };
          }
        }, 10000);
      };

      waitForCompletion().catch((err) => {
        this._loginState = { providerId, status: 'failed', message: `Login failed: ${(err as Error).message}`, startedAt: null };
        onComplete(false, loginProfile);
      });

    } catch (err) {
      this._loginState = { providerId, status: 'failed', message: `Failed: ${(err as Error).message}`, startedAt: null };
      onComplete(false, loginProfile);
    }
  }

  /**
   * Auto-detect which providers have valid cookies in the connected browser.
   * Returns a map of providerId → true for providers with cookies.
   */
  async autoDetectAuth(): Promise<Record<string, boolean>> {
    // Each provider's key session cookie that indicates a valid login
    const SESSION_COOKIES: Record<string, { domain: string; cookieNames: string[] }> = {
      'claude-web': { domain: 'claude.ai', cookieNames: ['sessionKey'] },
      'chatgpt-web': { domain: 'chatgpt.com', cookieNames: ['__Secure-next-auth.session-token', '__Secure-next-auth.session-token.0'] },
      'deepseek-web': { domain: 'deepseek.com', cookieNames: ['ds_session_id', 'token'] },
      'kimi-web': { domain: 'moonshot.cn', cookieNames: ['access_token'] },
      'qwen-web': { domain: 'qwen.ai', cookieNames: ['cna', 'ajs_anonymous_id'] },
      'glm-web': { domain: 'chatglm.cn', cookieNames: ['chatglm_refresh_token'] },
      'grok-web': { domain: 'grok.com', cookieNames: ['sso', 'ct0'] },
      'gemini-web': { domain: 'google.com', cookieNames: ['SID', '__Secure-1PSID'] },
      'perplexity-web': { domain: 'perplexity.ai', cookieNames: ['__Secure-next-auth.session-token', 'next-auth.session-token'] },
      'doubao-web': { domain: 'doubao.com', cookieNames: ['sessionid'] },
      'xiaomimo-web': { domain: 'xiaomimimo.com', cookieNames: ['sessionid', 'token'] },
    };

    const result: Record<string, boolean> = {};

    try {
      const ctx = await this.ensureBrowser();
      const cookies = await ctx.cookies();

      for (const [providerId, config] of Object.entries(SESSION_COOKIES)) {
        const domainCookies = cookies.filter(c => c.domain.includes(config.domain));
        // Check if any of the expected session cookies exist
        const hasSession = config.cookieNames.some(name =>
          domainCookies.some(c => c.name === name && c.value.length > 0)
        );
        result[providerId] = hasSession;
      }
    } catch {
      // Browser not available
    }

    return result;
  }

  getLoginState(): LoginState {
    return { ...this._loginState };
  }

  getMode(): BrowserMode {
    return this._mode;
  }

  getEngine(): BrowserEngine {
    return this._profile.engine;
  }

  getProfile(): ResolvedProfile {
    return { ...this._profile };
  }

  /**
   * Switch the active profile. Releases the current browser so the next
   * request starts the new profile. In attach mode this disconnects from the
   * user's Chrome without closing it; only the default profile may attach.
   */
  async activate(profile: ResolvedProfile): Promise<void> {
    if (profile.name === this._profile.name) return;

    const attachError = attachProfileError(profile, this._requestedMode);
    if (attachError) throw new Error(attachError);

    await this.release();
    this._profile = profile;
    this._mode = effectiveMode(profile.engine, this._requestedMode);
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    await this.release();
  }

  private async release(): Promise<void> {
    // Closing pages fires their own 'close' events; those must not mark the
    // profile down, since the next acquisition is already rebuilding it.
    this.releasing = true;
    try {
      this.domainPages.clear();
      if (this.browser) {
        // For a CDP connection this disconnects; the user's Chrome stays open.
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      if (this.context && this._mode !== 'attach') {
        await this.context.close().catch(() => {});
      }
      this.context = null;
      this._status = 'stopped';
    } finally {
      this.releasing = false;
    }
  }

  getStatus(): BrowserStatus {
    return this._status;
  }

  /**
   * Try to detect if Chrome is already running with remote debugging.
   */
  async detectCDP(cdpUrl?: string): Promise<boolean> {
    const url = cdpUrl ?? this.opts.cdpUrl ?? 'http://127.0.0.1:9222';
    try {
      const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private getChromeStartCommand(): string {
    const chromePath = findChromePath();
    const os = platform();

    if (os === 'darwin') {
      return `  # macOS:\n  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n\n  # Or create an alias in ~/.zshrc:\n  alias chrome-debug='/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222'`;
    }
    if (os === 'win32') {
      return `  # Windows (PowerShell):\n  & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222`;
    }
    // Linux
    const bin = chromePath ?? 'google-chrome';
    return `  # Linux:\n  ${bin} --remote-debugging-port=9222`;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.opts.idleShutdown > 0) {
      this.idleTimer = setTimeout(() => {
        this._status = 'idle';
        this.shutdown();
      }, this.opts.idleShutdown * 1000);
    }
  }

  private launch(headless: boolean): Promise<BrowserContext> {
    // Re-read the profile so a fallback or manifest change applies on the next
    // launch instead of sticking to the identity resolved at startup.
    let persisted: ResolvedProfile | undefined;
    try {
      persisted = this.opts.resolveProfile?.(this._profile.name);
    } catch {
      // A broken manifest must not turn a launch into a silent account
      // switch; keep the identity this manager already resolved.
    }
    if (persisted?.name === this._profile.name) this._profile = persisted;
    return this.resolveLauncher()({
      profileDir: this._profile.dir,
      headless,
      timeout: this.opts.startupTimeout,
    });
  }

  private resolveLauncher(engine: BrowserEngine = this._profile.engine): BrowserLauncher {
    return this.opts.launchers?.[engine] ?? defaultLaunchers[engine];
  }
}
