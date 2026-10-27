import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { platform, arch, release } from 'node:os';
import chalk from 'chalk';
import type { BrowserEngine } from './browser/manager.js';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

interface CamoufoxBinary {
  path: string;
  version: string;
}

interface DoctorOptions {
  engine?: BrowserEngine;
  nodeMajor?: number;
  findChrome?: () => string | undefined;
  findCamoufox?: () => Promise<CamoufoxBinary>;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<CheckResult[]> {
  const engine = opts.engine ?? 'chrome';
  const results: CheckResult[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = opts.nodeMajor ?? parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 20) {
    results.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion} ✓` });
  } else {
    results.push({
      name: 'Node.js',
      status: 'fail',
      message: `${nodeVersion} (requires >= 20)`,
      fix: 'Install Node.js 20+ from https://nodejs.org/',
    });
  }

  // 2. Platform info
  const os = platform();
  const archInfo = arch();
  results.push({
    name: 'Platform',
    status: 'ok',
    message: `${os} ${archInfo} (${release()})`,
  });

  // 3. Chrome detection
  const chromePath = (opts.findChrome ?? findChromePath)();
  if (chromePath) {
    let versionInfo = '';
    try {
      versionInfo = ' — ' + execSync(`"${chromePath}" --version`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Version detection failed, but Chrome exists
    }
    results.push({ name: 'Chrome', status: 'ok', message: `Found at ${chromePath}${versionInfo}` });
  } else if (engine === 'chrome') {
    results.push({
      name: 'Chrome',
      status: 'fail',
      message: 'Google Chrome not found',
      fix: os === 'win32'
        ? 'Install from https://www.google.com/chrome/'
        : os === 'darwin'
          ? 'Install: brew install --cask google-chrome'
          : 'Install: sudo apt install google-chrome-stable  OR  sudo dnf install google-chrome-stable',
    });
  }

  // 3b. Camoufox — requirements of the selected engine. Warnings only: the
  // doctor must never stop the bridge from starting.
  if (engine === 'camoufox') {
    try {
      const binary = await (opts.findCamoufox ?? findCamoufoxBinary)();
      results.push({
        name: 'Camoufox',
        status: 'ok',
        message: `${binary.version} at ${binary.path}`,
      });
    } catch (err) {
      results.push({
        name: 'Camoufox',
        status: 'warn',
        // The library auto-downloads on first launch; any other failure is
        // reported verbatim (unsupported version, missing package, ...).
        message: (err as Error).name === 'CamoufoxNotInstalled'
          ? 'Browser not downloaded yet (~300 MB); the first camoufox request fetches it'
          : (err as Error).message,
        fix: 'npx camoufox-js fetch',
      });
    }
    if (major < 22) {
      results.push({
        name: 'Node.js (Camoufox)',
        status: 'warn',
        message: `${nodeVersion} is too old for camoufox-js (requires >= 22)`,
        fix: 'Install Node.js 22+ from https://nodejs.org/',
      });
    }
  }

  // 4. Playwright-core — check via dynamic import
  try {
    await import('playwright-core');
    results.push({ name: 'playwright-core', status: 'ok', message: 'Installed ✓' });
  } catch {
    results.push({
      name: 'playwright-core',
      status: 'fail',
      message: 'Not installed',
      fix: 'Run: npm install playwright-core',
    });
  }

  // 5. Port availability
  results.push({ name: 'Default Port', status: 'ok', message: '3456 (will auto-find if busy)' });

  // 6. Data directory
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const stateDir = `${homeDir}/.webmodel`;
  results.push({
    name: 'Data Directory',
    status: 'ok',
    message: stateDir,
  });

  return results;
}

export function printDoctorResults(results: CheckResult[]): void {
  console.log('');
  console.log(chalk.bold('  web-model-bridge doctor'));
  console.log(chalk.gray('  ─────────────────────────'));
  console.log('');

  let hasFailure = false;
  let hasWarning = false;
  for (const r of results) {
    const icon = r.status === 'ok' ? chalk.green('✓')
      : r.status === 'warn' ? chalk.yellow('⚠')
      : chalk.red('✗');
    console.log(`  ${icon} ${chalk.bold(r.name)}: ${r.message}`);
    if (r.fix) {
      console.log(chalk.gray(`    Fix: ${r.fix}`));
    }
    if (r.status === 'fail') hasFailure = true;
    else if (r.status === 'warn') hasWarning = true;
  }

  console.log('');
  if (hasFailure) {
    console.log(chalk.yellow('  Some issues found. Fix them and try again.'));
  } else if (hasWarning) {
    console.log(chalk.yellow('  Some checks need attention, but the bridge can start.'));
  } else {
    console.log(chalk.green('  All checks passed! Ready to run.'));
  }
  console.log('');
}

export function findChromePath(): string | undefined {
  const os = platform();

  if (os === 'darwin') {
    const paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  if (os === 'linux') {
    const paths = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
    // Try which
    try {
      return execSync('which google-chrome || which chromium || which chromium-browser', {
        encoding: 'utf-8',
      }).trim();
    } catch {
      // Not found
    }
  }

  if (os === 'win32') {
    const paths = [
      `${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES']}\\Chromium\\Application\\chrome.exe`,
    ];
    for (const p of paths) {
      if (p && existsSync(p)) return p;
    }
  }

  return undefined;
}

/**
 * Locate the Camoufox executable without downloading it. The check lives deep
 * inside camoufox-js: `launchOptions()` would auto-install a ~300 MB build, so
 * the doctor must not use it.
 */
export async function findCamoufoxBinary(): Promise<CamoufoxBinary> {
  const pkgman = await import('camoufox-js/dist/pkgman.js' as string);
  return {
    path: String(pkgman.launchPath()),
    version: String(pkgman.installedVerStr()),
  };
}
