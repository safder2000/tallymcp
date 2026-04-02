/**
 * Spawns the Tally MCP (stdio) and calls list-master with collection=company.
 * Usage (PowerShell):
 *   # If :80 returns HTTP 308 to HTTPS, use TLS (port 443 is auto-HTTPS in tally):
 *   $env:TALLY_HOST='tally.emilda.co'; $env:TALLY_PORT='443'; node scripts/test-mcp-remote.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const mcpEntry = path.join(root, 'dist', 'index.mjs');

const host = process.env.TALLY_HOST || 'tally.emilda.co';
const port = process.env.TALLY_PORT || '443';
const useHttps =
  process.env.TALLY_USE_HTTPS === '1' ||
  process.env.TALLY_USE_HTTPS === 'true' ||
  port === '443';

console.log(
  `Connecting MCP → Tally at ${useHttps ? 'https' : 'http'}://${host}:${port} (via stdio server)...\n`
);

const transport = new StdioClientTransport({
  command: 'node',
  args: [mcpEntry],
  cwd: root,
  env: {
    ...process.env,
    TALLY_HOST: host,
    TALLY_PORT: String(port),
    ...(useHttps ? { TALLY_USE_HTTPS: '1' } : {}),
  },
  stderr: 'inherit',
});

const client = new Client({ name: 'mcp-tunnel-test', version: '1.0.0' });

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`MCP OK — ${tools.length} tools registered.\n`);

  const result = await client.callTool({
    name: 'list-master',
    arguments: { collection: 'company' },
  });

  const texts = (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  if (result.isError) {
    console.error('Tool returned error:\n', texts);
    process.exitCode = 1;
  } else if (!texts.trim()) {
    console.log(
      'MCP + HTTPS tunnel responded, but list-master returned no rows (empty TSV).\n' +
        'Check Tally on the office PC: a company must be loaded, and XML server must be running.'
    );
  } else {
    console.log('list-master (company) — first lines of TSV:\n');
    const preview = texts.length > 1200 ? texts.slice(0, 1200) + '\n… (truncated)' : texts;
    console.log(preview);
    console.log('\n--- Tunnel + MCP path is working. ---');
  }
} catch (e) {
  console.error('Test failed:', e);
  process.exitCode = 1;
} finally {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
}
