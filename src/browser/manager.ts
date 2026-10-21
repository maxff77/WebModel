import type { Browser, BrowserContext, Page } from 'playwright-core';
import { findChromePath } from '../doctor.js';
import { platform } from 'node:os';
import { DEFAULT_PROFILE, type ResolvedProfile } from '../profiles/store.js';

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
  /** Persisted profile fingerprint; Camoufox uses it instead of generating one. */
  fingerprint?: unknown;
}

export type BrowserLauncher = (options: BrowserLaunchOptions) => Promise<BrowserContext>;

/** Attach-mode seam, injected in tests instead of dialing a real CDP endpoint. */
export type CdpConnector = (cdpUrl: string, timeout: number) => Promise<Browser>;

export type BrowserEngine = 'chrome' | 'camoufox';

/** The manager only needs the identity, engine, data dir and fingerprint of a profile. */
export type ActiveProfile = Pick<ResolvedProfile, 'name' | 'engine' | 'dir' | 'fingerprint'>;

export function isBrowserEngine(value: unknown): value is BrowserEngine {
  return value === 'chrome' || value === 'camoufox';
}

/** Camoufox is Firefox: there is no CDP to attach to, so it always launches. */
export function effectiveMode(engine: BrowserEngine, mode: BrowserMode): BrowserMode {
  return engine === 'camoufox' ? 'launch' : mode;
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
  cdpUrl?: string;        // e.g. "http://127.0.0.1:9222"
  mode?: BrowserMode;     // "attach" (default) | "launch"
  launchers?: Partial<Record<BrowserEngine, BrowserLauncher>>;
  connect?: CdpConnector;
}

const CHROME_ARGS = ['--no-first-run', '--no-default-browser-check'];

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
    return await Camoufox({
      user_data_dir: options.profileDir,
      headless: options.headless,
      timeout: options.timeout,
      fingerprint: options.fingerprint,
    });
  } catch (err) {
    throw new Error(
      `Camoufox could not start: ${(err as Error).message}\n\n` +
      'If the browser binary is missing, download it with: npx camoufox-js fetch',
    );
  }
}

const defaultLaunchers: Record<BrowserEngine, BrowserLauncher> = {
  chrome: launchChromeContext,
  camoufox: launchCamoufoxContext,
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
    this.context = await this.launch(true);

    this._status = 'running';
    this.resetIdleTimer();
    return this.context;
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
  async startLogin(providerId: string, loginUrl: string, onComplete: (success: boolean) => void): Promise<void> {
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
          onComplete(true);

          setTimeout(() => {
            if (this._loginState.status === 'success') {
              this._loginState = { providerId: null, status: 'idle', message: '', startedAt: null };
            }
          }, 10000);
        };

        waitDone().catch(() => {
          this._loginState = { providerId, status: 'failed', message: 'Login tab closed unexpectedly.', startedAt: null };
          onComplete(false);
        });

      } catch (err) {
        this._loginState = {
          providerId,
          status: 'failed',
          message: `Failed: ${(err as Error).message}`,
          startedAt: null,
        };
        onComplete(false);
      }
      return;
    }

    // Launch mode — same as before: open headed Chrome
    if (this._loginState.status === 'opening' || this._loginState.status === 'waiting_for_user') {
      throw new Error(`Login already in progress for ${this._loginState.providerId}.`);
    }

    this._loginState = { providerId, status: 'opening', message: 'Launching Chrome...', startedAt: Date.now() };

    try {
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }

      const headedContext = await this.launch(false);

      const page: Page = await headedContext.newPage();

      this._loginState = {
        providerId,
        status: 'waiting_for_user',
        message: `Chrome window opened. Please log in at ${loginUrl}`,
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

        await headedContext.close().catch(() => {});
        this.context = null;

        this._loginState = { providerId, status: 'success', message: `Login completed for ${providerId}.`, startedAt: null };
        onComplete(true);

        setTimeout(() => {
          if (this._loginState.status === 'success') {
            this._loginState = { providerId: null, status: 'idle', message: '', startedAt: null };
          }
        }, 10000);
      };

      waitForCompletion().catch((err) => {
        this._loginState = { providerId, status: 'failed', message: `Login failed: ${(err as Error).message}`, startedAt: null };
        onComplete(false);
      });

    } catch (err) {
      this._loginState = { providerId, status: 'failed', message: `Failed: ${(err as Error).message}`, startedAt: null };
      onComplete(false);
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
    return this.resolveLauncher()({
      profileDir: this._profile.dir,
      headless,
      timeout: this.opts.startupTimeout,
      fingerprint: this._profile.fingerprint,
    });
  }

  private resolveLauncher(engine: BrowserEngine = this._profile.engine): BrowserLauncher {
    return this.opts.launchers?.[engine] ?? defaultLaunchers[engine];
  }
}
