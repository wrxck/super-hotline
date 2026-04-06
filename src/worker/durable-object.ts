import { generateSecret, generateCode, verifyCode } from './totp.js';
import { generateCookieKey, signCookie, verifyCookie } from './cookie.js';
import type { PaneContent, WsMessage, FailedAttempt } from './types.js';

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export class HotlineSession {
  private state: DurableObjectState;
  private totpSecret: Uint8Array | null = null;
  private cookieKey: string | null = null;
  private apiKey: string | null = null;
  private panes: Map<string, PaneContent> = new Map();
  private failedAttempts: Map<string, FailedAttempt> = new Map();
  private clients: WebSocket[] = [];
  private initialized = false;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // PUT /api/session — init
    if (method === 'PUT' && path === '/api/session') {
      return this.handleInit();
    }

    // DELETE /api/session — destroy
    if (method === 'DELETE' && path === '/api/session') {
      return this.handleDestroy();
    }

    // GET /api/session — status
    if (method === 'GET' && path === '/api/session') {
      return this.handleStatus();
    }

    // POST /auth/verify — TOTP verification
    if (method === 'POST' && path === '/auth/verify') {
      return this.handleVerify(request);
    }

    // PUT /api/content/{pane} — push content
    if (method === 'PUT' && path.startsWith('/api/content/')) {
      return this.handleContentPush(request, path);
    }

    // GET /ws — WebSocket upgrade
    if (method === 'GET' && path === '/ws') {
      return this.handleWebSocket(request);
    }

    return json({ error: 'Not found' }, 404);
  }

  async alarm(): Promise<void> {
    await this.destroy();
  }

  /** Exposed for testing — generates current TOTP code */
  _getCurrentCode(): string {
    if (!this.totpSecret) throw new Error('Session not initialized');
    return generateCode(this.totpSecret);
  }

  private handleInit(): Response {
    this.totpSecret = generateSecret();
    this.cookieKey = generateCookieKey();

    // Generate 64-char hex API key (32 random bytes)
    const apiKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(apiKeyBytes);
    this.apiKey = hexEncode(apiKeyBytes);

    this.initialized = true;
    this.panes.clear();
    this.failedAttempts.clear();

    // Set 4hr auto-destroy alarm
    this.state.storage.setAlarm(Date.now() + 4 * 60 * 60 * 1000);

    return json({ apiKey: this.apiKey });
  }

  private async handleDestroy(): Promise<Response> {
    await this.destroy();
    return json({ ok: true });
  }

  private async destroy(): Promise<void> {
    // Broadcast session_end to all connected clients
    const msg: WsMessage = { type: 'session_end' };
    this.broadcast(msg);

    // Close all WebSocket connections
    for (const ws of this.clients) {
      try {
        ws.close(1000, 'Session ended');
      } catch {
        // Already closed
      }
    }

    this.clients = [];
    this.totpSecret = null;
    this.cookieKey = null;
    this.apiKey = null;
    this.panes.clear();
    this.failedAttempts.clear();
    this.initialized = false;
  }

  private handleStatus(): Response {
    const paneNames = Array.from(this.panes.keys());
    return json({
      initialized: this.initialized,
      connectedClients: this.clients.length,
      panes: paneNames,
    });
  }

  private async handleVerify(request: Request): Promise<Response> {
    if (!this.initialized || !this.totpSecret || !this.cookieKey) {
      return json({ ok: false, error: 'Session not initialized' }, 400);
    }

    // Rate limiting by IP
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const attempt = this.failedAttempts.get(ip);
    if (attempt && attempt.count >= 3 && Date.now() < attempt.lockedUntil) {
      return json({ ok: false, error: 'Too many attempts. Try again later.' }, 429);
    }

    // Reset if lockout expired
    if (attempt && attempt.lockedUntil > 0 && Date.now() >= attempt.lockedUntil) {
      this.failedAttempts.delete(ip);
    }

    const body = await request.json() as { code?: string };
    if (!body.code) {
      return json({ ok: false, error: 'Missing code' }, 400);
    }

    // Strip spaces from submitted code
    const code = body.code.replace(/\s/g, '');

    if (!verifyCode(this.totpSecret, code)) {
      // Increment failed attempts
      const current = this.failedAttempts.get(ip) || { count: 0, lockedUntil: 0 };
      current.count += 1;
      if (current.count >= 3) {
        current.lockedUntil = Date.now() + 60 * 1000; // 60s lockout
      }
      this.failedAttempts.set(ip, current);
      return json({ ok: false, error: 'Invalid code' }, 401);
    }

    // Success — issue session cookie
    const sessionId = crypto.randomUUID();
    const signedCookie = signCookie(this.cookieKey, sessionId);
    const cookieHeader = `__Host-hotline_session=${signedCookie}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=14400`;

    return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader });
  }

  private async handleContentPush(request: Request, path: string): Promise<Response> {
    // Verify API key
    const auth = request.headers.get('Authorization');
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== this.apiKey) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const pane = path.replace('/api/content/', '');
    const body = await request.json() as { html?: string; title?: string };

    if (!body.html || !body.title) {
      return json({ error: 'Missing html or title' }, 400);
    }

    const content: PaneContent = {
      html: body.html,
      title: body.title,
      updatedAt: Date.now(),
    };

    this.panes.set(pane, content);

    // Broadcast pane_update to all WebSocket clients
    const msg: WsMessage = { type: 'pane_update', pane, content };
    this.broadcast(msg);

    return json({ ok: true });
  }

  private handleWebSocket(request: Request): Response {
    // Verify session cookie
    if (!this.cookieKey) {
      return json({ error: 'Session not initialized' }, 400);
    }

    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = cookieHeader.split(';').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('__Host-hotline_session='));

    if (!sessionCookie) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const cookieValue = sessionCookie.split('=').slice(1).join('=');
    if (!verifyCookie(this.cookieKey, cookieValue)) {
      return json({ error: 'Invalid session' }, 401);
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);
    this.clients.push(server);

    // Send all current panes to the new client
    for (const [pane, content] of this.panes) {
      const msg: WsMessage = { type: 'pane_update', pane, content };
      try {
        server.send(JSON.stringify(msg));
      } catch {
        // Client may have disconnected immediately
      }
    }

    // Listen for messages
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string) as WsMessage;
        if (data.type === 'action') {
          this.broadcast(data);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    server.addEventListener('close', () => {
      this.clients = this.clients.filter(c => c !== server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    this.clients = this.clients.filter(ws => {
      try {
        ws.send(data);
        return true;
      } catch {
        // Dead connection — remove it
        return false;
      }
    });
  }
}
