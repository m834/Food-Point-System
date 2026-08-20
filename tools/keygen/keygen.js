#!/usr/bin/env node
/**
 * Founder's office tool — issue a Food-Point license key.
 *
 *   npm run keygen -- --machine ABCDE-FGHIJ-KLMNO-PQRST             (1 year, default)
 *   npm run keygen -- --machine ABCDE-... --years 2                 (2 years)
 *   npm run keygen -- --machine ABCDE-... --expires 2027-06-30      (exact date)
 *   npm run keygen -- --machine ABCDE-... --lifetime                (never expires)
 *
 * A yearly key is the normal sale, so it is the DEFAULT: paste the customer's
 * Machine ID and you get a key that runs to the same date next year. Lifetime
 * has to be asked for explicitly, because issuing one by accident is the one
 * mistake here that cannot be walked back — the key is already with the
 * customer and there is no server to revoke it from.
 *
 * This script lives OUTSIDE the shipped app. It is the only thing that holds
 * the private key, and it is the only thing that can produce a valid key.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRIVATE = path.join(__dirname, 'private-key.pem');
const PRODUCT = 'food';
const KEY_PREFIX = 'CH1';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const machineId = arg('machine');
const expiresArg = arg('expires');
const yearsArg = arg('years');
const lifetime = process.argv.includes('--lifetime');

if (!machineId) {
  console.error(
    'Usage: npm run keygen -- --machine <MACHINE-ID> [--years N | --expires YYYY-MM-DD | --lifetime]',
  );
  process.exit(1);
}

if (expiresArg && !/^\d{4}-\d{2}-\d{2}$/.test(expiresArg)) {
  console.error('--expires must be YYYY-MM-DD.');
  process.exit(1);
}

if ([expiresArg, yearsArg, lifetime ? '1' : null].filter(Boolean).length > 1) {
  console.error('Choose one of --years, --expires or --lifetime, not several.');
  process.exit(1);
}

/**
 * The same calendar date N years on, minus one day, so a 1-year key issued on
 * 2026-08-20 runs to 2027-08-19 inclusive — a full year, not a year and a day.
 *
 * 29 February is the one date this has to think about: setFullYear on a leap
 * day lands on 1 March in a non-leap year, which would silently hand over an
 * extra day. Clamping back to 28 February keeps every key exactly a year.
 */
function addYears(years) {
  const start = new Date();
  const day = start.getDate();
  const month = start.getMonth();

  const end = new Date(start);
  end.setFullYear(start.getFullYear() + years);
  if (end.getMonth() !== month || end.getDate() !== day) end.setDate(0);

  end.setDate(end.getDate() - 1);
  return [
    end.getFullYear(),
    String(end.getMonth() + 1).padStart(2, '0'),
    String(end.getDate()).padStart(2, '0'),
  ].join('-');
}

let expires;
if (lifetime) {
  expires = null;
} else if (expiresArg) {
  expires = expiresArg;
} else {
  const years = Number(yearsArg ?? 1);
  if (!Number.isInteger(years) || years < 1 || years > 20) {
    console.error('--years must be a whole number between 1 and 20.');
    process.exit(1);
  }
  expires = addYears(years);
}

if (!fs.existsSync(PRIVATE)) {
  console.error('No private key found. Run `npm run keygen:init` first.');
  process.exit(1);
}

const payload = {
  m: machineId.trim().toUpperCase(),
  exp: expires ?? null,
  iss: new Date().toISOString().slice(0, 10),
  // Stamped inside the signature, so it cannot be edited into another product.
  p: PRODUCT,
};

const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf8');
const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIVATE));
const signature = crypto.sign(null, payloadRaw, privateKey);

const key = [KEY_PREFIX, b64url(payloadRaw), b64url(signature)].join('.');

console.log('');
console.log('  Product:  Food Point');
console.log(`  Machine:  ${payload.m}`);
console.log(`  Expires:  ${payload.exp ?? 'never (LIFETIME)'}`);
console.log(`  Issued:   ${payload.iss}`);
console.log('');
console.log('  License key:');
console.log('');
console.log(`  ${key}`);
console.log('');
