// RFC 6238 TOTP implementation with pure JS HMAC-SHA1
// Works in both Node.js and Cloudflare Workers (no Node-specific crypto APIs)

const PERIOD = 30;
const CODE_DIGITS = 6;
const SECRET_LENGTH = 20;

// --- Pure JS SHA-1 (RFC 3174) ---

function sha1(message: Uint8Array): Uint8Array {
  const ml = message.length;

  // Pre-processing: add padding
  const paddedLength = Math.ceil((ml + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[ml] = 0x80;

  // Append original length in bits as 64-bit big-endian
  const bits = ml * 8;
  const view = new DataView(padded.buffer);
  // We only support messages up to 2^32 bits, so high 32 bits are 0
  view.setUint32(paddedLength - 4, bits, false);

  // Initialize hash values
  let h0 = 0x67452301;
  let h1 = 0xEFCDAB89;
  let h2 = 0x98BADCFE;
  let h3 = 0x10325476;
  let h4 = 0xC3D2E1F0;

  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    // Break chunk into sixteen 32-bit big-endian words
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }

    // Extend the sixteen 32-bit words into eighty 32-bit words
    for (let i = 16; i < 80; i++) {
      const val = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (val << 1) | (val >>> 31);
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5A827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ED9EBA1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8F1BBCDC;
      } else {
        f = b ^ c ^ d;
        k = 0xCA62C1D6;
      }

      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const result = new Uint8Array(20);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false);
  rv.setUint32(4, h1, false);
  rv.setUint32(8, h2, false);
  rv.setUint32(12, h3, false);
  rv.setUint32(16, h4, false);

  return result;
}

// --- HMAC-SHA1 (RFC 2104) ---

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;

  // If key is longer than block size, hash it
  let keyBlock: Uint8Array;
  if (key.length > blockSize) {
    keyBlock = new Uint8Array(blockSize);
    keyBlock.set(sha1(key));
  } else {
    keyBlock = new Uint8Array(blockSize);
    keyBlock.set(key);
  }

  // Create inner and outer padded keys
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }

  // Inner hash: SHA1(ipad || message)
  const inner = new Uint8Array(blockSize + message.length);
  inner.set(ipad);
  inner.set(message, blockSize);
  const innerHash = sha1(inner);

  // Outer hash: SHA1(opad || inner_hash)
  const outer = new Uint8Array(blockSize + 20);
  outer.set(opad);
  outer.set(innerHash, blockSize);

  return sha1(outer);
}

// --- TOTP (RFC 6238) / HOTP (RFC 4226) ---

/**
 * Generate a cryptographically random 20-byte secret.
 */
export function generateSecret(): Uint8Array {
  const secret = new Uint8Array(SECRET_LENGTH);
  crypto.getRandomValues(secret);
  return secret;
}

/**
 * Generate a 6-digit TOTP code for a specific counter value (HOTP per RFC 4226).
 */
export function generateCodeForCounter(secret: Uint8Array, counter: number): string {
  // Convert counter to 8-byte big-endian
  const counterBytes = new Uint8Array(8);
  const counterView = new DataView(counterBytes.buffer);
  // Split into high and low 32 bits
  counterView.setUint32(0, Math.floor(counter / 0x100000000), false);
  counterView.setUint32(4, counter >>> 0, false);

  const hmac = hmacSha1(secret, counterBytes);

  // Dynamic truncation per RFC 4226 section 5.4
  const offset = hmac[19] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, CODE_DIGITS);
  return otp.toString().padStart(CODE_DIGITS, '0');
}

/**
 * Generate a 6-digit TOTP code for the current (or specified) time.
 */
export function generateCode(secret: Uint8Array, time?: number): string {
  const t = time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(t / PERIOD);
  return generateCodeForCounter(secret, counter);
}

/**
 * Verify a TOTP code with optional time-window drift tolerance.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyCode(secret: Uint8Array, code: string, drift: number = 1): boolean {
  const now = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(now / PERIOD);

  let valid = false;
  for (let i = -drift; i <= drift; i++) {
    const expected = generateCodeForCounter(secret, currentCounter + i);
    if (timingSafeEqual(code, expected)) {
      valid = true;
    }
  }
  return valid;
}

/**
 * Format a 6-digit code as "123 456" for display.
 */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

// --- Timing-safe string comparison ---

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
