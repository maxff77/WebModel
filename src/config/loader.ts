import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { isBrowserEngine, type BrowserEngine } from '../browser/manager.js';

export interface BridgeConfig {
  server: {
    port: number;
    host: string;
    authToken: string | null;
    openDashboard: boolean;
  };
  browser: {
    /** Engine used to create the default profile on first run; the active profile's engine wins. */
    engine: BrowserEngine;
    /** Name of the active profile under `<stateDir>/profiles/`. */
    profile: string;
    /** Legacy Chrome profile dir, moved into profiles/default on first run. */
    profileDir: string;
    startupTimeout: number;
    idleShutdown: number;
    loginTimeout: number;
    /** Launch mode only: false shows the browser window while it serves requests. */
    headless: boolean;
    mode: 'attach' | 'launch';
    cdpUrl: string;
  };
  providers: {
    enabled: string[];
    /** Serves requests for a model no provider has; null answers them 400 invalid_model. */
    fallbackModel: string | null;
  };
  toolCalling: {
    enabled: boolean;
    language: 'auto' | 'zh' | 'en';
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file: string;
  };
}

export function defaultConfig(stateDir: string): BridgeConfig {
  return {
    server: {
      port: 3456,
      host: '127.0.0.1',
      authToken: null,
      openDashboard: true,
    },
    browser: {
      engine: 'chrome',
      profile: 'default',
      profileDir: join(stateDir, 'chrome-profile'),
      startupTimeout: 30000,
      idleShutdown: 300,
      loginTimeout: 120,
      headless: true,
      mode: 'attach',
      cdpUrl: 'http://127.0.0.1:9222',
    },
    providers: {
      enabled: [
        'claude-web', 'chatgpt-web', 'deepseek-web',
        'kimi-web', 'qwen-web', 'glm-web', 'grok-web',
        'gemini-web', 'perplexity-web', 'doubao-web', 'xiaomimo-web',
      ],
      fallbackModel: null,
    },
    toolCalling: {
      enabled: true,
      language: 'auto',
    },
    logging: {
      level: 'info',
      file: join(stateDir, 'logs', 'bridge.log'),
    },
  };
}

interface LoadOptions {
  stateDir: string;
  configFile?: string;
  port?: number;
  host?: string;
  authToken?: string;
  engine?: string;
  profile?: string;
  verbose?: boolean;
}

function asEngine(value: string | undefined): BrowserEngine | undefined {
  return isBrowserEngine(value) ? value : undefined;
}

export function loadConfig(opts: LoadOptions): BridgeConfig {
  const config = defaultConfig(opts.stateDir);

  const configPath = opts.configFile ?? join(opts.stateDir, 'config.yml');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw);
    if (parsed && typeof parsed === 'object') {
      mergeDeep(config as unknown as Record<string, unknown>, parsed as Record<string, unknown>);
    }
  } catch {
    // No config file or invalid YAML — use defaults
  }

  // Re-resolve paths relative to stateDir after YAML merge
  if (config.browser.profileDir === defaultConfig('__placeholder__').browser.profileDir) {
    config.browser.profileDir = join(opts.stateDir, 'chrome-profile');
  }
  if (config.logging.file === defaultConfig('__placeholder__').logging.file) {
    config.logging.file = join(opts.stateDir, 'logs', 'bridge.log');
  }

  // An invalid engine in YAML falls back to chrome. A bad CLI/env override is ignored.
  config.browser.engine = asEngine(config.browser.engine) ?? 'chrome';

  // CLI overrides
  if (opts.port !== undefined) config.server.port = opts.port;
  if (opts.host !== undefined) config.server.host = opts.host;
  if (opts.authToken !== undefined) config.server.authToken = opts.authToken;
  const cliEngine = asEngine(opts.engine);
  if (cliEngine) config.browser.engine = cliEngine;
  if (opts.profile) config.browser.profile = opts.profile;
  if (opts.verbose) config.logging.level = 'debug';

  // Environment variable overrides (Docker-friendly)
  if (process.env.WMB_PORT) config.server.port = parseInt(process.env.WMB_PORT, 10);
  if (process.env.WMB_HOST) config.server.host = process.env.WMB_HOST;
  if (process.env.WMB_AUTH_TOKEN) config.server.authToken = process.env.WMB_AUTH_TOKEN;
  if (process.env.WMB_LOG_LEVEL) config.logging.level = process.env.WMB_LOG_LEVEL as any;
  if (process.env.WMB_FALLBACK_MODEL) config.providers.fallbackModel = process.env.WMB_FALLBACK_MODEL;
  const envEngine = asEngine(process.env.WMB_BROWSER_ENGINE);
  if (envEngine) config.browser.engine = envEngine;
  if (process.env.WMB_PROFILE) config.browser.profile = process.env.WMB_PROFILE;
  if (process.env.WMB_HEADLESS) config.browser.headless = !/^(false|0)$/i.test(process.env.WMB_HEADLESS);
  if (process.env.WMB_STATE_DIR) {
    config.browser.profileDir = join(process.env.WMB_STATE_DIR, 'chrome-profile');
    config.logging.file = join(process.env.WMB_STATE_DIR, 'logs', 'bridge.log');
  }

  return config;
}

/** Persist the active profile, keeping every other setting in the YAML file. */
export function writeActiveProfile(opts: { stateDir: string; configFile?: string; profile: string }): void {
  const configPath = opts.configFile ?? join(opts.stateDir, 'config.yml');
  let doc: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = yaml.load(raw);
      } catch (err) {
        throw new Error(`Refusing to rewrite ${configPath}: ${(err as Error).message}`);
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        // Never replace a file we could not understand: its settings would be lost.
        throw new Error(`Refusing to rewrite ${configPath}: it is not a YAML mapping.`);
      }
      doc = parsed as Record<string, unknown>;
    }
  }
  const browser = doc.browser && typeof doc.browser === 'object' && !Array.isArray(doc.browser)
    ? doc.browser as Record<string, unknown>
    : {};
  browser.profile = opts.profile;
  doc.browser = browser;
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, yaml.dump(doc, { lineWidth: 120 }));
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      mergeDeep(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else if (srcVal !== undefined) {
      target[key] = srcVal;
    }
  }
}
