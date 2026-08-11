/**
 * The Food-Point verification key.
 *
 * PUBLIC half only. It can check that the founder's office signed a key; it
 * cannot produce one. The matching private key lives in the office
 * (tools/keygen/private-key.pem, gitignored) and never ships.
 *
 * If this file is ever replaced with a keypair the customer controls, the
 * whole anti-copy design is gone — there is deliberately no other code path in
 * the app that mints a valid key.
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAELDsMtjf7MHr0u2+zrP/hNc4qzagibRlul/kjukw+UQ=
-----END PUBLIC KEY-----`;
