import { createLocalServer } from '../src/local/server.js';

async function main() {
  const s = await createLocalServer({ port: 0, open: false });
  await fetch(`http://localhost:${s.port}/api/session`, { method: 'PUT' });
  console.log(`Server on port ${s.port}, Code: ${s.getFormattedCode()}`);

  let pass = 0;
  let fail = 0;

  function check(name: string, ok: boolean) {
    if (ok) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}`); }
  }

  // 1. HTML served
  const html = await fetch(`http://localhost:${s.port}/`).then(r => r.text());
  check('HTML contains super-hotline', html.includes('super-hotline'));

  // 2. Session init
  const initResp = await fetch(`http://localhost:${s.port}/api/session`, { method: 'PUT' });
  const initData = await initResp.json() as { apiKey: string };
  check('Session init returns API key', initData.apiKey?.length === 64);

  // 3. Content push with API key
  const pushResp = await fetch(`http://localhost:${s.port}/api/content/test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${initData.apiKey}` },
    body: JSON.stringify({ html: '<h1>Hello</h1>', title: 'Test' }),
  });
  check('Content push succeeds', pushResp.status === 200);

  // 4. Content push without API key rejected
  const nokeyResp = await fetch(`http://localhost:${s.port}/api/content/test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: '<h1>Bad</h1>', title: 'Bad' }),
  });
  check('Content push without key rejected', nokeyResp.status === 401);

  // 5. Session status shows pane
  const statusResp = await fetch(`http://localhost:${s.port}/api/session`);
  const statusData = await statusResp.json() as { panes: string[] };
  check('Status shows test pane', statusData.panes?.includes('test'));

  // 6. Invalid TOTP rejected
  const badAuth = await fetch(`http://localhost:${s.port}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '000000' }),
  });
  check('Invalid TOTP code rejected', badAuth.status === 401);

  // 7. Valid TOTP accepted with cookie
  const goodAuth = await fetch(`http://localhost:${s.port}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: s.getCurrentCode() }),
  });
  const cookie = goodAuth.headers.get('set-cookie') || '';
  check('Valid TOTP code accepted', goodAuth.status === 200);
  check('Session cookie is HttpOnly', cookie.includes('HttpOnly'));
  check('Session cookie is SameSite', cookie.includes('SameSite'));

  // 8. Session destroy
  const delResp = await fetch(`http://localhost:${s.port}/api/session`, { method: 'DELETE' });
  check('Session destroy succeeds', delResp.status === 200);

  await s.close();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('\n  ALL E2E TESTS PASSED');
}

main().catch(err => { console.error(err); process.exit(1); });
