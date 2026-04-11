/**
 * Reconcile MCP trial-balance SQL vs Tally screen (fee totals).
 * node --env-file=../../.env scripts/reconcile-pharmacy-fees.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
const CO =
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)';
const FROM = '2025-04-01';
const TO = '2026-03-31';
const TALLY_USER_FIGURE = 37405317; // user said Tally shows this

let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'recon',
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
          state: 'r',
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
          state: 'r',
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
        clientInfo: { name: 'recon', version: '1.0.0' },
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
  if (r.err) return 'ERR: ' + r.text;
  return r.text.trim();
}

console.log('Company:', CO);
console.log('Period:', FROM, '..', TO);
console.log('\n--- A) Column check (one row) ---\n');
console.log(await q(`SELECT * FROM "${tid}" LIMIT 1`));

console.log('\n--- B) Previous bot logic: fee/tuition NAME filter only ---\n');
console.log(
  await q(`
SELECT 
  COUNT(*) AS n_ledgers,
  SUM(ABS(net_debit)) AS sum_abs_net_debit,
  SUM(ABS(net_credit)) AS sum_abs_net_credit
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%fee%'
   OR LOWER(ledger_name) LIKE '%tuition%'
`),
);

console.log('\n--- C) Same filter but SUM raw net_credit / net_debit (signed) ---\n');
console.log(
  await q(`
SELECT 
  SUM(net_debit) AS sum_net_debit,
  SUM(net_credit) AS sum_net_credit
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%fee%'
   OR LOWER(ledger_name) LIKE '%tuition%'
`),
);

console.log('\n--- D) Main fee ledgers: opening, period, closing (exact names) ---\n');
console.log(
  await q(`
SELECT ledger_name, group_name, opening_balance, net_debit, net_credit, closing_balance
FROM "${tid}"
WHERE ledger_name IN (
  'Tuition Fee',
  'Special Fee',
  'Admission Fee',
  'Tuition  Fee  Advance'
)
ORDER BY ledger_name
`),
);

console.log('\n--- E) Direct Incomes group: aggregates (Tally often groups fees here) ---\n');
console.log(
  await q(`
SELECT 
  COUNT(*) AS n_ledgers,
  SUM(ABS(net_debit)) AS sum_abs_dr,
  SUM(ABS(net_credit)) AS sum_abs_cr,
  SUM(net_debit) AS sum_dr,
  SUM(net_credit) AS sum_cr
FROM "${tid}"
WHERE LOWER(group_name) LIKE '%direct%income%'
   OR LOWER(group_name) = 'direct incomes'
`),
);

console.log(
  '\n--- F) All group_name values containing Income (sample counts) ---\n' +
    (await q(`
SELECT group_name, COUNT(*) AS n, SUM(ABS(net_credit)) AS abs_cr_sum
FROM "${tid}"
WHERE LOWER(group_name) LIKE '%income%'
GROUP BY 1
ORDER BY abs_cr_sum DESC NULLS LAST
LIMIT 25
`)),
);

console.log('\n--- G) P&L tool same period (Direct Incomes total) ---\n');
const pl = await call(t, sid, 'profit-loss', {
  targetCompany: CO,
  fromDate: FROM,
  toDate: TO,
});
if (!pl.err) {
  const plid = JSON.parse(pl.text).tableID;
  console.log(
    await q(`
SELECT group_name, SUM(amount) AS total
FROM "${plid}"
WHERE LOWER(group_name) LIKE '%income%'
GROUP BY 1
ORDER BY ABS(total) DESC
`),
  );
  console.log(
    '\nP&L lines with fee/tuition in name:\n' +
      (await q(`
SELECT ledger_name, group_name, amount
FROM "${plid}"
WHERE LOWER(ledger_name) LIKE '%fee%' OR LOWER(ledger_name) LIKE '%tuition%'
ORDER BY ABS(amount) DESC
LIMIT 40
`)),
  );
} else {
  console.log(pl.text.slice(0, 400));
}

console.log('\n--- H) Match user figure', TALLY_USER_FIGURE, '---');
console.log(
  'Difference vs (B) sum_abs_net_credit on fee-name filter:',
  TALLY_USER_FIGURE - 33829876,
  '(if your run was 33829876)',
);

console.log('\n--- I) Ledgers in Direct Incomes with largest |net_credit| (not only name fee) ---\n');
console.log(
  await q(`
SELECT ledger_name, group_name, net_debit, net_credit, closing_balance
FROM "${tid}"
WHERE LOWER(group_name) LIKE '%direct%income%' OR LOWER(group_name) = 'direct incomes'
ORDER BY ABS(net_credit) + ABS(net_debit) DESC
LIMIT 35
`),
);

console.log(
  '\n--- J) Every ledger in group "Tuition Fee and Other Income" ---\n' +
    (await q(`
SELECT ledger_name, opening_balance, net_debit, net_credit, closing_balance
FROM "${tid}"
WHERE group_name = 'Tuition Fee and Other Income'
ORDER BY ABS(net_credit) + ABS(net_debit) DESC
`)),
);

console.log(
  '\n--- K) Compare totals ---\n' +
    (await q(`
SELECT 'fee_or_tuition_in_name__sum_abs_net_credit' AS label, SUM(ABS(net_credit))::BIGINT AS v
FROM "${tid}"
WHERE LOWER(ledger_name) LIKE '%fee%' OR LOWER(ledger_name) LIKE '%tuition%'
UNION ALL
SELECT 'group_Tuition_Fee_and_Other_Income__sum_abs_net_credit', SUM(ABS(net_credit))::BIGINT
FROM "${tid}" WHERE group_name = 'Tuition Fee and Other Income'
UNION ALL
SELECT 'only_3_ledgers_Tuition_Special_Admission', SUM(ABS(net_credit))::BIGINT
FROM "${tid}" WHERE ledger_name IN ('Tuition Fee','Special Fee','Admission Fee')
`)),
);
