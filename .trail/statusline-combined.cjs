#!/usr/bin/env node
// Combina los status lines: lohari (global) + trail.
// Project settings ganan sobre global, así que el global statusline-combined.sh
// nunca corre en este repo; este script es el que sí se ejecuta.
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const run = (bin, args, extraEnv) => {
    try {
      return execFileSync(bin, args, {
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...extraEnv },
      }).trim();
    } catch {
      return '';
    }
  };

  const orig = run('bash', [path.join(os.homedir(), '.claude', 'statusline-command.sh')]);
  const trail = run('node', [path.join(__dirname, 'statusline.cjs')]);

  // trail emite 2 líneas; unirlas en una.
  const oneLine = (s) => s.replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  const parts = [orig, oneLine(trail)].filter(Boolean);
  process.stdout.write(parts.join(' │ ') + '\n');
});
