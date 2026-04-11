/**
 * Find bank ledgers matching Ujjivan / small finance / spelling variants.
 * node --env-file=../../.env scripts/probe-ujjivan-bank.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
const pw = process.env.MCP_PASSWORD || 'password';
let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'bank-probe',
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
          state: 'b',
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
          state: 'b',
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
        clientInfo: { name: 'bank-probe', version: '1' },
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

function parseLedgers(tsv) {
  const lines = tsv.trim().split(/\r?\n/).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const n = lines[i].split('\t')[0]?.trim();
    if (n) out.push(n);
  }
  return out;
}

const patterns = [
  /ujjivan/i,
  /ujjiv/i,
  /small finance/i,
  /sfb\b/i,
  /ujivan/i, // typo
];

const { t, sid } = await connect();

const disc = await call(t, sid, 'list-master', { collection: 'company' });
if (disc.err) {
  console.error(disc.text);
  process.exit(1);
}
const clines = disc.text.trim().split(/\r?\n/).filter(Boolean);
const cstart = clines[0]?.toLowerCase().includes('name') ? 1 : 0;
const companies = [];
for (let i = cstart; i < clines.length; i++) {
  const n = clines[i].split('\t')[0]?.trim();
  if (n) companies.push(n);
}

console.log('Searching', companies.length, 'loaded companies for Ujjivan-like bank ledgers…\n');

const AS_OF = '2026-03-31';
const hits = [];

for (const co of companies) {
  const lm = await call(t, sid, 'list-master', {
    collection: 'ledger',
    targetCompany: co,
  });
  if (lm.err) {
    console.log('[skip]', co.slice(0, 50), lm.text.slice(0, 80));
    continue;
  }
  const ledgers = parseLedgers(lm.text);
  for (const L of ledgers) {
    if (patterns.some((re) => re.test(L))) {
      hits.push({ co, L });
    }
  }
}

if (hits.length === 0) {
  console.log('No ledger name matched ujjivan / small finance / common typos.');
  console.log('\nTrying broader: any ledger containing "Bank" + short list sample per company…');
  for (const co of companies.slice(0, 4)) {
    const lm = await call(t, sid, 'list-master', {
      collection: 'ledger',
      targetCompany: co,
    });
    if (lm.err) continue;
    const ledgers = parseLedgers(lm.text);
    const banks = ledgers.filter((L) => /bank/i.test(L)).slice(0, 15);
    if (banks.length)
      console.log('\n', co.slice(0, 70), '\n ', banks.join('\n  '));
  }
  process.exit(0);
}

console.log('Matches:', hits.length);
for (const { co, L } of hits) {
  const lb = await call(t, sid, 'ledger-balance', {
    targetCompany: co,
    ledgerName: L,
    toDate: AS_OF,
  });
  let bal = lb.text;
  try {
    bal = JSON.stringify(JSON.parse(lb.text));
  } catch {
    /* raw */
  }
  console.log('\nCompany:', co);
  console.log(' Ledger:', L);
  console.log(' ledger-balance as on', AS_OF, ':', bal);
}
