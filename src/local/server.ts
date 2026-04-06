import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { generateSecret, generateCode, verifyCode } from '../worker/totp.js';
import { generateCookieKey, signCookie, verifyCookie } from '../worker/cookie.js';
import type { PaneContent, WsMessage } from '../worker/types.js';
import { openBrowser } from './open.js';

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function resolveClientDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Try source layout first: ../../client relative to src/local/
  const srcPath = resolve(thisDir, '..', 'client');
  try {
    readFileSync(join(srcPath, 'index.html'));
    return srcPath;
  } catch {
    // Fall back to dist layout: ../client relative to dist/local/
    return resolve(thisDir, '..', 'client');
  }
}

function readClientFile(clientDir: string, filename: string): string {
  return readFileSync(join(clientDir, filename), 'utf-8');
}

function json(res: ServerResponse, data: unknown, status = 200, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    map.set(key, val);
  }
  return map;
}

export interface LocalServerHandle {
  port: number;
  close(): Promise<void>;
  getCurrentCode(): string;
  getFormattedCode(): string;
}

export function createLocalServer(opts?: { port?: number; open?: boolean }): Promise<LocalServerHandle> {
  const port = opts?.port ?? 3847;
  const shouldOpen = opts?.open ?? false;

  // Session state
  const totpSecret = generateSecret();
  const cookieKey = generateCookieKey();
  const apiKeyBytes = new Uint8Array(32);
  crypto.getRandomValues(apiKeyBytes);
  const apiKey = hexEncode(apiKeyBytes);
  const panes = new Map<string, PaneContent>();
  const wsClients: Set<WebSocket> = new Set();

  const clientDir = resolveClientDir();

  function broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of wsClients) {
      try {
        ws.send(data);
      } catch {
        wsClients.delete(ws);
      }
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const path = url.pathname;
    const method = req.method || 'GET';

    try {
      // Static files
      if ((method === 'GET') && (path === '/' || path === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readClientFile(clientDir, 'index.html'));
        return;
      }
      if (method === 'GET' && path === '/style.css') {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(readClientFile(clientDir, 'style.css'));
        return;
      }
      if (method === 'GET' && path === '/auth.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(readClientFile(clientDir, 'auth.js'));
        return;
      }
      if (method === 'GET' && path === '/app.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(readClientFile(clientDir, 'app.js'));
        return;
      }

      // PUT /api/session — return apiKey
      if (method === 'PUT' && path === '/api/session') {
        json(res, { apiKey });
        return;
      }

      // DELETE /api/session — end session
      if (method === 'DELETE' && path === '/api/session') {
        broadcast({ type: 'session_end' });
        json(res, { ok: true });
        return;
      }

      // GET /api/session — status
      if (method === 'GET' && path === '/api/session') {
        json(res, {
          initialized: true,
          connectedClients: wsClients.size,
          panes: Array.from(panes.keys()),
        });
        return;
      }

      // POST /auth/verify — TOTP verification
      if (method === 'POST' && path === '/auth/verify') {
        const body = await parseBody(req) as { code?: string };
        if (!body.code) {
          json(res, { ok: false, error: 'Missing code' }, 400);
          return;
        }

        const code = body.code.replace(/\s/g, '');
        if (!verifyCode(totpSecret, code)) {
          json(res, { ok: false, error: 'Invalid code' }, 401);
          return;
        }

        const sessionId = crypto.randomUUID();
        const signedCookie = signCookie(cookieKey, sessionId);
        const cookieHeader = `hotline_session=${signedCookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`;
        json(res, { ok: true }, 200, { 'Set-Cookie': cookieHeader });
        return;
      }

      // PUT /api/content/{pane} — push content
      if (method === 'PUT' && path.startsWith('/api/content/')) {
        const auth = req.headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== apiKey) {
          json(res, { error: 'Unauthorized' }, 401);
          return;
        }

        const pane = path.replace('/api/content/', '');
        const body = await parseBody(req) as { html?: string; title?: string };

        if (!body.html || !body.title) {
          json(res, { error: 'Missing html or title' }, 400);
          return;
        }

        const content: PaneContent = {
          html: body.html,
          title: body.title,
          updatedAt: Date.now(),
        };
        panes.set(pane, content);

        const msg: WsMessage = { type: 'pane_update', pane, content };
        broadcast(msg);
        json(res, { ok: true });
        return;
      }

      // 404
      json(res, { error: 'Not found' }, 404);
    } catch (err) {
      json(res, { error: 'Internal server error' }, 500);
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Verify session cookie
    const cookies = parseCookies(req.headers.cookie);
    const cookieValue = cookies.get('hotline_session');
    if (!cookieValue || !verifyCookie(cookieKey, cookieValue)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    wsClients.add(ws);

    // Send all current panes
    for (const [pane, content] of panes) {
      const msg: WsMessage = { type: 'pane_update', pane, content };
      ws.send(JSON.stringify(msg));
    }

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        if (msg.type === 'action') {
          broadcast(msg);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
    });
  });

  return new Promise((resolvePromise) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;

      if (shouldOpen) {
        openBrowser(`http://localhost:${actualPort}`);
      }

      resolvePromise({
        port: actualPort,
        async close() {
          for (const ws of wsClients) {
            try { ws.close(); } catch { /* ignore */ }
          }
          wsClients.clear();
          wss.close();
          return new Promise<void>((res) => server.close(() => res()));
        },
        getCurrentCode() {
          return generateCode(totpSecret);
        },
        getFormattedCode() {
          const code = generateCode(totpSecret);
          return `${code.slice(0, 3)} ${code.slice(3)}`;
        },
      });
    });
  });
}
