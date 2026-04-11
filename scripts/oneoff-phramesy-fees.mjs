/**
 * One-off: find company + fee balances (trial balance / ledger names with fee).
 * node --env-file=../../.env scripts/oneoff-phramesy-fees.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) {
  console.error('Usage: node scripts/oneoff-phramesy-fees.mjs <MCP_BASE_URL>');
  process.exit(2);
}
const pw = process.env.MCP_PASSWORD || 'password';
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'phramesy-fee-probe',
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
          state: 'p',
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
          state: 'p',
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
        clientInfo: { name: 'fee-probe', version: '1.0.0' },
      },
    }),
  });
  const sid = ir.headers.get('mcp-session-id');
  await ir.text();
  return { t: tok.access_token, sid };
}

function parseJson(txt) {
  try {
    const dl = txt.split('\n').find((l) => l.startsWith('data:'));
    if (dl) return JSON.parse(dl.slice(5).trim());
    return JSON.parse(txt);
  } catch {
    return null;
  }
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
  const j = parseJson(txt);
  const c = j?.result?.content;
  const text = Array.isArray(c)
    ? c.filter((x) => x.type === 'text').map((x) => x.text).join('')
    : '';
  return { err: !!j?.result?.isError, text };
}

// FY 2025-26 (this Indian FY if today is Apr 2026)
const FROM = '2025-04-01';
const TO = '2026-03-31';

const { t, sid } = await connect();
console.log('Connected.\n');

const companies = await call(t, sid, 'list-master', { collection: 'company' });
if (companies.err) {
  console.error(companies.text);
  process.exit(1);
}
const lines = companies.text.trim().split(/\r?\n/).filter(Boolean);
const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
const all = [];
for (let i = start; i < lines.length; i++) {
  const n = lines[i].split('\t')[0]?.trim();
  if (n) all.push(n);
}

const needle = /pharma|phrame|framesy|pharmaceutical|phramesy/i;
const matches = all.filter((n) => needle.test(n));
console.log('Companies matching pharmacy / phramesy-like:', matches.length ? matches.join('\n  ') : '(none)');
console.log('\nAll loaded companies (' + all.length + '):');
all.forEach((c) => console.log(' ', c));

let target = matches[0];
if (!target) {
  target = all.find((n) => /college|kmct/i.test(n)) || all[0];
  console.log('\nNo pharmacy match — cannot guess Phramesy; stopping.');
  process.exit(0);
}

console.log('\n=== Using company ===\n', target, '\n');

const tb = await call(t, sid, 'trial-balance', {
  targetCompany: target,
  fromDate: FROM,
  toDate: TO,
});
if (tb.err) {
  console.error('trial-balance:', tb.text.slice(0, 500));
  process.exit(1);
}
let tid;
try {
  tid = JSON.parse(tb.text).tableID;
} catch {
  console.error('No tableID', tb.text.slice(0, 200));
  process.exit(1);
}

const q = await call(t, sid, 'query-database', {
  sql: `
SELECT ledger_name, net_debit, net_credit,
  (net_credit - net_debit) AS net
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%fee%'
   OR LOWER(ledger_name) LIKE '%tuition%'
ORDER BY ABS(net_debit) + ABS(net_credit) DESC
LIMIT 80
`,
});
console.log('Top fee/tuition-related ledgers (FY 2025-26 trial balance movement context):');
console.log(q.text);

const q2 = await call(t, sid, 'query-database', {
  sql: `
SELECT COUNT(*) AS n_fee_ledgers,
  SUM(ABS(net_debit)) AS sum_abs_debit,
  SUM(ABS(net_credit)) AS sum_abs_credit
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%fee%'
`,
});
console.log('\nAggregate fee* ledgers:', q2.text);

const bo = await call(t, sid, 'bills-outstanding', {
  targetCompany: target,
  nature: 'receivable',
  toDate: '2026-03-31',
});
if (!bo.err) {
  let btid;
  try {
    btid = JSON.parse(bo.text).tableID;
  } catch {
    btid = null;
  }
  if (btid) {
    const bq = await call(t, sid, 'query-database', {
      sql: `SELECT COUNT(*) AS bills, SUM(ABS(outstanding_amount)) AS total_outstanding FROM "${btid}"`,
    });
    console.log('\nBills outstanding (receivable) as on 2026-03-31:', bq.text);
    const sample = await call(t, sid, 'query-database', {
      sql: `SELECT party_name, outstanding_amount, bill_date FROM "${btid}" ORDER BY ABS(outstanding_amount) DESC LIMIT 15`,
    });
    console.log('Top 15 by |outstanding|:', sample.text);
  } else {
    console.log('\nbills-outstanding:', bo.text.slice(0, 400));
  }
} else {
  console.log('\nbills-outstanding error:', bo.text.slice(0, 400));
}
