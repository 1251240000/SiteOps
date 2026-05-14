/**
 * AES-256-GCM cipher for alert channel configs.
 *
 * Key sourcing: the caller passes a `keyMaterial` string (typically
 * `process.env.ALERT_CIPHER_KEY`). Accepted formats:
 *   - 64 hex chars (32 bytes)
 *   - base64 of 32 raw bytes
 *   - any other string → derived via PBKDF2 (sha256, 100k iters, fixed salt)
 *
 * Output format: `v1:<iv-base64>:<tag-base64>:<ciphertext-base64>`. The
 * version prefix lets us migrate algorithms in future without losing the
 * ability to decrypt old rows.
 */
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

const PREFIX = 'v1';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const PBKDF2_ITER = 100_000;
const PBKDF2_SALT = Buffer.from('siteops/alerts/cipher/v1');

function toKey(material: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, 'hex');
  }
  // 32 raw bytes base64-encoded is 44 chars including the trailing `=`.
  if (/^[A-Za-z0-9+/=]+$/.test(material)) {
    const buf = Buffer.from(material, 'base64');
    if (buf.length === KEY_LEN) return buf;
  }
  return pbkdf2Sync(material, PBKDF2_SALT, PBKDF2_ITER, KEY_LEN, 'sha256');
}

export class AlertCipher {
  private readonly key: Buffer;

  constructor(keyMaterial: string) {
    if (!keyMaterial) throw new Error('AlertCipher: empty key material');
    this.key = toKey(keyMaterial);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv) as CipherGCM;
    const out = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString('base64'), tag.toString('base64'), out.toString('base64')].join(
      ':',
    );
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith(`${PREFIX}:`)) {
      throw new Error('AlertCipher: unsupported ciphertext version');
    }
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new Error('AlertCipher: malformed ciphertext');
    }
    const [, ivStr, tagStr, dataStr] = parts;
    const iv = Buffer.from(ivStr!, 'base64');
    const tag = Buffer.from(tagStr!, 'base64');
    const data = Buffer.from(dataStr!, 'base64');
    if (iv.length !== IV_LEN) throw new Error('AlertCipher: bad iv length');
    if (tag.length !== TAG_LEN) throw new Error('AlertCipher: bad tag length');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return out.toString('utf8');
  }

  encryptObject(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptObject<T = unknown>(ciphertext: string): T {
    return JSON.parse(this.decrypt(ciphertext)) as T;
  }
}

let singleton: AlertCipher | undefined;

/** Returns a cached `AlertCipher` keyed off the supplied material. */
export function getAlertCipher(keyMaterial: string): AlertCipher {
  if (!singleton) singleton = new AlertCipher(keyMaterial);
  return singleton;
}

/** Test-only: discard the cached cipher so a different key can be used. */
export function __resetAlertCipherForTests(): void {
  singleton = undefined;
}
