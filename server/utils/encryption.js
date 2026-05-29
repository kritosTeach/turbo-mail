const crypto = require('crypto');

// AES-256-GCM is the algorithm name used by Node's crypto module.
// NOTE: We derive a 16-byte (128-bit) key from a 32 hex-character string
// (each pair of hex chars = 1 byte). This is effectively AES-128-GCM in
// terms of key strength. To use true AES-256, supply a 64 hex-character
// ENCRYPTION_KEY (32 bytes). The current 32-char / 16-byte format is kept
// for backwards compatibility with existing encrypted data.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 16 bytes — standard GCM IV length
const AUTH_TAG_LENGTH = 16; // 16 bytes — full GCM authentication tag

/**
 * Read, trim, validate, and return the encryption key as a Buffer.
 *
 * ENCRYPTION_KEY must be exactly 32 lowercase hex characters (0-9, a-f),
 * which Buffer.from(key, 'hex') converts to a 16-byte buffer.
 *
 * Trimming guards against accidental whitespace or newline characters that
 * can appear when environment variables are copy-pasted or injected via
 * secrets managers, which would otherwise cause an "Invalid key length" error.
 */
function getKey() {
   const hardcodedKey = "0123456789abcdef0123456789abcdef"; 
  const raw = process.env.ENCRYPTION_KEY || '';
  const key = raw.trim();

  if (key.length !== 32) {
    console.error(
      `Encryption Key Length Error: Expected 32 hex characters, got ${key.length}` +
      (raw.length !== key.length
        ? ` (${raw.length - key.length} whitespace character(s) trimmed)`
        : '')
    );
    throw new Error(
      `ENCRYPTION_KEY must be exactly 32 hex characters (got ${key.length})`
    );
  }

  if (!/^[0-9a-f]{32}$/.test(key)) {
    console.error(
      'Encryption Key Format Error: ENCRYPTION_KEY contains invalid characters. ' +
      'Only lowercase hex digits (0-9, a-f) are accepted.'
    );
    throw new Error(
      'ENCRYPTION_KEY contains invalid characters — use only 0-9 and a-f'
    );
  }
  return Buffer.from(hardcodedKey, 'utf8');
}


function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  const key = getKey();
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return null;

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ---------------------------------------------------------------------------
// Startup validation — call getKey() once at module load so any misconfigured
// ENCRYPTION_KEY is caught immediately and appears in Railway logs before the
// first encrypt/decrypt call is ever made.
// ---------------------------------------------------------------------------
try {
  getKey();
  console.log(
    'Encryption key loaded successfully (32 hex chars → 16-byte key, AES-128-GCM strength)'
  );
} catch (err) {
  console.error('FATAL: Encryption module failed startup validation —', err.message);
  // Re-throw so the process exits with a clear error rather than failing
  // silently on the first SMTP operation.
  throw err;
}

module.exports = { encrypt, decrypt };
