/**
 * Reproduce: TB > Current Assets > Fee Receivable > grand credit - grand debit.
 * node --env-file=../../.env scripts/reconcile-fee-receivable-group.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
const CO =
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)';
const FROM = '2025-04-01';
const TO = '2026-03-31';

const EXPECT_CREDIT = 37771940;
const EXPECT_DEBIT = 366623;
const EXPECT_NET = EXPECT_CREDIT - EXPECT_DEBIT;

let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'fr-recon',
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
        clientInfo: { name: 'fr', version: '1' },
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

console.log('Company:', CO, '\nPeriod:', FROM, '..', TO);
console.log('\nAccountant drill-down: Current Assets > Fee Receivable');
console.log('Expected: credit', EXPECT_CREDIT, 'debit', EXPECT_DEBIT, 'net', EXPECT_NET);

console.log('\n--- Groups matching fee / receivable / current asset ---\n');
console.log(
  await q(`
SELECT group_name, COUNT(*) AS n_ledgers,
  SUM(net_credit) AS sum_net_credit,
  SUM(net_debit) AS sum_net_debit,
  SUM(ABS(net_credit)) AS sum_abs_credit,
  SUM(ABS(net_debit)) AS sum_abs_debit
FROM "${tid}"
WHERE LOWER(group_name) LIKE '%fee%receiv%'
   OR LOWER(group_name) = 'fee receivable'
   OR (LOWER(group_name) LIKE '%receivable%' AND LOWER(group_name) LIKE '%fee%')
GROUP BY 1
ORDER BY n_ledgers DESC
`),
);

console.log('\n--- Exact group name ILIKE \'%Fee Receivable%\' ---\n');
console.log(
  await q(`
SELECT group_name, COUNT(*) AS n,
  SUM(net_credit) AS sum_cr,
  SUM(net_debit) AS sum_dr,
  SUM(ABS(net_credit)) AS abs_cr,
  SUM(ABS(net_debit)) AS abs_dr
FROM "${tid}"
WHERE group_name ILIKE '%Fee Receivable%'
GROUP BY 1
`),
);

console.log('\n--- All group_names containing Receivable (top by row count) ---\n');
console.log(
  await q(`
SELECT group_name, COUNT(*) AS n
FROM "${tid}"
WHERE group_name ILIKE '%receiv%'
GROUP BY 1
ORDER BY n DESC
LIMIT 40
`),
);

console.log('\n--- chart-of-accounts + Fee Receivable tree ---\n');
const chartRes = await call(t, sid, 'chart-of-accounts', {
  targetCompany: CO,
});
if (!chartRes.err) {
  const cid = JSON.parse(chartRes.text).tableID;
  console.log('Chart rows mentioning Fee + Receivable:\n');
  console.log(
    await q(`
SELECT group_name, group_parent, bs_pl
FROM "${cid}"
WHERE group_name ILIKE '%Fee%Receiv%' OR group_parent ILIKE '%Fee Receivable%'
LIMIT 40
`),
  );
  console.log('\nColumns sample (one row):');
  console.log(await q(`SELECT * FROM "${cid}" LIMIT 1`));

  console.log(
    '\n--- If accountant totals = SUM(ABS(net_credit/debit)) only on direct group name ---\n',
  );
  console.log(
    await q(`
SELECT group_name, COUNT(*) AS n,
  SUM(ABS(net_credit))::BIGINT AS grand_credit_display,
  SUM(ABS(net_debit))::BIGINT AS grand_debit_display,
  SUM(ABS(net_credit)) - SUM(ABS(net_debit)) AS net_abs_style
FROM "${tid}"
WHERE group_name ILIKE '%Fee Receivable%'
GROUP BY 1
`),
  );

  console.log(
    '\n--- Recursive: all subgroups under "Fee Receivable" (chart) → TB rollup (matches Tally drill-down) ---\n',
  );
  const rollup = await q(`
WITH RECURSIVE sub AS (
  SELECT CAST('Fee Receivable' AS VARCHAR) AS gname
  UNION ALL
  SELECT c.group_name FROM "${cid}" c
  INNER JOIN sub s ON c.group_parent = s.gname
)
SELECT
  (SELECT COUNT(DISTINCT gname) FROM sub) AS distinct_groups_in_tree,
  COUNT(*) AS ledger_rows_in_tb,
  SUM(ABS(t.net_credit))::BIGINT AS grand_total_credit,
  SUM(ABS(t.net_debit))::BIGINT AS grand_total_debit,
  (SUM(ABS(t.net_credit)) - SUM(ABS(t.net_debit)))::BIGINT AS net_like_accountant
FROM "${tid}" t
WHERE t.group_name IN (SELECT gname FROM sub)
`);
  console.log(rollup);

  console.log('\n--- Sample subgroup names under tree (first 30) ---\n');
  console.log(
    await q(`
WITH RECURSIVE sub AS (
  SELECT CAST('Fee Receivable' AS VARCHAR) AS gname
  UNION ALL
  SELECT c.group_name FROM "${cid}" c
  INNER JOIN sub s ON c.group_parent = s.gname
)
SELECT gname FROM sub ORDER BY 1 LIMIT 30
`),
  );
  console.log(
    '\n--- Same rollup but Fee Receivable + Hostel Fee Receivable trees (both under Current Assets) ---\n',
  );
  const dual = await q(`
WITH RECURSIVE sub AS (
  SELECT gname FROM (VALUES ('Fee Receivable'), ('Hostel Fee Receivable')) AS t(gname)
  UNION ALL
  SELECT c.group_name FROM "${cid}" c
  INNER JOIN sub s ON c.group_parent = s.gname
)
SELECT
  (SELECT COUNT(DISTINCT s2.gname) FROM sub s2) AS distinct_groups,
  COUNT(*) AS ledger_rows,
  SUM(ABS(t.net_credit))::BIGINT AS abs_sum_credit,
  SUM(ABS(t.net_debit))::BIGINT AS abs_sum_debit,
  (SUM(ABS(t.net_credit)) - SUM(ABS(t.net_debit)))::BIGINT AS net_abs
FROM "${tid}" t
WHERE t.group_name IN (SELECT gname FROM sub)
`);
  console.log(dual);

  console.log(
    '\n--- Tally-style column try: credit col = positive credits only, debit col = positive debits only ---\n',
  );
  const style = await q(`
WITH RECURSIVE sub AS (
  SELECT CAST('Fee Receivable' AS VARCHAR) AS gname
  UNION ALL
  SELECT c.group_name FROM "${cid}" c
  INNER JOIN sub s ON c.group_parent = s.gname
)
SELECT
  SUM(CASE WHEN t.net_credit < 0 THEN -t.net_credit WHEN t.net_credit > 0 THEN t.net_credit ELSE 0 END)::BIGINT AS sum_credit_side,
  SUM(CASE WHEN t.net_debit > 0 THEN t.net_debit WHEN t.net_debit < 0 THEN -t.net_debit ELSE 0 END)::BIGINT AS sum_debit_side
FROM "${tid}" t
WHERE t.group_name IN (SELECT gname FROM sub)
`);
  console.log(style);

  console.log('\n--- Closing balance sum (subtree) — may differ from period Dr/Cr totals ---\n');
  console.log(
    await q(`
WITH RECURSIVE sub AS (
  SELECT CAST('Fee Receivable' AS VARCHAR) AS gname
  UNION ALL
  SELECT c.group_name FROM "${cid}" c
  INNER JOIN sub s ON c.group_parent = s.gname
)
SELECT
  SUM(t.closing_balance) AS sum_closing,
  SUM(ABS(t.closing_balance))::BIGINT AS sum_abs_closing
FROM "${tid}" t
WHERE t.group_name IN (SELECT gname FROM sub)
`),
  );
} else {
  console.log(chartRes.text.slice(0, 300));
}
