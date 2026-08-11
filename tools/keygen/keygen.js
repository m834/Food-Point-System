#!/usr/bin/env node
/**
 * Founder's office tool — issue a Food-Point license key.
 *
 *   npm run keygen -- --machine ABCDE-FGHIJ-KLMNO-PQRST            (lifetime)
 *   npm run keygen -- --machine ABCDE-... --expires 2027-06-30     (time-limited)
 *
 * Both are supported because both are sold: a lifetime key and a yearly one.
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
const expires = arg('expires');

if (!machineId) {
  console.error('Usage: npm run keygen -- --machine <MACHINE-ID> [--expires YYYY-MM-DD]');
  process.exit(1);
}

if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
  console.error('--expires must be YYYY-MM-DD.');
  process.exit(1);
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
console.log(`  Expires:  ${payload.exp ?? 'never (lifetime)'}`);
console.log(`  Issued:   ${payload.iss}`);
console.log('');
console.log('  License key:');
console.log('');
console.log(`  ${key}`);
console.log('');
