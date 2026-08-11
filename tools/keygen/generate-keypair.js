#!/usr/bin/env node
/**
 * Founder's office tool — run ONCE to create the Food-Point signing keypair.
 *
 *   npm run keygen:init
 *
 * The private key signs license keys and must never leave the office; it is
 * gitignored. The public key is committed and baked into the shipped app,
 * which is why the app can verify a key but can never mint one.
 *
 * This keypair is separate from the Shop and Pharmacy keypairs. Together with
 * the `p: "food"` field inside the signed payload, that means a key issued for
 * another product cannot activate this app even by accident.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const PRIVATE = path.join(DIR, 'private-key.pem');
const PUBLIC = path.join(DIR, 'public-key.pem');

if (fs.existsSync(PRIVATE)) {
  console.error('A private key already exists here. Refusing to overwrite it.');
  console.error('Every license ever issued was signed with it — regenerating would');
  console.error('invalidate all of them. Delete it by hand only if you truly mean to.');
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

fs.writeFileSync(PRIVATE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(PUBLIC, publicKey.export({ type: 'spki', format: 'pem' }));

console.log('Food-Point signing keypair created.');
console.log(`  private: ${PRIVATE}   (office only — never commit, never ship)`);
console.log(`  public:  ${PUBLIC}    (committed, embedded in the app)`);
console.log('');
console.log('Next: copy the public key into electron/license/publicKey.ts.');
