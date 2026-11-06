import { describe, it, expect, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../../helpers/test-server.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import { DEFAULT_PROFILE, ProfileStore } from '../../../src/profiles/store.js';
import type { ProfilesApi } from '../../../src/routes/management.js';

/** Real store on the test's temp stateDir, with the active name kept in memory. */
function profileApi(stateDir: string): ProfilesApi {
  const store = new ProfileStore(stateDir);
  let active = DEFAULT_PROFILE;
  let pool: string[] = [];
  return {
    list: () => store.list(),
    active: () => active,
    create: (name, engine) => store.create(name, engine),
    activate: async (name) => {
      const profile = store.resolve(name);
      active = profile.name;
      return profile;
    },
    delete: async (name) => store.delete(name),
    deepseekPool: () => pool,
    setDeepSeekPool: async (names) => {
      names.forEach(n => store.resolve(n));
      return (pool = names);
    },
  };
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('Management endpoints', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe('GET /webmodel/providers', () => {
    it('returns provider statuses', async () => {
      ctx = createTestContext({
        providers: [
          new MockProvider('claude-web', { authenticated: true }),
          new MockProvider('deepseek-web', { authenticated: false }),
        ],
      });
      const res = await ctx.app.request('/webmodel/providers');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.providers).toHaveLength(2);
      expect(body.providers.find((p: any) => p.id === 'claude-web').authenticated).toBe(true);
      expect(body.providers.find((p: any) => p.id === 'deepseek-web').authenticated).toBe(false);
    });
  });

  describe('GET /webmodel/health', () => {
    it('returns health status', async () => {
      ctx = createTestContext();
      const res = await ctx.app.request('/webmodel/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
      expect(body).toHaveProperty('uptime');
      expect(body).toHaveProperty('providers');
    });

    it('reports the active browser engine', async () => {
      ctx = createTestContext({ browserEngine: 'camoufox' });
      const res = await ctx.app.request('/webmodel/health');
      const body = await res.json();
      expect(body.browser.engine).toBe('camoufox');
    });

    it('reports chrome when no engine is wired', async () => {
      ctx = createTestContext();
      const res = await ctx.app.request('/webmodel/health');
      const body = await res.json();
      expect(body.browser.engine).toBe('chrome');
    });

    it('reports the active profile', async () => {
      ctx = createTestContext({ profiles: profileApi });
      const res = await ctx.app.request('/webmodel/health');
      const body = await res.json();
      expect(body.browser.profile).toBe('default');
    });

    it('reports the live browsers of the turn and their cap', async () => {
      ctx = createTestContext({ browserPool: { live: 2, max: 3 } });
      const res = await ctx.app.request('/webmodel/health');
      const body = await res.json();
      expect(body.browser.liveBrowsers).toBe(2);
      expect(body.browser.maxLiveBrowsers).toBe(3);
    });
  });

  describe('profiles', () => {
    it('creates a profile and lists it with the active one', async () => {
      ctx = createTestContext({ profiles: profileApi });

      const created = await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'chrome' }));
      expect(created.status).toBe(201);
      expect((await created.json()).profile).toMatchObject({ name: 'work', engine: 'chrome' });

      const res = await ctx.app.request('/webmodel/profiles');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        active: 'default',
        profiles: [{ name: 'work', engine: 'chrome', createdAt: expect.any(String) }],
        deepseekPool: [],
      });
    });

    it('refuses to change a profile engine (duplicate name)', async () => {
      ctx = createTestContext({ profiles: profileApi });
      await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'chrome' }));

      const res = await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'camoufox' }));

      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/already exists/);
    });

    it('rejects an invalid profile name and engine', async () => {
      ctx = createTestContext({ profiles: profileApi });

      const badName = await ctx.app.request('/webmodel/profiles', json({ name: 'my profile', engine: 'chrome' }));
      expect(badName.status).toBe(400);

      const badEngine = await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'firefox' }));
      expect(badEngine.status).toBe(400);
    });

    it('selects the active profile', async () => {
      ctx = createTestContext({ profiles: profileApi });
      await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'chrome' }));

      const res = await ctx.app.request('/webmodel/profiles/active', json({ name: 'work' }));
      expect(res.status).toBe(200);
      expect((await res.json()).active).toBe('work');

      const listed = await (await ctx.app.request('/webmodel/profiles')).json();
      expect(listed.active).toBe('work');
    });

    it('reports an unknown profile as 404', async () => {
      ctx = createTestContext({ profiles: profileApi });

      const res = await ctx.app.request('/webmodel/profiles/active', json({ name: 'ghost' }));

      expect(res.status).toBe(404);
      expect((await res.json()).message).toMatch(/Unknown profile "ghost"/);
    });

    it('rejects a switch the manager refuses (attach only serves default)', async () => {
      ctx = createTestContext({
        profiles: (stateDir) => ({
          ...profileApi(stateDir),
          activate: async () => {
            throw new Error('Attach mode uses your own Chrome, which is only available to the "default" profile.');
          },
        }),
      });

      const res = await ctx.app.request('/webmodel/profiles/active', json({ name: 'work' }));

      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/only available to the "default" profile/);
    });

    it('deletes a profile', async () => {
      ctx = createTestContext({ profiles: profileApi });
      await ctx.app.request('/webmodel/profiles', json({ name: 'work', engine: 'chrome' }));

      const res = await ctx.app.request('/webmodel/profiles/work', { method: 'DELETE' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: 'work' });
      const listed = await (await ctx.app.request('/webmodel/profiles')).json();
      expect(listed.profiles).toEqual([]);
    });

    it('reports deleting an unknown profile as 404', async () => {
      ctx = createTestContext({ profiles: profileApi });

      const res = await ctx.app.request('/webmodel/profiles/ghost', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });

    it('refuses to delete the profile in use', async () => {
      ctx = createTestContext({
        profiles: (stateDir) => ({
          ...profileApi(stateDir),
          delete: async () => {
            throw new Error('"work" is the profile in use; switch to another one first.');
          },
        }),
      });

      const res = await ctx.app.request('/webmodel/profiles/work', { method: 'DELETE' });

      expect(res.status).toBe(409);
      expect((await res.json()).message).toMatch(/profile in use/);
    });

    it('sets the DeepSeek turn and lists it', async () => {
      ctx = createTestContext({ profiles: profileApi });
      await ctx.app.request('/webmodel/profiles', json({ name: 'a', engine: 'chrome' }));
      await ctx.app.request('/webmodel/profiles', json({ name: 'b', engine: 'chrome' }));

      const res = await ctx.app.request('/webmodel/profiles/deepseek-pool', json({ names: ['a', 'b'] }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deepseekPool: ['a', 'b'] });
      expect((await (await ctx.app.request('/webmodel/profiles')).json()).deepseekPool).toEqual(['a', 'b']);
    });

    it('refuses a DeepSeek turn that is not a list of distinct names, or names a missing profile', async () => {
      ctx = createTestContext({ profiles: profileApi });
      await ctx.app.request('/webmodel/profiles', json({ name: 'a', engine: 'chrome' }));

      for (const names of ['a', ['a', 'a'], [1], ['']]) {
        expect((await ctx.app.request('/webmodel/profiles/deepseek-pool', json({ names }))).status).toBe(400);
      }
      expect((await ctx.app.request('/webmodel/profiles/deepseek-pool', json({ names: ['ghost'] }))).status).toBe(404);
    });

    it('returns 503 when profiles are not wired', async () => {
      ctx = createTestContext();

      expect((await ctx.app.request('/webmodel/profiles')).status).toBe(503);
    });
  });
});
