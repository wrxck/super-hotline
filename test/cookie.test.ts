import { describe, it, expect } from 'vitest';
import { generateCookieKey, signCookie, verifyCookie } from '../src/worker/cookie.js';

describe('Cookie signing', () => {
  it('generateCookieKey() returns a 64-char hex string', () => {
    const key = generateCookieKey();
    expect(typeof key).toBe('string');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signCookie + verifyCookie roundtrip succeeds', () => {
    const key = generateCookieKey();
    const sessionId = 'test-session-abc123';
    const cookie = signCookie(key, sessionId);
    const result = verifyCookie(key, cookie);
    expect(result).toBe(sessionId);
  });

  it('tampered cookie (modified sessionId) is rejected', () => {
    const key = generateCookieKey();
    const sessionId = 'test-session-abc123';
    const cookie = signCookie(key, sessionId);

    // Replace the sessionId part with a different one, keeping the original signature
    const dotIndex = cookie.lastIndexOf('.');
    const originalSig = cookie.slice(dotIndex);
    const tamperedCookie = 'tampered-session-xyz' + originalSig;

    const result = verifyCookie(key, tamperedCookie);
    expect(result).toBeNull();
  });

  it('cookie signed with a different key is rejected', () => {
    const key1 = generateCookieKey();
    const key2 = generateCookieKey();
    const sessionId = 'test-session-abc123';

    const cookie = signCookie(key1, sessionId);
    const result = verifyCookie(key2, cookie);
    expect(result).toBeNull();
  });
});
