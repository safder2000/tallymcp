/**
 * Doctor-style questions: balances, hostel income, electricity/water (6 months).
 *   node scripts/doctor-scenario-queries.mjs https://tally.kmctnucleus.com
 *
 * Env: MCP_PASSWORD (from WhatsApp bot .env)
 */
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) {
  console.error('Usage: node scripts/doctor-scenario-queries.mjs <MCP_BASE_URL>');
  process.exit(2);
}
const pw = process.env.MCP_PASSWORD || 'password';
const HOSTEL =
  'Kmct College Hostels-(2022-2023) - (from 1-Apr-22)';
/** Past ~6 months (Indian context; adjust if needed) */
const FROM = '2025-10-01';
const TO = '2026-03-31';
const AS_OF = '2026-03-31';

let rid = 0;

async function connect() {
  const reg = await (
    await fetch(`${origin}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'doctor-scenario',
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
          state: 'd',
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
          state: 'd',
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
        clientInfo: { name: 'doctor-scenario', version: '1.0.0' },
      },
    }),
  });
  const sid = ir.headers.get('mcp-session-id');
  await ir.text();
  return { t: tok.access_token, sid };
}

function parseMcpJson(txt) {
  try {
    if (txt.startsWith('event:') || txt.startsWith('data:')) {
      const dl = txt.split('\n').find((l) => l.startsWith('data:'));
      return dl ? JSON.parse(dl.slice(5).trim()) : null;
    }
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
  const j = parseMcpJson(txt);
  const c = j?.result?.content;
  const text = Array.isArray(c)
    ? c.filter((x) => x.type === 'text').map((x) => x.text).join('')
    : '';
  return { err: !!j?.result?.isError, text };
}

function parseLedgerNames(tsv) {
  const lines = tsv.trim().split(/\r?\n/).filter(Boolean);
  const start = lines[0]?.toLowerCase().includes('name') ? 1 : 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const n = lines[i].split('\t')[0]?.trim();
    if (n) out.push(n);
  }
  return out;
}

function inr(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const x = Number(n);
  return (
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(x)
  );
}

async function main() {
  const { t, sid } = await connect();
  console.log('Company:', HOSTEL);
  console.log('Period for bills/activity:', FROM, '→', TO);
  console.log('As-of date for balances:', AS_OF, '\n');

  const lm = await call(t, sid, 'list-master', {
    collection: 'ledger',
    targetCompany: HOSTEL,
  });
  if (lm.err) {
    console.log('list-master ledger ERROR:', lm.text.slice(0, 500));
    process.exit(1);
  }
  const allLedgers = parseLedgerNames(lm.text);
  console.log('Total ledgers in hostel book:', allLedgers.length, '\n');

  const low = (s) => s.toLowerCase();
  const pick = (re) => allLedgers.filter((n) => re.test(low(n)));

  const electric = pick(/electric|kseb|power|energy|eb\b/);
  /** Prefer real expense ledger, not student names containing "eeb" */
  const electricLedger =
    allLedgers.find((n) => /^electricity charges$/i.test(n.trim())) ||
    electric.find((n) => /electricity|kseb|power bill/i.test(n)) ||
    electric[0];
  const water = pick(/\bwater/);
  const incomeish = pick(
    /income|fees|fee|rent|mess|hostel|accommodation|charges/,
  );
  const cashBank = pick(/^cash|^bank|sbi|hdfc|icici|axis|federal|canara/);

  console.log('── Ledgers matching electricity / power ──');
  electric.slice(0, 25).forEach((n) => console.log(' ', n));
  if (electric.length > 25) console.log(`  … +${electric.length - 25} more`);
  console.log('\n── Ledgers matching water ──');
  water.forEach((n) => console.log(' ', n));
  console.log('\n── Sample income/fee/hostel-related ledgers (first 40) ──');
  incomeish.slice(0, 40).forEach((n) => console.log(' ', n));
  if (incomeish.length > 40) console.log(`  … +${incomeish.length - 40} more`);

  function parseAggRow(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const hdrIdx = lines.findIndex((l) => /total_credit_side/i.test(l));
    if (hdrIdx < 0) return null;
    const delim = lines[hdrIdx].includes('\t') ? '\t' : '|';
    const dataLine =
      lines
        .slice(hdrIdx + 1)
        .find(
          (l) =>
            /^[-\d\s.|,]+$/.test(l.trim()) &&
            (/^\d/.test(l.trim()) || l.trim().startsWith('-')),
        ) || lines[hdrIdx + 1];
    if (!dataLine) return null;
    const parts =
      delim === '|'
        ? dataLine.split('|').map((s) => s.trim())
        : dataLine.split(/\t/).map((s) => s.trim());
    const nums = parts.map((p) => parseFloat(String(p).replace(/,/g, ''), 10));
    if (nums.length < 4 || nums.some((n) => Number.isNaN(n))) return null;
    return {
      voucher_lines: nums[0],
      sum_amount: nums[1],
      total_debit_side: nums[2],
      total_credit_side: nums[3],
    };
  }

  async function periodTotal(ledgerName) {
    const la = await call(t, sid, 'ledger-account', {
      targetCompany: HOSTEL,
      ledgerName,
      fromDate: FROM,
      toDate: TO,
    });
    if (la.err) return { error: la.text.slice(0, 200) };
    let tableID;
    try {
      tableID = JSON.parse(la.text).tableID;
    } catch {
      return { error: 'no tableID' };
    }
    const q = await call(t, sid, 'query-database', {
      sql: `SELECT 
        COUNT(*) AS voucher_lines,
        SUM(amount) AS sum_amount,
        SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS total_debit_side,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS total_credit_side
      FROM "${tableID}"`,
    });
    if (q.err) return { error: q.text };
    const agg = parseAggRow(q.text);
    return { tableID, summary: q.text.trim(), agg };
  }

  async function closingBal(ledgerName) {
    const lb = await call(t, sid, 'ledger-balance', {
      targetCompany: HOSTEL,
      ledgerName,
      toDate: AS_OF,
    });
    if (lb.err) return { error: lb.text.slice(0, 200) };
    try {
      return JSON.parse(lb.text);
    } catch {
      return { raw: lb.text.slice(0, 300) };
    }
  }

  console.log('\n══════════ ANSWERS (usable numbers) ══════════\n');

  const primaryElectric = electricLedger;
  const primaryWater = water[0];

  if (primaryElectric) {
    console.log('1) ELECTRICITY (ledger):', primaryElectric);
    const [b, p] = await Promise.all([
      closingBal(primaryElectric),
      periodTotal(primaryElectric),
    ]);
    console.log('   Closing balance as on', AS_OF, ':', JSON.stringify(b));
    console.log('   Oct–Mar activity:', p.summary || p.error);
    if (electric.length > 1) {
      console.log('   Other name matches:', electric.filter((x) => x !== primaryElectric).slice(0, 6).join('; '));
    }
  } else {
    console.log('1) ELECTRICITY: no ledger matched keywords; refine search in Tally.');
  }

  console.log('');
  if (primaryWater) {
    console.log('2) WATER (best match ledger):', primaryWater);
    const [b, p] = await Promise.all([
      closingBal(primaryWater),
      periodTotal(primaryWater),
    ]);
    console.log('   Closing balance as on', AS_OF, ':', JSON.stringify(b));
    console.log('   Oct–Mar activity:', p.summary || p.error);
    if (water.length > 1) {
      for (const w of water.slice(1, 6)) {
        const p2 = await periodTotal(w);
        console.log('   Also:', w, '→', p2.summary || p2.error);
      }
    }
  } else {
    console.log('2) WATER: no ledger matched "water"; check naming in Tally.');
  }

  const incomeLedgers = [
    'Hostel Fee',
    'Hostel Rent',
    'Hostel Mess Advance',
    'Hostel Rent Advance',
    'Hostel Admission Fee',
    'Miscellanious Income',
  ].filter((name) => allLedgers.some((l) => l === name));

  console.log('\n3) HOSTEL INCOME (named income ledgers, Oct–Mar)');
  let combinedCredit = 0;
  let combinedDebit = 0;
  for (const led of incomeLedgers) {
    const p = await periodTotal(led);
    if (p.summary) {
      if (p.agg) {
        combinedCredit += p.agg.total_credit_side;
        combinedDebit += p.agg.total_debit_side;
      }
      console.log('  ', led);
      console.log('      ', p.summary.replace(/\t/g, ' | ').replace(/\n/g, '\n       '));
      if (p.agg) {
        console.log(
          '      → parsed: credits',
          inr(p.agg.total_credit_side),
          '| debits',
          inr(p.agg.total_debit_side),
          '| lines',
          p.agg.voucher_lines,
        );
      }
    } else {
      console.log('  ', led, '→', p.error);
    }
  }
  console.log(
    '\n   Subtotal (named hostel income ledgers above): movement credit-side Σ ≈',
    inr(combinedCredit),
    '| debit-side Σ ≈',
    inr(combinedDebit),
  );
  console.log(
    '   Note: Caution-deposit ledgers are liabilities, not P&L income — excluded here.',
  );

  let waterDebitTotal = 0;
  console.log('\n3b) WATER — all ledgers with “Water” in name (Oct–Mar expense ≈ debit side)');
  for (const w of water) {
    const p = await periodTotal(w);
    if (p.agg) waterDebitTotal += p.agg.total_debit_side;
    console.log('  ', w, '→', p.summary?.replace(/\t/g, ' | ').replace(/\n/g, ' ') || p.error);
    if (p.agg) console.log('      → period debit movement', inr(p.agg.total_debit_side));
  }
  console.log('   Combined water-related debit movement (period):', inr(waterDebitTotal));

  const pl = await call(t, sid, 'profit-loss', {
    targetCompany: HOSTEL,
    fromDate: FROM,
    toDate: TO,
  });
  if (!pl.err) {
    let tid;
    try {
      tid = JSON.parse(pl.text).tableID;
    } catch {}
    if (tid) {
      const cols = await call(t, sid, 'query-database', {
        sql: `SELECT * FROM "${tid}" LIMIT 3`,
      });
      console.log('\n4) PROFIT & LOSS sample rows (columns):');
      console.log(cols.text.slice(0, 1200));
      const sumq = await call(t, sid, 'query-database', {
        sql: `SELECT COUNT(*) AS n FROM "${tid}"`,
      });
      console.log('   P&L row count:', sumq.text.trim());
      const roll = await call(t, sid, 'query-database', {
        sql: `SELECT 
          group_name,
          SUM(amount) AS total
        FROM "${tid}"
        WHERE group_name ILIKE '%income%' OR group_name ILIKE '%expense%'
        GROUP BY 1 ORDER BY 1`,
      });
      console.log('   P&L roll-up (income/expense groups only):');
      console.log(roll.text.trim());
    }
  } else {
    console.log('\n4) PROFIT & LOSS:', pl.text.slice(0, 400));
  }

  console.log('\n5) CURRENT BALANCE — Cash / Bank style ledgers (closing as on', AS_OF, ')');
  for (const led of cashBank.slice(0, 8)) {
    const b = await closingBal(led);
    console.log('  ', led, '→', JSON.stringify(b));
  }
  if (!cashBank.length) {
    const fallback = allLedgers.filter((n) => /cash|bank/i.test(n)).slice(0, 8);
    for (const led of fallback) {
      const b = await closingBal(led);
      console.log('  ', led, '→', JSON.stringify(b));
    }
  }

  const bs = await call(t, sid, 'balance-sheet', {
    targetCompany: HOSTEL,
    toDate: AS_OF,
  });
  if (!bs.err) {
    let tid;
    try {
      tid = JSON.parse(bs.text).tableID;
    } catch {}
    if (tid) {
      const net = await call(t, sid, 'query-database', {
        sql: `SELECT 
          SUM(closing_balance) AS sum_closing,
          COUNT(*) AS lines
        FROM "${tid}"`,
      });
      console.log('\n6) BALANCE SHEET aggregate (all lines, as on', AS_OF, '):');
      console.log('   ', net.text.trim());
    }
  }

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
