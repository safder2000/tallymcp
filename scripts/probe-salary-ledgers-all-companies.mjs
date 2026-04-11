/**
 * Per loaded company: ledgers under salary / staff / wage / payroll-related groups (TB FY25-26).
 * Employee names often appear as sub-ledgers; many books use only one "Salary" control.
 *
 * node --env-file=../../.env scripts/probe-salary-ledgers-all-companies.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
const FROM = '2025-04-01';
const TO = '2026-03-31';
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'emp-probe',
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
          state: 'e',
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
          state: 'e',
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
        clientInfo: { name: 'emp-probe', version: '1' },
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

const disc = await call(t, sid, 'list-master', { collection: 'company' });
if (disc.err) {
  console.error(disc.err);
  process.exit(1);
}
const lines = disc.text.trim().split(/\r?\n/).filter(Boolean);
const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
const companies = [];
for (let i = start; i < lines.length; i++) {
  const n = lines[i].split('\t')[0]?.trim();
  if (n) companies.push(n);
}

/** Groups Tally often uses for pay / staff (broad) + Indirect/Direct expense salary lines */
const groupSql = `
LOWER(group_name) LIKE '%salary%'
OR LOWER(group_name) LIKE '%staff expense%'
OR LOWER(group_name) LIKE '%staff exp%'
OR LOWER(group_name) LIKE '%wage%'
OR LOWER(group_name) LIKE '%payroll%'
OR LOWER(group_name) LIKE '%remuneration%'
OR LOWER(group_name) LIKE '%honorarium%'
OR (LOWER(group_name) LIKE '%indirect%expense%' AND LOWER(ledger_name) LIKE '%salary%')
OR (LOWER(group_name) LIKE '%direct%expense%' AND LOWER(ledger_name) LIKE '%salary%')
`;

/** Control / summary ledgers — not individual employees */
const controlRes = /^(salary|wages|payroll|staff|honorarium|remun|arrear|pending|tds|esi|pf\b|payable)/i;

function looksLikePersonLedger(name) {
  const n = name.trim();
  if (n.length < 4 || n.length > 80) return false;
  if (controlRes.test(n)) return false;
  if (/payable|pending|advance|tds|esi|pf|bank|cash|loan/i.test(n)) return false;
  // Heuristic: space or typical name pattern, not ALL CAPS acronym only
  if (/^[A-Z]{2,6}$/.test(n.replace(/\s/g, ''))) return false;
  return /\s/.test(n) || /[a-z][A-Z]/.test(n);
}

console.log(
  'FY',
  FROM,
  '..',
  TO,
  '| companies:',
  companies.length,
  '\n',
);
console.log(
  'Listing TB rows where group matches salary/staff/wages/payroll/honorarium…',
);
console.log(
  'Heuristic "maybe employee": multi-word or mixed case, excludes obvious control names.\n',
);

for (const co of companies) {
  const tb = await call(t, sid, 'trial-balance', {
    targetCompany: co,
    fromDate: FROM,
    toDate: TO,
  });
  if (tb.err) {
    console.log('\n===', co.slice(0, 70), '===\n TB ERROR:', tb.text.slice(0, 120));
    continue;
  }
  let tid;
  try {
    tid = JSON.parse(tb.text).tableID;
  } catch {
    console.log('\n===', co.slice(0, 70), '===\n no tableID');
    continue;
  }

  const r = await call(t, sid, 'query-database', {
    sql: `
SELECT ledger_name, group_name,
  net_debit, net_credit,
  (ABS(net_debit)+ABS(net_credit)) AS mov
FROM "${tid}"
WHERE (${groupSql.replace(/\n/g, ' ')})
  AND (ABS(net_debit)+ABS(net_credit)) > 0
ORDER BY mov DESC
LIMIT 200
`,
  });
  if (r.err) {
    console.log('\n===', co.slice(0, 70), '===\n SQL ERR:', r.text.slice(0, 200));
    continue;
  }

  const rows = r.text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length <= 1) {
    console.log('\n===', co.slice(0, 70), '===\n (no salary-section movement in TB)');
    continue;
  }

  const dataLines = rows[0].toLowerCase().includes('ledger_name') ? rows.slice(1) : rows;
  const maybeEmp = [];
  const controls = [];
  for (const line of dataLines) {
    const parts = line.split('\t');
    const ledger = parts[0]?.trim() || '';
    if (!ledger) continue;
    if (looksLikePersonLedger(ledger)) maybeEmp.push(line);
    else controls.push(line);
  }

  console.log('\n===', co, '===');
  console.log('  Control / summary lines:', controls.length);
  console.log('  Possible named employee / sub-ledgers:', maybeEmp.length);
  if (maybeEmp.length) {
    console.log('  --- likely persons (sample up to 25) ---');
    maybeEmp.slice(0, 25).forEach((l) => console.log('   ', l.replace(/\t/g, ' | ')));
    if (maybeEmp.length > 25)
      console.log('   ... +', maybeEmp.length - 25, 'more');
  }
  if (controls.length && maybeEmp.length === 0) {
    console.log('  (only consolidated controls — sample) ---');
    controls.slice(0, 12).forEach((l) => console.log('   ', l.replace(/\t/g, ' | ')));
  }
}

console.log('\nDone.');
console.log(
  '\nNote: If books post all pay to one "Salary" ledger, there are no employee lines in TB — need payroll report or voucher detail, not in standard MCP tools as a dedicated "employee list".',
);
