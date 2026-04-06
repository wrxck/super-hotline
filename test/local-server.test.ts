import { describe, it, expect, afterEach } from 'vitest';
import { createLocalServer, type LocalServerHandle } from '../src/local/server.js';

let server: LocalServerHandle | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('Local server', () => {
  it('starts on a random port and serves HTML containing "super-hotline"', async () => {
    server = await createLocalServer({ port: 0, open: false });
    expect(server.port).toBeGreaterThan(0);

    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('super-hotline');
  });

  it('PUT /api/session returns 200 with apiKey', async () => {
    server = await createLocalServer({ port: 0, open: false });

    const res = await fetch(`http://localhost:${server.port}/api/session`, {
      method: 'PUT',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { apiKey: string };
    expect(body.apiKey).toBeDefined();
    expect(body.apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('POST /auth/verify with correct TOTP code returns 200', async () => {
    server = await createLocalServer({ port: 0, open: false });

    const code = server.getCurrentCode();
    const res = await fetch(`http://localhost:${server.port}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);

    const cookie = res.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('hotline_session=');
  });
});
