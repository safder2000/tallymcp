/** Quick: tuition group total for adjacent FYs */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
const CO =
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)';
const ranges = [
  ['FY24-25', '2024-04-01', '2025-03-31'],
  ['FY25-26', '2025-04-01', '2026-03-31'],
  ['15 months', '2024-04-01', '2026-03-31'],
  ['Apr25-Feb26', '2025-04-01', '2026-02-28'],
];
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'r2',
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
          state: 'x',
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
          state: 'x',
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
        clientInfo: { name: 'r2', version: '1' },
      },
    }),
  });
  const sid = ir.headers.get('mcp-session-id');
  await ir.text();
  return { t: tok.access_token, sid };
}

function pj(txt) {
  const dl = txt.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(dl ? dl.slice(5).trim() : txt);
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
  const j = pj(await r.text());
  const c = j?.result?.content;
  return Array.isArray(c)
    ? c.filter((x) => x.type === 'text').map((x) => x.text).join('')
    : '';
}

const { t, sid } = await connect();
for (const [label, from, to] of ranges) {
  const tb = JSON.parse(
    await call(t, sid, 'trial-balance', {
      targetCompany: CO,
      fromDate: from,
      toDate: to,
    }),
  ).tableID;
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
      params: {
        name: 'query-database',
        arguments: {
          sql: `SELECT SUM(ABS(net_credit))::BIGINT AS tuition_group_cr FROM "${tb}" WHERE group_name = 'Tuition Fee and Other Income'`,
        },
      },
    }),
  });
  const txt = await r.text();
  const j = pj(txt);
  const out = j?.result?.content?.[0]?.text?.trim() || txt.slice(0, 200);
  console.log(label, from, '..', to, '→', out.replace(/\n/g, ' '));
}
