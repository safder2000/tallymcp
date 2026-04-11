/**
 * Discover loaded companies + probe ALL known names from Tally screenshots.
 * Shows which companies are accessible via SVCURRENTCOMPANY and which are not.
 *
 *   node scripts/probe-all-companies.mjs https://tally.kmctnucleus.com
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) { console.error('Usage: node scripts/probe-all-companies.mjs <URL>'); process.exit(2); }
const pw = process.env.MCP_PASSWORD || 'password';
let rid = 0;

async function connect() {
  const reg = await (await fetch(`${origin}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'probe', redirect_uris: [`${origin}/callback`], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'client_secret_post' }) })).json();
  const cv = 'w'.repeat(64);
  const hb = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cv));
  const cc = btoa(String.fromCharCode(...new Uint8Array(hb))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const lr = await (await fetch(`${origin}/authorize?` + new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: `${origin}/callback`, state: 'p', code_challenge: cc, code_challenge_method: 'S256' }), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: pw, client_id: reg.client_id, redirect_uri: `${origin}/callback`, state: 'p', code_challenge: cc, code_challenge_method: 'S256' }) })).json();
  const tok = await (await fetch(`${origin}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: lr.code, redirect_uri: `${origin}/callback`, client_id: reg.client_id, client_secret: reg.client_secret || '', code_verifier: cv }) })).json();
  const ir = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '1.0.0' } } }) });
  const sid = ir.headers.get('mcp-session-id'); await ir.text();
  return { t: tok.access_token, sid };
}

async function call(t, sid, name, args) {
  const r = await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${t}`, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) });
  const txt = await r.text(); let j;
  try { if (txt.startsWith('event:') || txt.startsWith('data:')) { const dl = txt.split('\n').find(l => l.startsWith('data:')); j = dl ? JSON.parse(dl.slice(5)) : null; } else { j = JSON.parse(txt); } } catch { j = null; }
  const c = j?.result?.content;
  return { isError: !!j?.result?.isError, text: Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('') : '' };
}

const ALL_NAMES = [
  'KMCT College of Architecture - (2022-2023) - (from 1-Apr-22)',
  'KMCT College of Engineering -(2022-23) - (from 1-Apr-22)',
  'KMCT College of Engineering for Women -(2022-23) - (from 1-Apr-22)',
  'KMCT Polytechnic College-(2022-23) - (from 1-Apr-22)',
  'KMCT School of Business (2022-23) - (from 1-Apr-22)',
  'KMCT College, Pooladikunnu - (2022-23) - (from 1-Apr-22)',
  'Kmct College Hostels-(2022-2023) - (from 1-Apr-22)',
  'KMCT College of Pharmaceutical Sciences(2022-23) - (from 1-Apr-22)',
  'KMCT-Teacher Education - (2022-23) - (from 1-Apr-22)',
  'KMCT-Teacher Trainning Institute - (2022-23) - (from 1-Apr-22)',
  'Komath Mehboob Charitable Trust-(2022-23) - (from 1-Apr-22)',
  'MANNAKADAVU ARTS AND SCIENCES COLLEGE-(2022-23) - (from 1-Apr-22)',
  'National Hospital College of Nursing -(2022-23) - (from 1-Apr-22)',
  'KMCT College of Architecture - (2021-2022) - (from 1-Apr-21)',
  'KMCT College of Engineering -(2021-22) - (from 1-Apr-21)',
  'KMCT College of Engineering for Women -(2021-22) - (from 1-Apr-21)',
  'KMCT Polytechnic College-(2021-22) - (from 1-Apr-21)',
  'KMCT School of Business (2021-22) - (from 1-Apr-21)',
  'KMCT College, Pooladikunnu - (2021-22) - (from 1-Apr-21)',
  'Kmct College Hostels-(2021-2022) - (from 1-Apr-21)',
  'KMCT College of Pharmaceutical Sciences(2021-22) - (from 1-Apr-21)',
  'KMCT-Teacher Education - (2021-22) - (from 1-Apr-21)',
  'KMCT-Teacher Trainning Institute - (2021-22) - (from 1-Apr-21)',
  'Komath Mehboob Charitable Trust-(2021-22) - (from 1-Apr-21)',
  'MANNAKADAVU ARTS AND SCIENCES COLLEGE-(2021-22) - (from 1-Apr-21)',
  'National Hospital College of Nursing -(2021-22) - (from 1-Apr-21)',
];

async function main() {
  console.log(`=== Company Probe → ${origin} ===\n`);
  const { t, sid } = await connect();
  console.log('MCP session OK.\n');

  // Step 1: discover
  console.log('═══ STEP 1: DISCOVER (list-master company, no targetCompany) ═══');
  const disc = await call(t, sid, 'list-master', { collection: 'company' });
  const loaded = [];
  if (disc.isError) {
    console.log('ERROR: ' + disc.text.slice(0, 300));
  } else {
    const lines = disc.text.trim().split(/\r?\n/).filter(Boolean);
    const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const n = lines[i].split('\t')[0]?.trim();
      if (n) loaded.push(n);
    }
    console.log(`Discovered ${loaded.length} loaded company(ies):`);
    loaded.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  }

  // Step 2: probe every known name
  console.log('\n═══ STEP 2: PROBE ALL 26 KNOWN NAMES ═══');
  console.log('Using chart-of-accounts to test (lightweight, shows group count)\n');

  const results = [];
  for (const name of ALL_NAMES) {
    const r = await call(t, sid, 'chart-of-accounts', { targetCompany: name });
    let status, groups = null;
    if (r.isError) {
      if (r.text.includes('Could not set') || r.text.includes('Could not find'))
        status = 'NOT LOADED';
      else if (r.text.includes('request failed'))
        status = 'CONN FAIL';
      else
        status = 'ERROR';
    } else {
      status = 'OK';
      try {
        const tid = JSON.parse(r.text).tableID;
        const q = await call(t, sid, 'query-database', { sql: `SELECT COUNT(*) AS n FROM "${tid}"` });
        const m = /\n(\d+)/m.exec(q.text);
        groups = m ? parseInt(m[1], 10) : null;
      } catch {}
    }
    const inLoaded = loaded.some(l => l === name);
    results.push({ name, status, groups, inLoaded });
    const short = name.length > 60 ? name.slice(0, 57) + '...' : name;
    const tag = status === 'OK'
      ? `OK  (${String(groups ?? '?').padStart(3)} groups)`
      : status.padEnd(16);
    const flag = inLoaded ? ' [discovered]' : '';
    console.log(`  ${tag}  ${short}${flag}`);
  }

  // Summary
  const ok = results.filter(r => r.status === 'OK');
  const notLoaded = results.filter(r => r.status === 'NOT LOADED');
  const fail = results.filter(r => r.status !== 'OK' && r.status !== 'NOT LOADED');

  console.log('\n═══ SUMMARY ═══');
  console.log(`Accessible (OK):   ${ok.length} companies`);
  console.log(`Not loaded (FAIL): ${notLoaded.length} companies`);
  if (fail.length) console.log(`Other errors:      ${fail.length}`);

  if (ok.length >= 2) {
    console.log('\nAccessible companies with different group counts (proves switching works):');
    const seen = new Set();
    for (const r of ok) {
      if (r.groups != null && !seen.has(r.groups)) {
        seen.add(r.groups);
        console.log(`  ${r.groups} groups → ${r.name}`);
      }
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
