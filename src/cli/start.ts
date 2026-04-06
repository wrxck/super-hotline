import { createLocalServer } from '../local/server.js';
import { openBrowser } from '../local/open.js';

export async function start(args: string[]): Promise<void> {
  const isRemote = args.includes('--remote');

  if (isRemote) {
    console.log('Remote tier coming soon.');
    process.exit(0);
  }

  const port = 3847;
  console.log(`Starting super-hotline on http://localhost:${port} ...`);

  const server = await createLocalServer({ port });

  // Init session
  const res = await fetch(`http://localhost:${port}/api/session`, { method: 'PUT' });
  const { apiKey } = await res.json() as { apiKey: string };

  const url = `http://localhost:${port}`;

  function printStatus(): void {
    const code = server.getFormattedCode();
    process.stdout.write(`\r  URL: ${url}   TOTP: ${code}   `);
  }

  console.log(`\n  URL:    ${url}`);
  console.log(`  API key has been initialised.`);
  console.log(`\n  Open the URL in your browser and enter the TOTP code when prompted.`);
  console.log(`  The code rotates every 30 seconds.\n`);

  printStatus();
  const interval = setInterval(printStatus, 5000);

  openBrowser(url);

  process.on('SIGINT', async () => {
    clearInterval(interval);
    process.stdout.write('\n');
    console.log('Shutting down...');
    await fetch(`http://localhost:${port}/api/session`, { method: 'DELETE' }).catch(() => {});
    await server.close();
    process.exit(0);
  });
}
