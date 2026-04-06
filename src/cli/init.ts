export async function init(): Promise<void> {
  console.log(`
  super-hotline init — Deploy Worker to Cloudflare

  This command deploys the super-hotline Worker to your own Cloudflare account,
  giving you a persistent remote URL instead of localhost.

  Requirements:
    - A Cloudflare account
    - Cloudflare MCP configured in your Claude Code environment

  Coming soon.

  In the meantime, use one of:
    npx super-hotline start       — run locally on localhost:3847
    npx wrangler deploy           — deploy manually from this directory
  `);
}
