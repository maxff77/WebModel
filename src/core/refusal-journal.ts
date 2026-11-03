import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PoolRefusal } from './pool.js';

/** Appends one JSON line per refusal; the watchdog reads the pool's decisions from it. */
export function createRefusalJournal(file: string): (refusal: PoolRefusal) => void {
  return (refusal) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(refusal)}\n`);
    } catch (err) {
      // Journaling is best effort: a full or unwritable disk must not fail the call.
      console.error(`[refusals] ${new Date().toISOString()} could not write ${file}: ${(err as Error).message}`);
    }
  };
}
