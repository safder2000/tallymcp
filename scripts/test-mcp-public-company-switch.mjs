/**
 * OAuth → public MCP → prove company discovery + SVCURRENTCOMPANY switching.
 * Uses company names from Tally screenshots to try switching to companies
 * even if "list of companies" only returns one.
 *
 *   node scripts/test-mcp-public-company-switch.mjs https://tally.kmctnucleus.com
 *
 * Env: MCP_PASSWORD (default: password)
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) {
  console.error('Usage: node scripts/test-mcp-public-company-switch.mjs <MCP_BASE_URL>');
  process.exit(2);
}

const password = process.env.MCP_PASSWORD || 'password';
let rpcId = 0;

const KNOWN_COMPANIES_2022_23 = [
  'KMCT College of Engineering -(2022-23) - (from 1-Apr-22)',
  'KMCT College of Architecture - (2022-2023) - (from 1-Apr-22)',
  'KMCT College of Engineering for Women -(2022-23) - (from 1-Apr-22)',
  'KMCT Polytechnic College-(2022-23) - (from 1-Apr-22)',
  'KMCT School of Business (2022-23) - (from 1-Apr-22)',
  'KMCT College, Pooladikunnu - (2022-23) - (from 1-Apr-22)',
  'Kmct College Hostels-(2022-2023) - (from 1-Apr-22)',
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)',
  'KMCT-Teacher Education - (2022-23) - (from 1-Apr-22)',
  'Komath Mehboob Charitable Trust-(2022-23) - (from 1-Apr-22)',
  'MANNAKADAVU ARTS AND SCIENCES COLLEGE-(2022-23) - (from 1-Apr-22)',
  'National Hospital College of Nursing -(2022-23) - (from 1-Apr-22)',
];

const KNOWN_COMPANIES_2021_22 = [
  'KMCT College of Engineering -(2021-22) - (from 1-Apr-21)',
  'KMCT College of Architecture - (2021-2022) - (from 1-Apr-21)',
  'KMCT Polytechnic College-(2021-22) - (from 1-Apr-21)',
  'KMCT School of Business (2021-22) - (from 1-Apr-21)',
];

async function parseMcpResponse(res) {
  const text = await res.text();
  let json;
  if (text.startsWith('event:') || text.startsWith('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
  } else {
    json = JSON.parse(text);
  }
  return { status: res.status, json };
}

async function jsonPost(path, body) {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text.startsWith('event:') || text.startsWith('data:')
      ? JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5)?.trim() || 'null')
      : JSON.parse(text);
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
  const { json } = await parseMcpResponse(res);
  const r = json?.result;
  return { isError: !!r?.isError, text: toolText(r) };
}

function parseCompanyTsv(tsv) {
  const lines = tsv.trim().split(/\r?\n/).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
  const names = [];
  for (let i = start; i < lines.length; i++) {
    const name = lines[i].split('\t')[0]?.trim();
    if (name) names.push(name);
  }
  return [...new Set(names)];
}

async function connect() {
  const reg = await jsonPost('/register', {
    client_name: 'company-switch-trace',
    redirect_uris: [`${origin}/callback`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`register ${reg.status}: ${reg.text?.slice(0, 200)}`);
  }
  const { client_id, client_secret } = reg.json;

  const state = 'sw2';
  const codeVerifier = 'w'.repeat(64);
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
  try { code = JSON.parse(loginBody).code; } catch {
    throw new Error(`auth: ${loginBody.slice(0, 200)}`);
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
  if (!tokJson.access_token) throw new Error(`token: ${JSON.stringify(tokJson)}`);
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
        clientInfo: { name: 'company-switch-trace', version: '1.0.0' },
      },
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  await initRes.text();
  if (!sessionId) throw new Error('no mcp-session-id');
  return { token, sessionId };
}

function short(s, n = 70) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  console.log(`=== Company Switch Trace → ${origin} ===\n`);
  const { token, sessionId } = await connect();
  console.log('MCP session OK.\n');

  // ── A) Discovery: what does the MCP return? ──────────────────────────
  console.log('═══ A) COMPANY DISCOVERY ═══');
  console.log('A1) list-master collection=company (no targetCompany) — native List of Companies');
  const list = await callTool(token, sessionId, 'list-master', { collection: 'company' });
  console.log(`    isError=${list.isError}`);
  const discovered = parseCompanyTsv(list.text);
  console.log(`    Discovered ${discovered.length} company(ies):`);
  discovered.forEach((n, i) => console.log(`      ${i + 1}. ${n}`));

  // ── B) Baseline: trial-balance for the "current" (open) company ──────
  console.log('\n═══ B) BASELINE: current company (no targetCompany) ═══');
  const fromDate = '2022-04-01';
  const toDate = '2023-03-31';
  console.log(`B1) trial-balance ${fromDate} .. ${toDate}`);
  const b1 = await callTool(token, sessionId, 'trial-balance', { fromDate, toDate });
  let b1Count = '?';
  if (!b1.isError) {
    try {
      const tid = JSON.parse(b1.text).tableID;
      const q = await callTool(token, sessionId, 'query-database', {
        sql: `SELECT COUNT(*) AS n FROM "${tid}"`,
      });
      b1Count = q.text.trim().split('\n').pop()?.trim() || '?';
    } catch {}
  }
  console.log(`    isError=${b1.isError}  ledger rows: ${b1Count}`);

  console.log(`B2) ledger list (no targetCompany)`);
  const b2 = await callTool(token, sessionId, 'list-master', { collection: 'ledger' });
  const b2Lines = b2.text.trim().split('\n').length - 1;
  console.log(`    isError=${b2.isError}  ledger count: ${b2Lines}`);

  // ── C) SWITCH TEST: try each known company name from screenshots ─────
  console.log('\n═══ C) SWITCH TEST: targetCompany on known names from Tally screenshots ═══');

  const tryCompany = async (label, name) => {
    console.log(`\n── ${label}: "${short(name)}" ──`);

    console.log('  C.1) list-master ledger');
    const led = await callTool(token, sessionId, 'list-master', {
      collection: 'ledger',
      targetCompany: name,
    });
    if (led.isError) {
      console.log(`       ERROR: ${led.text.slice(0, 200)}`);
    } else {
      const cnt = led.text.trim().split('\n').length - 1;
      console.log(`       OK — ${cnt} ledgers  (baseline was ${b2Lines})`);
    }

    console.log('  C.2) trial-balance');
    const tb = await callTool(token, sessionId, 'trial-balance', {
      fromDate,
      toDate,
      targetCompany: name,
    });
    if (tb.isError) {
      console.log(`       ERROR: ${tb.text.slice(0, 200)}`);
    } else {
      let cnt = '?';
      try {
        const tid = JSON.parse(tb.text).tableID;
        const q = await callTool(token, sessionId, 'query-database', {
          sql: `SELECT COUNT(*) AS n FROM "${tid}"`,
        });
        cnt = q.text.trim().split('\n').pop()?.trim() || '?';
      } catch {}
      console.log(`       OK — ${cnt} ledger rows  (baseline was ${b1Count})`);
    }
  };

  // FY 2022-23 companies (same year as currently open)
  const testSet = [
    KNOWN_COMPANIES_2022_23[1],  // Architecture
    KNOWN_COMPANIES_2022_23[3],  // Polytechnic
    KNOWN_COMPANIES_2022_23[4],  // School of Business
    KNOWN_COMPANIES_2022_23[6],  // Hostels
  ];

  for (let i = 0; i < testSet.length; i++) {
    await tryCompany(`C${i + 1} (2022-23)`, testSet[i]);
  }

  // Try one from 2021-22 (different data path / FY)
  if (KNOWN_COMPANIES_2021_22.length > 0) {
    await tryCompany('C5 (2021-22 cross-year)', KNOWN_COMPANIES_2021_22[2]); // Polytechnic 21-22
  }

  // ── D) Summary ───────────────────────────────────────────────────────
  console.log('\n═══ D) SUMMARY ═══');
  console.log(`Baseline (current company, no targetCompany): ${b1Count} trial-balance rows, ${b2Lines} ledgers`);
  console.log('If C steps above show DIFFERENT counts → SVCURRENTCOMPANY switching works.');
  console.log('If they show ERROR → Tally security or company name mismatch.');
  console.log('If same counts → might be same data (verify names match exactly).');
  console.log('\n=== Done ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
