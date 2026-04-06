export { HotlineSession } from './durable-object.js';
import type { Env } from './types.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Serve static assets
    if (path === '/' || path === '/index.html') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (path === '/style.css') {
      return new Response(CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
    }
    if (path === '/auth.js') {
      return new Response(AUTH_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    }
    if (path === '/app.js') {
      return new Response(APP_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
    }

    // Extract session ID from URL path
    // Pattern: /s/{id}/... for remote tier, or "default" for own-domain/local
    let sessionId = 'default';
    let forwardPath = path;

    const sessionMatch = path.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (sessionMatch) {
      sessionId = sessionMatch[1];
      forwardPath = sessionMatch[2] || '/';
    }

    // Route to the appropriate Durable Object instance
    const id = env.HOTLINE_SESSION.idFromName(sessionId);
    const stub = env.HOTLINE_SESSION.get(id);

    // Build the forwarded request with the prefix stripped
    const forwardUrl = new URL(forwardPath + url.search, url.origin);
    const forwardRequest = new Request(forwardUrl.toString(), request);

    return stub.fetch(forwardRequest);
  },
};

const HTML = `<!-- placeholder -->`;
const CSS = `/* placeholder */`;
const AUTH_JS = `// placeholder`;
const APP_JS = `// placeholder`;
