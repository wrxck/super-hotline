# super-hotline

Real-time authenticated browser bridge for Claude Code

## What it does

super-hotline runs a local server that Claude Code can push HTML content to, which then appears live in your browser. It uses TOTP (time-based one-time passwords) so only you can connect to the session — no API keys stored in config files or environment variables. Content is pushed over WebSockets so updates appear instantly without polling. The same Worker code runs locally via Node.js or deployed to Cloudflare Workers for remote access.

## Quick start

```
npx super-hotline start
```

This starts a local server on `http://localhost:3847`, prints a rotating 6-digit TOTP code in your terminal, and opens the browser automatically. Enter the code in the browser to authenticate. Once connected, any plugin that supports super-hotline can push content to named panes in the browser tab.

## Tiers

| Tier | Command | How it works |
|------|---------|--------------|
| Local | `npx super-hotline start` | Node.js server on localhost:3847, no cloud required |
| Remote | `npx super-hotline start --remote` | Cloudflare Worker with Durable Object — coming soon |
| Own domain | `npx super-hotline init` | Deploy the Worker to your own Cloudflare account |

## Auth flow

When you open the browser URL, you are shown a code entry screen. The 6-digit code is displayed in your terminal next to the URL. Enter it to authenticate. The code rotates every 30 seconds (standard TOTP). After authentication a session cookie is set for the tab — you will not be asked again until you restart the server.

## For plugin authors

Plugins push content to named panes using the content API. The `super-hotline-claude` plugin provides Claude Code MCP tools that call this API automatically. If you are building your own plugin, the API is:

```
PUT http://localhost:3847/api/content/{pane-name}
Authorization: Bearer {apiKey}
Content-Type: application/json

{ "title": "My Pane", "html": "<p>Hello</p>" }
```

The `apiKey` is returned when the session is initialised (`PUT /api/session`). See the `super-hotline-claude` package for a reference implementation.

## What this is NOT

- Not affiliated with any other CLI tool, plugin, or product that shares a similar name
- Not a replacement for any existing Claude Code extension or workflow
- Not required by any plugin — plugins that use it are opt-in
- Not a general-purpose tunnelling or proxy tool

## License

MIT
