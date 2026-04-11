/**
 * Staff salary / wages / payroll for Pharmacy college (FY 2025-26).
 * node --env-file=../../.env scripts/probe-pharmacy-staff-salary.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
const CO =
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)';
const FROM = '2025-04-01';
const TO = '2026-03-31';
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'salary-probe',
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
          state: 's',
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
          state: 's',
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
        clientInfo: { name: 'salary-probe', version: '1' },
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
  return {
    err: !!j?.result?.isError,
    text: Array.isArray(c)
      ? c.filter((x) => x.type === 'text').map((x) => x.text).join('')
      : '',
  };
}

const { t, sid } = await connect();

const tb = await call(t, sid, 'trial-balance', {
  targetCompany: CO,
  fromDate: FROM,
  toDate: TO,
});
if (tb.err) {
  console.error(tb.text);
  process.exit(1);
}
const tid = JSON.parse(tb.text).tableID;

async function q(sql) {
  const r = await call(t, sid, 'query-database', { sql });
  return r.err ? 'ERR ' + r.text : r.text.trim();
}

console.log('Company:', CO);
console.log('Period:', FROM, '..', TO, '\n');

console.log('--- Trial balance: ledger name matches salary / wage / pay / staff / PF / ESI ---\n');
console.log(
  await q(`
SELECT ledger_name, group_name, net_debit, net_credit,
  (ABS(net_debit) + ABS(net_credit)) AS movement
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%salary%'
   OR LOWER(ledger_name) LIKE '%wage%'
   OR LOWER(ledger_name) LIKE '%payroll%'
   OR LOWER(ledger_name) LIKE '%staff pay%'
   OR LOWER(ledger_name) LIKE '%remuneration%'
   OR (LOWER(ledger_name) LIKE '%pay%' AND LOWER(ledger_name) LIKE '%staff%')
ORDER BY movement DESC
LIMIT 50
`),
);

console.log('\n--- Same but group_name hints (Salary, Staff, Payroll) ---\n');
console.log(
  await q(`
SELECT ledger_name, group_name, net_debit, net_credit
FROM "${tid}"
WHERE LOWER(group_name) LIKE '%salary%'
   OR LOWER(group_name) LIKE '%staff%'
   OR LOWER(group_name) LIKE '%payroll%'
   OR LOWER(group_name) LIKE '%wages%'
ORDER BY ABS(net_debit) + ABS(net_credit) DESC
LIMIT 40
`),
);

console.log('\n--- Aggregate: sum abs(debit) for salary-like ledger names (expense proxy) ---\n');
console.log(
  await q(`
SELECT COUNT(*) AS n_ledgers,
  SUM(ABS(net_debit))::BIGINT AS sum_abs_debit,
  SUM(ABS(net_credit))::BIGINT AS sum_abs_credit
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%salary%'
   OR LOWER(ledger_name) LIKE '%wage%'
   OR LOWER(ledger_name) LIKE '%payroll%'
`),
);

const pl = await call(t, sid, 'profit-loss', {
  targetCompany: CO,
  fromDate: FROM,
  toDate: TO,
});
if (!pl.err) {
  const pid = JSON.parse(pl.text).tableID;
  console.log('\n--- P&L lines: salary / wage / pay (ledger_name) ---\n');
  console.log(
    await q(`
SELECT ledger_name, group_name, amount
FROM "${pid}"
WHERE LOWER(ledger_name) LIKE '%salary%'
   OR LOWER(ledger_name) LIKE '%wage%'
   OR LOWER(ledger_name) LIKE '%payroll%'
   OR LOWER(ledger_name) LIKE '%staff%' AND LOWER(ledger_name) LIKE '%pay%'
ORDER BY ABS(amount) DESC
LIMIT 40
`),
  );
  console.log('\n--- P&L: groups containing Salary / Staff ---\n');
  console.log(
    await q(`
SELECT group_name, SUM(amount) AS total, COUNT(*) AS lines
FROM "${pid}"
WHERE LOWER(group_name) LIKE '%salary%'
   OR LOWER(group_name) LIKE '%staff%'
   OR LOWER(group_name) LIKE '%wages%'
GROUP BY 1
ORDER BY ABS(total) DESC
`),
  );
}
