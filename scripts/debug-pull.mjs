/**
 * Direct pull test (no MCP). Shows handlePull result for list-master / company.
 *
 *   $env:TALLY_HOST='tally.emilda.co'; $env:TALLY_PORT='443'; $env:TALLY_USE_HTTPS='1'; node scripts/debug-pull.mjs
 */
import { inspect } from 'node:util';
import { handlePull } from '../dist/tally.mjs';

const host = process.env.TALLY_HOST || 'tally.emilda.co';
const port = process.env.TALLY_PORT || '443';
process.env.TALLY_HOST = host;
process.env.TALLY_PORT = String(port);
if (port === '443' || process.env.TALLY_USE_HTTPS === '1') {
  process.env.TALLY_USE_HTTPS = '1';
}

console.log(`handlePull list-master (company) → ${host}:${port} (HTTPS=${process.env.TALLY_USE_HTTPS})\n`);

const r = await handlePull('list-master', new Map([['collection', 'company']]));
console.log(inspect(r, { depth: 5, colors: false }));
