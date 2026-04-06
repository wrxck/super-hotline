#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'start': {
      const { start } = await import('./start.js');
      await start(args.slice(1));
      break;
    }
    case 'init': {
      const { init } = await import('./init.js');
      await init();
      break;
    }
    case 'teardown': {
      const { teardown } = await import('./teardown.js');
      await teardown();
      break;
    }
    case 'status': {
      const { status } = await import('./status.js');
      await status();
      break;
    }
    default:
      console.log(`
  super-hotline — Real-time browser bridge for Claude Code

  Commands:
    start             Start local server (localhost:3847)
    start --remote    Start remote session
    init              Deploy to your own domain (requires Cloudflare MCP)
    teardown          Remove deployment
    status            Show deployment status
      `);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
