import { describe, it, expect, vi } from 'vitest';
import { runDoctor, findChromePath, findCamoufoxBinary, printDoctorResults } from '../../src/doctor.js';

describe('Doctor', () => {
  it('returns array of check results', async () => {
    const results = await runDoctor();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(5);
  });

  it('each result has required fields', async () => {
    const results = await runDoctor();
    for (const r of results) {
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('message');
      expect(['ok', 'warn', 'fail']).toContain(r.status);
    }
  });

  it('Node.js check passes (we are running on Node)', async () => {
    const results = await runDoctor();
    const nodeCheck = results.find(r => r.name === 'Node.js');
    expect(nodeCheck?.status).toBe('ok');
  });

  it('Platform check passes', async () => {
    const results = await runDoctor();
    const platformCheck = results.find(r => r.name === 'Platform');
    expect(platformCheck?.status).toBe('ok');
  });

  it('playwright-core check passes (installed in this project)', async () => {
    const results = await runDoctor();
    const pwCheck = results.find(r => r.name === 'playwright-core');
    expect(pwCheck?.status).toBe('ok');
  });

  it('findChromePath returns string or undefined', () => {
    const path = findChromePath();
    expect(path === undefined || typeof path === 'string').toBe(true);
  });
});

describe('Doctor with the camoufox engine', () => {
  const noCamoufox = async () => {
    throw Object.assign(new Error('Camoufox is not installed at /fake.'), { name: 'CamoufoxNotInstalled' });
  };
  const chrome = () => '/fake/chrome';

  it('checks the Camoufox binary and warns (never fails) when it is missing', async () => {
    const results = await runDoctor({ engine: 'camoufox', findChrome: chrome, findCamoufox: noCamoufox });
    const check = results.find(r => r.name === 'Camoufox');
    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('first camoufox request');
    expect(check?.fix).toContain('npx camoufox-js fetch');
  });

  it('surfaces other library failures verbatim', async () => {
    const results = await runDoctor({
      engine: 'camoufox',
      findChrome: chrome,
      findCamoufox: async () => {
        throw Object.assign(new Error('Camoufox v147 is not supported by this library'), { name: 'UnsupportedVersion' });
      },
    });
    const check = results.find(r => r.name === 'Camoufox');
    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('not supported');
  });

  it('does not fail on a machine without Chrome when the engine is camoufox', async () => {
    const results = await runDoctor({
      engine: 'camoufox',
      findChrome: () => undefined,
      findCamoufox: noCamoufox,
    });
    expect(results.find(r => r.name === 'Chrome')?.status).not.toBe('fail');
    expect(results.some(r => r.status === 'fail')).toBe(false);
  });

  it('reports the binary path and version when it is installed', async () => {
    const results = await runDoctor({
      engine: 'camoufox',
      findChrome: chrome,
      findCamoufox: async () => ({ path: '/fake/camoufox-bin', version: '152.0.4-beta.30' }),
    });
    const check = results.find(r => r.name === 'Camoufox');
    expect(check?.status).toBe('ok');
    expect(check?.message).toContain('/fake/camoufox-bin');
    expect(check?.message).toContain('152.0.4-beta.30');
  });

  it('warns when Node is too old for camoufox-js', async () => {
    const results = await runDoctor({
      engine: 'camoufox',
      findChrome: chrome,
      findCamoufox: async () => ({ path: '/fake/camoufox-bin', version: '152.0.4-beta.30' }),
      nodeMajor: 20,
    });
    const check = results.find(r => r.name === 'Node.js (Camoufox)');
    expect(check?.status).toBe('warn');
    expect(check?.message).toContain('22');
  });

  it('still fails on a machine without Chrome when the engine is chrome', async () => {
    const results = await runDoctor({ engine: 'chrome', findChrome: () => undefined });
    expect(results.find(r => r.name === 'Chrome')?.status).toBe('fail');
  });

  it('omits the Camoufox check when the engine is chrome', async () => {
    const results = await runDoctor({ findChrome: chrome });
    expect(results.find(r => r.name === 'Camoufox')).toBeUndefined();
  });
});

describe('Doctor output', () => {
  function capture(results: Parameters<typeof printDoctorResults>[0]): string {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printDoctorResults(results);
    const out = log.mock.calls.flat().join('\n');
    log.mockRestore();
    return out;
  }

  it('does not call a warning a failure', () => {
    const out = capture([{ name: 'Camoufox', status: 'warn', message: 'not ready', fix: 'npx camoufox-js fetch' }]);
    expect(out).toContain('bridge can start');
    expect(out).not.toContain('Fix them and try again');
  });

  it('reports failure when a check fails', () => {
    const out = capture([{ name: 'Chrome', status: 'fail', message: 'missing', fix: 'install it' }]);
    expect(out).toContain('Fix them and try again');
  });
});

describe('findCamoufoxBinary', () => {
  it('finds the binary or reports why it cannot', async () => {
    try {
      const bin = await findCamoufoxBinary();
      expect(typeof bin.path).toBe('string');
      expect(typeof bin.version).toBe('string');
    } catch (err) {
      expect((err as Error).message.length).toBeGreaterThan(0);
    }
  });
});
