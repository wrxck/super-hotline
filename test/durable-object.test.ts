import { describe, it, expect, beforeEach } from 'vitest';
import { HotlineSession } from '../src/worker/durable-object.js';

class MockState {
  storage = new Map();
  acceptWebSocket(ws: any) { ws.accept?.(); }
  getWebSockets() { return []; }
  setAlarm(_time: number) {}
}

function makeRequest(method: string, path: string, options: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}): Request {
  const init: RequestInit = {
    method,
    headers: options.headers || {},
  };
  if (options.body) {
    init.body = JSON.stringify(options.body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  return new Request(`https://do.internal${path}`, init);
}

// Extend MockState storage with setAlarm
class MockStorage extends Map {
  setAlarm(_time: number) {}
}

describe('HotlineSession Durable Object', () => {
  let state: any;
  let session: HotlineSession;

  beforeEach(() => {
    state = new MockState();
    state.storage = new MockStorage();
    session = new HotlineSession(state as any);
  });

  it('PUT /api/session creates session state and returns 64-char hex API key', async () => {
    const req = makeRequest('PUT', '/api/session');
    const res = await session.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { apiKey: string };
    expect(body.apiKey).toBeDefined();
    expect(body.apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('POST /auth/verify with valid TOTP code returns 200 and Set-Cookie', async () => {
    // Init session first
    await session.fetch(makeRequest('PUT', '/api/session'));

    // Get the current TOTP code
    const code = session._getCurrentCode();

    const req = makeRequest('POST', '/auth/verify', {
      body: { code },
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    const res = await session.fetch(req);

    expect(res.status).toBe(200);
    const cookie = res.headers.get('Set-Cookie');
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('__Host-hotline_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=14400');
  });

  it('POST /auth/verify with invalid code returns 401', async () => {
    await session.fetch(makeRequest('PUT', '/api/session'));

    const req = makeRequest('POST', '/auth/verify', {
      body: { code: '000000' },
      headers: { 'X-Forwarded-For': '1.2.3.4' },
    });
    const res = await session.fetch(req);

    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it('3 failed attempts followed by 4th returns 429', async () => {
    await session.fetch(makeRequest('PUT', '/api/session'));

    const headers = { 'X-Forwarded-For': '5.6.7.8' };

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      const res = await session.fetch(makeRequest('POST', '/auth/verify', {
        body: { code: '000000' },
        headers,
      }));
      expect(res.status).toBe(401);
    }

    // 4th attempt should be rate-limited
    const res = await session.fetch(makeRequest('POST', '/auth/verify', {
      body: { code: '000000' },
      headers,
    }));
    expect(res.status).toBe(429);
  });

  it('PUT /api/content/{pane} with valid API key returns 200', async () => {
    // Init session to get API key
    const initRes = await session.fetch(makeRequest('PUT', '/api/session'));
    const { apiKey } = await initRes.json() as { apiKey: string };

    const req = makeRequest('PUT', '/api/content/main', {
      body: { html: '<p>Hello</p>', title: 'Test Pane' },
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const res = await session.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('PUT /api/content/{pane} without API key returns 401', async () => {
    await session.fetch(makeRequest('PUT', '/api/session'));

    const req = makeRequest('PUT', '/api/content/main', {
      body: { html: '<p>Hello</p>', title: 'Test Pane' },
    });
    const res = await session.fetch(req);

    expect(res.status).toBe(401);
  });

  it('DELETE /api/session returns 200', async () => {
    await session.fetch(makeRequest('PUT', '/api/session'));

    const req = makeRequest('DELETE', '/api/session');
    const res = await session.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
