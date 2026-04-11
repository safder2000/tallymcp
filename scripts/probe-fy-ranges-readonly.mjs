/**
 * Read-only: trial-balance by FY for one 2022-23 company book — confirms data exists in later years.
 *   node scripts/probe-fy-ranges-readonly.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) {
  console.error('Usage: node scripts/probe-fy-ranges-readonly.mjs <MCP_BASE_URL>');
  process.exit(2);
}
const pw = process.env.MCP_PASSWORD || 'password';
const CO =
  'KMCT College of Architecture - (2022-2023) - (from 1-Apr-22)';
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'fy-probe',
        redirect_uris: [`${origin}/callback`],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    })
  ).json();
  const cv = 'w'.repeat(64);
  const hb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cv));
  const cc = btoa(String.fromCharCode(...new Uint8Array(hb)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const lr = await (
    await fetch(
      `${origin}/authorize?` +
        new URLSearchParams({
          response_type: 'code',
          client_id: reg.client_id,
          redirect_uri: `${origin}/callback`,
          state: 'f',
          code_challenge: cc,
          code_challenge_method: 'S256',
        }),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          password: pw,
          client_id: reg.client_id,
          redirect_uri: `${origin}/callback`,
          state: 'f',
          code_challenge: cc,
          code_challenge_method: 'S256',
        }),
      },
    )
  ).json();
  const tok = await (
    await fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: lr.code,
        redirect_uri: `${origin}/callback`,
        client_id: reg.client_id,
        client_secret: reg.client_secret || '',
        code_verifier: cv,
      }),
    })
  ).json();
  const ir = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tok.access_token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rid,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'fy-probe', version: '1.0.0' },
      },
    }),
  });
  const sid = ir.headers.get('mcp-session-id');
  await ir.text();
  return { t: tok.access_token, sid };
}

async function call(t, sid, name, args) {
  const r = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${t}`,
      'mcp-session-id': sid,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rid,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const txt = await r.text();
  let j;
  try {
    const dl = txt.split('\n').find((l) => l.startsWith('data:'));
    j = dl ? JSON.parse(dl.slice(5)) : JSON.parse(txt);
  } catch {
    j = null;
  }
  const c = j?.result?.content;
  const text = Array.isArray(c)
    ? c.filter((x) => x.type === 'text').map((x) => x.text).join('')
    : '';
  return { err: !!j?.result?.isError, text };
}

const ranges = [
  ['FY22-23', '2022-04-01', '2023-03-31'],
  ['FY23-24', '2023-04-01', '2024-03-31'],
  ['FY24-25', '2024-04-01', '2025-03-31'],
  ['FY25-26', '2025-04-01', '2026-03-31'],
];

const { t, sid } = await connect();
console.log('Read-only FY probe →', origin);
console.log('Company:', CO, '\n');

for (const [label, from, to] of ranges) {
  const tb = await call(t, sid, 'trial-balance', {
    targetCompany: CO,
    fromDate: from,
    toDate: to,
  });
  if (tb.err) {
    console.log(label, from, '..', to, 'ERROR', tb.text.slice(0, 150));
    continue;
  }
  let tid;
  try {
    tid = JSON.parse(tb.text).tableID;
  } catch {
    console.log(label, 'no tableID');
    continue;
  }
  const sql = `SELECT COUNT(*) AS rows, SUM(ABS(net_debit)) AS sum_abs_debit, SUM(ABS(net_credit)) AS sum_abs_credit FROM "${tid}"`;
  const q = await call(t, sid, 'query-database', { sql });
  console.log(`${label}  ${from} .. ${to}`);
  console.log(' ', q.text.trim().replace(/\r?\n/g, ' | '));
}

console.log('\nDone (read-only).');
