export async function status(): Promise<void> {
  const url = 'http://localhost:3847/api/session';

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      console.log('super-hotline server is running but returned an unexpected status.');
      return;
    }
    const data = await res.json() as {
      initialized: boolean;
      connectedClients: number;
      panes: string[];
    };
    console.log(`\n  super-hotline is running on http://localhost:3847`);
    console.log(`  Connected clients : ${data.connectedClients}`);
    console.log(`  Active panes      : ${data.panes.length > 0 ? data.panes.join(', ') : 'none'}\n`);
  } catch {
    console.log('\n  No local super-hotline server running.\n');
  }
}
