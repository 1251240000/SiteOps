import { describe, expect, it } from 'vitest';

import { AlertCipher } from '../cipher.js';

const KEY_HEX = 'a'.repeat(64);

describe('AlertCipher', () => {
  it('round-trips simple strings', () => {
    const c = new AlertCipher(KEY_HEX);
    const enc = c.encrypt('hello');
    expect(enc).not.toBe('hello');
    expect(c.decrypt(enc)).toBe('hello');
  });

  it('round-trips objects', () => {
    const c = new AlertCipher(KEY_HEX);
    const enc = c.encryptObject({ token: 'abc', recipients: ['x'] });
    const dec = c.decryptObject<{ token: string }>(enc);
    expect(dec.token).toBe('abc');
  });

  it('produces a different ciphertext for the same plaintext (IV randomness)', () => {
    const c = new AlertCipher(KEY_HEX);
    const a = c.encrypt('payload');
    const b = c.encrypt('payload');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe(c.decrypt(b));
  });

  it('rejects tampered ciphertext', () => {
    const c = new AlertCipher(KEY_HEX);
    const enc = c.encrypt('secret');
    // flip the last char of the ciphertext segment
    const parts = enc.split(':');
    const ct = parts[3]!;
    parts[3] = `${ct.slice(0, -1)}${ct.endsWith('A') ? 'B' : 'A'}`;
    expect(() => c.decrypt(parts.join(':'))).toThrow();
  });

  it('accepts base64 keys', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    const c1 = new AlertCipher(b64);
    const enc = c1.encrypt('value');
    const c2 = new AlertCipher(b64);
    expect(c2.decrypt(enc)).toBe('value');
  });

  it('derives via PBKDF2 for short passphrases', () => {
    const c = new AlertCipher('a short passphrase');
    expect(c.decrypt(c.encrypt('value'))).toBe('value');
  });
});
