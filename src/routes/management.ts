import { Hono, type Context } from 'hono';
import { ProviderRegistry } from '../core/registry.js';
import { AuthStore } from '../auth/store.js';
import type { BrowserEngine, BrowserStatus, LoginState } from '../browser/manager.js';
import { isBrowserEngine } from '../browser/manager.js';
import type { MetricsCollector } from '../core/metrics.js';
import { DEFAULT_PROFILE, FINGERPRINT_COOKIE_WARNING, ProfileError, type ProfileManifest, type ResolvedProfile } from '../profiles/store.js';

export interface ProfilesApi {
  list: () => ProfileManifest[];
  active: () => string;
  create: (name: string, engine: BrowserEngine) => Promise<ProfileManifest>;
  activate: (name: string) => Promise<ProfileManifest>;
  regenerateFingerprint: (name: string) => Promise<ResolvedProfile>;
}

export interface ManagementDeps {
  registry: ProviderRegistry;
  authStore: AuthStore;
  onLogin?: (providerId: string) => Promise<{ status: string; message: string }>;
  getLoginState?: () => LoginState;
  getBrowserStatus?: () => BrowserStatus;
  getBrowserEngine?: () => BrowserEngine;
  profiles?: ProfilesApi;
  startTime?: number;
  metrics?: MetricsCollector;
}

async function readJson<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}

export function managementRoutes(deps: ManagementDeps): Hono {
  const { registry, authStore, onLogin } = deps;
  const routeStartTime = deps.startTime ?? Date.now();
  const app = new Hono();

  app.get('/webmodel/providers', async (c) => {
    const statuses = await registry.providerStatus();
    return c.json({ providers: statuses });
  });

  app.post('/webmodel/auth/login', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const provider = registry.getProvider(body.providerId);
    if (!provider) {
      return c.json({ error: 'Unknown provider', message: `Provider "${body.providerId}" not found.` }, 404);
    }

    if (!onLogin) {
      return c.json({
        error: 'Browser not available',
        message: 'Browser manager is not configured. Restart the server.',
      }, 503);
    }

    try {
      // This returns immediately — login happens in background
      const result = await onLogin(body.providerId);
      return c.json(result);
    } catch (err) {
      return c.json({
        status: 'error',
        message: (err as Error).message,
      }, 500);
    }
  });

  // New: poll login progress
  app.get('/webmodel/auth/login-status', async (c) => {
    if (!deps.getLoginState) {
      return c.json({ providerId: null, status: 'idle', message: '' });
    }
    return c.json(deps.getLoginState());
  });

  app.post('/webmodel/auth/check', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const status = authStore.getStatus(body.providerId);
    return c.json(status);
  });

  app.post('/webmodel/auth/logout', async (c) => {
    let body: { providerId: string };
    try {
      body = await c.req.json<{ providerId: string }>();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    authStore.clearStatus(body.providerId);
    return c.json({ status: 'logged_out', providerId: body.providerId });
  });

  app.get('/webmodel/health', async (c) => {
    const statuses = await registry.providerStatus();
    const browserStatus = deps.getBrowserStatus ? deps.getBrowserStatus() : 'stopped';
    return c.json({
      status: 'healthy',
      uptime: Math.floor((Date.now() - routeStartTime) / 1000),
      browser: {
        status: browserStatus,
        engine: deps.getBrowserEngine?.() ?? 'chrome',
        profile: deps.profiles?.active() ?? DEFAULT_PROFILE,
      },
      providers: Object.fromEntries(
        statuses.map(s => [s.id, { authenticated: s.authenticated, models: s.modelCount }])
      ),
    });
  });

  app.get('/webmodel/profiles', async (c) => {
    if (!deps.profiles) return c.json({ error: 'Profiles not available' }, 503);
    return c.json({
      active: deps.profiles.active(),
      profiles: deps.profiles.list(),
      warning: FINGERPRINT_COOKIE_WARNING,
    });
  });

  app.post('/webmodel/profiles', async (c) => {
    if (!deps.profiles) return c.json({ error: 'Profiles not available' }, 503);
    const body = await readJson<{ name?: unknown; engine?: unknown }>(c);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
    const engine = body.engine;
    if (!isBrowserEngine(engine)) {
      return c.json({ error: 'Invalid engine', message: 'Engine must be "chrome" or "camoufox".' }, 400);
    }
    const name = typeof body.name === 'string' ? body.name : '';
    try {
      const profile = await deps.profiles.create(name, engine);
      return c.json({ profile }, 201);
    } catch (err) {
      if (err instanceof ProfileError) {
        const status = err.code === 'exists' ? 409 : 400;
        const error = err.code === 'exists' ? 'Profile already exists' : 'Invalid profile';
        return c.json({ error, message: err.message }, status);
      }
      return c.json({ error: 'Could not create the profile', message: (err as Error).message }, 500);
    }
  });

  app.post('/webmodel/profiles/fingerprint', async (c) => {
    if (!deps.profiles) return c.json({ error: 'Profiles not available' }, 503);
    const body = await readJson<{ name?: unknown }>(c);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
    const name = typeof body.name === 'string' ? body.name : '';
    try {
      const profile = await deps.profiles.regenerateFingerprint(name);
      return c.json({ profile, warning: FINGERPRINT_COOKIE_WARNING });
    } catch (err) {
      if (err instanceof ProfileError) {
        const notFound = err.code === 'not_found';
        return c.json({
          error: notFound ? 'Unknown profile' : 'Cannot regenerate fingerprint',
          message: err.message,
        }, notFound ? 404 : 400);
      }
      return c.json({ error: 'Could not regenerate the fingerprint', message: (err as Error).message }, 500);
    }
  });

  app.post('/webmodel/profiles/active', async (c) => {
    if (!deps.profiles) return c.json({ error: 'Profiles not available' }, 503);
    const body = await readJson<{ name?: unknown }>(c);
    if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
    const name = typeof body.name === 'string' ? body.name : '';
    try {
      const profile = await deps.profiles.activate(name);
      return c.json({ active: profile.name, profile });
    } catch (err) {
      if (err instanceof ProfileError && err.code === 'not_found') {
        return c.json({ error: 'Unknown profile', message: err.message }, 404);
      }
      // The manager refused the switch (e.g. attach only serves the default profile).
      return c.json({ error: 'Profile switch refused', message: (err as Error).message }, 409);
    }
  });

  app.get('/webmodel/metrics', async (c) => {
    if (!deps.metrics) return c.json({ error: 'Metrics not available' }, 503);
    return c.json(deps.metrics.getSummary());
  });

  app.get('/webmodel/logs', async (c) => {
    if (!deps.metrics) return c.json({ error: 'Metrics not available' }, 503);
    const count = parseInt(c.req.query('count') ?? '50', 10);
    return c.json({ logs: deps.metrics.getRecent(count) });
  });

  return app;
}
