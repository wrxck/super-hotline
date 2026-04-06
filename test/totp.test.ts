import { describe, it, expect } from 'vitest';
import {
  generateSecret,
  generateCode,
  generateCodeForCounter,
  verifyCode,
  formatCode,
} from '../src/worker/totp.js';

describe('TOTP', () => {
  it('generateSecret() returns a 20-byte Uint8Array', () => {
    const secret = generateSecret();
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(20);
  });

  it('generateCode() returns a 6-digit string', () => {
    const secret = generateSecret();
    const code = generateCode(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('same secret produces same code within the same 30s window', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    // Use a time firmly in the middle of a window to avoid boundary issues
    const midWindow = Math.floor(now / 30) * 30 + 15;
    const code1 = generateCode(secret, midWindow);
    const code2 = generateCode(secret, midWindow + 5);
    expect(code1).toBe(code2);
  });

  it('verifyCode() accepts a valid code', () => {
    const secret = generateSecret();
    const code = generateCode(secret);
    expect(verifyCode(secret, code)).toBe(true);
  });

  it('verifyCode() rejects an invalid code ("000000")', () => {
    const secret = generateSecret();
    // Generate the real code to make sure "000000" isn't coincidentally valid
    const realCode = generateCode(secret);
    if (realCode === '000000') {
      // Extremely unlikely, but handle it: just skip assertion
      return;
    }
    expect(verifyCode(secret, '000000')).toBe(false);
  });

  it('verifyCode() accepts codes from adjacent time windows', () => {
    const secret = generateSecret();
    const now = Math.floor(Date.now() / 1000);
    const currentCounter = Math.floor(now / 30);

    // Generate code for previous window
    const prevCode = generateCodeForCounter(secret, currentCounter - 1);
    expect(verifyCode(secret, prevCode, 1)).toBe(true);

    // Generate code for next window
    const nextCode = generateCodeForCounter(secret, currentCounter + 1);
    expect(verifyCode(secret, nextCode, 1)).toBe(true);
  });

  it('formatCode() formats as "123 456"', () => {
    expect(formatCode('123456')).toBe('123 456');
    expect(formatCode('000000')).toBe('000 000');
  });
});
