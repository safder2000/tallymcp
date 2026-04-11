/**
 * Trace company discovery + SVCURRENTCOMPANY switching using the same handlePull() as MCP.
 *
 *   node scripts/test-company-switch-trace.mjs
 *
 * Env: TALLY_HOST (default localhost), TALLY_PORT (default 9000), TALLY_USE_HTTPS
 */
import { handlePull } from '../dist/tally.mjs';

const host = process.env.TALLY_HOST || 'localhost';
const port = process.env.TALLY_PORT || '9000';
process.env.TALLY_HOST = host;
process.env.TALLY_PORT = String(port);

function short(obj, max = 800) {
  const s = JSON.stringify(obj);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function companyNames(data) {
  if (!Array.isArray(data)) return [];
  return data.map((r) => (typeof r?.name === 'string' ? r.name : String(r))).filter(Boolean);
}

console.log(`Tally XML: ${host}:${port} HTTPS=${process.env.TALLY_USE_HTTPS || '(auto)'}\n`);

async function pull(label, fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`${label} THREW: ${msg}`);
    return { error: msg, data: undefined };
  }
}

// 1) Same as MCP: list-of-companies when collection=company without targetCompany
console.log('--- Step 1: handlePull("list-of-companies") [native List of Companies export]');
const listCo = await pull('Step 1', () => handlePull('list-of-companies', new Map()));
if (listCo.error) {
  console.log('ERROR:', listCo.error);
} else {
  const names = companyNames(listCo.data);
  console.log('Companies found:', names.length);
  names.slice(0, 30).forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  if (names.length > 30) console.log(`  … +${names.length - 30} more`);
}

// 2) Fallback path: list-master collection=company (no target) — MCP uses if step 1 fails/empty
console.log('\n--- Step 2: handlePull("list-master", company) [Company collection, no targetCompany]');
const lmCo = await pull('Step 2', () =>
  handlePull('list-master', new Map([['collection', 'company']])),
);
if (lmCo.error) {
  console.log('ERROR:', lmCo.error);
} else {
  const names = companyNames(lmCo.data);
  console.log('Rows:', names.length, short(names.slice(0, 5)));
}

const allNames = listCo.data?.length
  ? companyNames(listCo.data)
  : companyNames(lmCo.data);
const unique = [...new Set(allNames)];
const other =
  unique.length >= 2 ? unique.find((n) => n !== unique[0]) || unique[1] : null;

// 3) Active company (no SVCURRENTCOMPANY in XML): trial balance snippet
const fromDate = '2024-04-01';
const toDate = '2024-04-30';
console.log('\n--- Step 3: trial-balance WITHOUT targetCompany (uses company open in Tally UI)');
const tbOpen = await pull('Step 3', () =>
  handlePull(
    'trial-balance',
    new Map([
      ['fromDate', fromDate],
      ['toDate', toDate],
    ]),
  ),
);
if (tbOpen.error) {
  console.log('ERROR:', tbOpen.error);
} else {
  const rows = tbOpen.data || [];
  console.log('Row count:', rows.length);
  if (rows[0]) console.log('First row sample:', short(rows[0], 400));
}

// 4) Switch: same report with targetCompany = another name from list
if (unique.length >= 2 && other) {
  console.log(
    `\n--- Step 4: trial-balance WITH targetCompany="${other}" (XML SVCURRENTCOMPANY for this request only)`,
  );
  const tbOther = await pull('Step 4', () =>
    handlePull(
      'trial-balance',
      new Map([
        ['fromDate', fromDate],
        ['toDate', toDate],
        ['targetCompany', other],
      ]),
    ),
  );
  if (tbOther.error) {
    console.log('ERROR:', tbOther.error);
  } else {
    const rows = tbOther.data || [];
    console.log('Row count:', rows.length);
    if (rows[0]) console.log('First row sample:', short(rows[0], 400));
  }
  const sameCount =
    (tbOpen.data?.length || 0) === (tbOther.data?.length || 0) &&
    JSON.stringify(tbOpen.data?.[0]) === JSON.stringify(tbOther.data?.[0]);
  console.log(
    '\nCompare Step 3 vs 4: identical first row + count?',
    sameCount ? 'YES (might be same book or Tally ignored switch)' : 'NO (different data — switch likely applied)',
  );
} else if (unique.length === 1) {
  console.log('\n--- Step 4: skipped (only one company in list; need 2+ to compare switch)');
} else {
  console.log('\n--- Step 4: skipped (no company names from Steps 1–2)');
}

// 5) Prove XML path: ledger list for "other" vs default
if (unique.length >= 2 && other) {
  console.log(`\n--- Step 5: list-master ledger WITHOUT targetCompany (active UI company)`);
  const ledOpen = await pull('Step 5', () =>
    handlePull('list-master', new Map([['collection', 'ledger']])),
  );
  console.log(
    ledOpen.error ? `ERROR: ${ledOpen.error}` : `Ledger count: ${ledOpen.data?.length ?? 0}`,
  );

  console.log(`\n--- Step 6: list-master ledger WITH targetCompany="${other}"`);
  const ledOther = await pull('Step 6', () =>
    handlePull(
      'list-master',
      new Map([
        ['collection', 'ledger'],
        ['targetCompany', other],
      ]),
    ),
  );
  console.log(
    ledOther.error ? `ERROR: ${ledOther.error}` : `Ledger count: ${ledOther.data?.length ?? 0}`,
  );
  if (!ledOpen.error && !ledOther.error) {
    const a = new Set((ledOpen.data || []).map((r) => r.name).slice(0, 200));
    const b = new Set((ledOther.data || []).map((r) => r.name).slice(0, 200));
    let diff = 0;
    for (const x of a) if (!b.has(x)) diff++;
    for (const x of b) if (!a.has(x)) diff++;
    console.log('Rough name-set difference (first 200 each):', diff);
  }
}

console.log('\nDone.');
