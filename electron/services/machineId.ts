import crypto from 'node:crypto';
import os from 'node:os';

let cached: string | null = null;

/**
 * A stable fingerprint for this computer, shown to the owner so they can read
 * it to the office over the phone. On Windows `node-machine-id` reads the
 * registry MachineGuid: it survives reboots and app reinstalls but differs on
 * every other machine, which is exactly what the node-lock needs (spec §7).
 */
export function getMachineId(): string {
  if (cached) return cached;

  let raw: string;
  try {
    // Required lazily so a missing optional native dep cannot stop the app booting.
    const { machineIdSync } = require('node-machine-id') as typeof import('node-machine-id');
    // `true` = the original, unhashed hardware id.
    raw = machineIdSync(true);
  } catch {
    // Last resort, so the app still runs and can still be licensed.
    raw = `${os.hostname()}|${os.arch()}|${os.cpus()[0]?.model ?? 'cpu'}`;
  }

  const digest = crypto
    .createHash('sha256')
    .update(`CodeHustlers|food|${raw}|${os.platform()}`)
    .digest('hex')
    .toUpperCase();

  // 20 hex chars in four groups — short enough to read aloud without mistakes.
  cached = digest.slice(0, 20).match(/.{1,5}/g)!.join('-');
  return cached;
}
