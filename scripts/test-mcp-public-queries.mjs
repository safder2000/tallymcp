/**
 * Real MCP queries against public HTTPS endpoint (no SSH).
 *
 * Usage:
 *   node scripts/test-mcp-public-queries.mjs https://tally.kmctnucleus.com
 *
 * Env:
 *   MCP_PASSWORD          — MCP web login (default: password)
 *   TALLY_DEFAULT_COMPANY — exact company name for targetCompany (recommended)
 */
const baseUrl = process.argv[2];
const omitTarget = process.argv[3] === '--no-target-company';
if (!baseUrl) {
  console.error(
    'Usage: node scripts/test-mcp-public-queries.mjs <MCP_BASE_URL> [--no-target-company]',
  );
  process.exit(2);
}

const password = process.env.MCP_PASSWORD || 'password';
const company =
  process.env.TALLY_DEFAULT_COMPANY ||
  'KMCT Polytechnic College-(2021-22) - (from 1-Apr-21)';
const origin = baseUrl.replace(/\/+$/, '');
/** When false, omit targetCompany (uses whatever company is open in Tally). */
const tc = (args) => (omitTarget ? args : { ...args, targetCompany: company });

let rpcId = 1;

async function parseMcpResponse(res) {
  const text = await res.text();
  let json;
  if (text.startsWith('event:') || text.startsWith('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
  } else {
    json = JSON.parse(text);
  }
  return { status: res.status, json, raw: text.slice(0, 400) };
}

async function jsonPost(path, body, headers = {}) {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    if (text.startsWith('event:') || text.startsWith('data:')) {
      const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
      json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    } else {
      json = JSON.parse(text);
    }
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function toolText(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return JSON.stringify(result);
  return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

async function callTool(token, sessionId, name, args) {
  const res = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const { status, json } = await parseMcpResponse(res);
  const r = json?.result;
  return {
    status,
    isError: !!r?.isError,
    text: toolText(r),
    raw: json,
  };
}

async function main() {
  console.log(`Public MCP queries → ${origin}`);
  console.log(
    omitTarget
      ? 'targetCompany: (omitted — uses current company in Tally)\n'
      : `Using targetCompany: "${company}"\n`,
  );

  // --- OAuth (same as test-mcp-tunnel) ---
  const reg = await jsonPost('/register', {
    client_name: 'public-query-test',
    redirect_uris: [`${origin}/callback`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
  if (reg.status !== 201 && reg.status !== 200) {
    console.error('Register failed:', reg.status, reg.text.slice(0, 400));
    process.exit(1);
  }
  const { client_id, client_secret } = reg.json;

  const state = 'q1';
  const codeVerifier = 'v'.repeat(64);
  const hashBuf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: `${origin}/callback`,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const loginRes = await fetch(`${origin}/authorize?${authParams}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      password,
      client_id,
      redirect_uri: `${origin}/callback`,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }),
  });
  const loginBody = await loginRes.text();
  let code;
  try {
    code = JSON.parse(loginBody).code;
  } catch {
    console.error('Auth failed:', loginBody.slice(0, 300));
    process.exit(1);
  }

  const tokRes = await fetch(`${origin}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${origin}/callback`,
      client_id,
      client_secret: client_secret || '',
      code_verifier: codeVerifier,
    }),
  });
  const tokJson = await tokRes.json();
  if (!tokJson.access_token) {
    console.error('Token failed:', tokJson);
    process.exit(1);
  }
  const token = tokJson.access_token;

  const initRes = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++rpcId,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'public-query-test', version: '1.0.0' },
      },
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  const initText = await initRes.text();
  if (!sessionId) {
    console.error('No session:', initText.slice(0, 400));
    process.exit(1);
  }

  console.log('--- Connected: MCP session OK ---\n');

  // 1) Companies in Tally
  console.log('1) list-master (company)');
  let r = await callTool(token, sessionId, 'list-master', tc({ collection: 'company' }));
  console.log(`   isError=${r.isError} status=${r.status}`);
  console.log(`   ${r.text.slice(0, 800)}${r.text.length > 800 ? '…' : ''}\n`);

  // 2) Ledgers — pick first for “recent activity” probe
  console.log('2) list-master (ledger) — first name for ledger-account');
  r = await callTool(token, sessionId, 'list-master', tc({ collection: 'ledger' }));
  let firstLedger = '';
  if (!r.isError && r.text) {
    const lines = r.text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length >= 2) {
      firstLedger = lines[1].split('\t')[0]?.trim() || '';
    }
  }
  console.log(`   isError=${r.isError}`);
  console.log(`   sample (first 400 chars): ${r.text.slice(0, 400)}…`);
  console.log(`   firstLedger picked: "${firstLedger}"\n`);

  // 3) Chart of accounts → DuckDB table
  console.log('3) chart-of-accounts');
  r = await callTool(token, sessionId, 'chart-of-accounts', tc({}));
  console.log(`   isError=${r.isError}`);
  console.log(`   ${r.text}\n`);
  let chartTable = '';
  try {
    chartTable = JSON.parse(r.text).tableID || '';
  } catch {}

  if (chartTable) {
    const q = await callTool(token, sessionId, 'query-database', {
      sql: `SELECT COUNT(*) AS group_rows FROM "${chartTable}"`,
    });
    console.log('   query-database COUNT(chart):');
    console.log(`   ${q.text}\n`);
  }

  // 4) Trial balance (FY 2021–22)
  console.log('4) trial-balance 2021-04-01 .. 2022-03-31');
  r = await callTool(token, sessionId, 'trial-balance', tc({
    fromDate: '2021-04-01',
    toDate: '2022-03-31',
  }));
  console.log(`   isError=${r.isError}`);
  console.log(`   ${r.text.slice(0, 500)}${r.text.length > 500 ? '…' : ''}\n`);
  let tbTable = '';
  try {
    tbTable = JSON.parse(r.text).tableID || '';
  } catch {}

  if (tbTable) {
    const q = await callTool(token, sessionId, 'query-database', {
      sql: `SELECT COUNT(*) AS ledger_rows, SUM(ABS(net_debit)) AS sum_abs_debit FROM "${tbTable}"`,
    });
    console.log('   query-database SUMMARY(trial-balance):');
    console.log(`   ${q.text}\n`);
  }

  // 5) “Last posting” style: max date on one ledger (if we have a name)
  if (firstLedger) {
    console.log(`5) ledger-account (last vouchers in Mar 2022) — "${firstLedger}"`);
    r = await callTool(token, sessionId, 'ledger-account', tc({
      ledgerName: firstLedger,
      fromDate: '2021-04-01',
      toDate: '2022-03-31',
    }));
    console.log(`   isError=${r.isError}`);
    console.log(`   ${r.text.slice(0, 300)}…\n`);
    let laTable = '';
    try {
      laTable = JSON.parse(r.text).tableID || '';
    } catch {}
    if (laTable) {
      const q = await callTool(token, sessionId, 'query-database', {
        sql: `SELECT MAX(date) AS last_voucher_date, COUNT(*) AS voucher_lines FROM "${laTable}"`,
      });
      console.log('   query-database — last voucher date in range for that ledger:');
      console.log(`   ${q.text}\n`);
    }
  } else {
    console.log('5) ledger-account — skipped (no ledger name from list-master)\n');
  }

  console.log('=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
