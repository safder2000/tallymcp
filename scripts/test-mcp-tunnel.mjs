/**
 * Test remote MCP HTTP server through Cloudflare Tunnel.
 * Usage:
 *   node scripts/test-mcp-tunnel.mjs https://sharing-albuquerque-chronic-scored.trycloudflare.com
 *
 * Optional env: MCP_PASSWORD (default: "password")
 */

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: node scripts/test-mcp-tunnel.mjs <TUNNEL_URL>');
  process.exit(2);
}

const password = process.env.MCP_PASSWORD || 'password';
const origin = baseUrl.replace(/\/+$/, '');

async function jsonPost(path, body, headers = {}) {
  const url = `${origin}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json;
  try {
    if (text.startsWith('event:') || text.startsWith('data:')) {
      const dataLine = text.split('\n').find(l => l.startsWith('data:'));
      json = dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    } else {
      json = JSON.parse(text);
    }
  } catch { json = null; }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json };
}

async function jsonGet(path, headers = {}) {
  const url = `${origin}${path}`;
  const res = await fetch(url, { headers, redirect: 'manual' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, location: res.headers.get('location'), text, json };
}

async function main() {
  console.log(`Testing MCP at: ${origin}\n`);

  // 1. Dynamic client registration
  console.log('--- 1. Register OAuth client ---');
  const reg = await jsonPost('/register', {
    client_name: 'tunnel-test',
    redirect_uris: [`${origin}/callback`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
  if (reg.status !== 201 && reg.status !== 200) {
    console.log('Register failed:', reg.status, reg.text.slice(0, 500));
    process.exit(1);
  }
  const { client_id, client_secret } = reg.json;
  console.log(`  client_id: ${client_id}`);
  console.log(`  client_secret: ${client_secret ? '***' : '(none)'}\n`);

  // 2. Authorize → get code (simulate form POST with password)
  console.log('--- 2. Authorize (password login) ---');
  const state = 'teststate123';
  const codeVerifier = 'test_verifier_1234567890123456789012345678901234567890123';
  // SHA256 of codeVerifier base64url
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: `${origin}/callback`,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const authGet = await jsonGet(`/authorize?${authParams}`);
  console.log(`  GET /authorize → ${authGet.status} (${authGet.text.length} chars)`);

  // POST the login form
  const loginRes = await fetch(`${origin}/authorize?${authParams}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password, client_id, redirect_uri: `${origin}/callback`, state, code_challenge: codeChallenge, code_challenge_method: 'S256' }),
    redirect: 'manual',
  });
  const loc = loginRes.headers.get('location') || '';
  const loginBody = await loginRes.text();
  console.log(`  POST /authorize → ${loginRes.status}, location: ${loc.slice(0, 120)}`);
  let code;
  const codeMatch = loc.match(/[?&]code=([^&]+)/);
  if (codeMatch) {
    code = codeMatch[1];
  } else {
    try {
      const j = JSON.parse(loginBody);
      code = j.code;
    } catch {}
  }
  if (!code) {
    console.log('  No auth code found. Body:', loginBody.slice(0, 300));
    process.exit(1);
  }
  console.log(`  auth code: ${code.slice(0, 12)}...\n`);

  // 3. Token exchange
  console.log('--- 3. Token exchange ---');
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
    console.log('  Token failed:', JSON.stringify(tokJson));
    process.exit(1);
  }
  const token = tokJson.access_token;
  console.log(`  access_token: ${token.slice(0, 12)}...\n`);

  // 4. MCP initialize
  console.log('--- 4. MCP initialize ---');
  const initRes = await fetch(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'tunnel-test', version: '1.0.0' },
      },
    }),
  });
  const sessionId = initRes.headers.get('mcp-session-id');
  const initText = await initRes.text();
  let initJson;
  if (initText.startsWith('event:') || initText.startsWith('data:')) {
    const dataLine = initText.split('\n').find(l => l.startsWith('data:'));
    initJson = dataLine ? JSON.parse(dataLine.slice(5).trim()) : {};
  } else {
    initJson = JSON.parse(initText);
  }
  console.log(`  status: ${initRes.status}, session: ${sessionId?.slice(0, 12) || '(none)'}...`);
  console.log(`  server: ${JSON.stringify(initJson?.result?.serverInfo || initJson?.error || {})}\n`);

  if (!sessionId) {
    console.log('No session ID, cannot proceed.');
    process.exit(1);
  }

  const mcpHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'mcp-session-id': sessionId,
  };

  // 5. list tools
  console.log('--- 5. List tools ---');
  const toolsRes = await jsonPost('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, mcpHeaders);
  const tools = toolsRes.json?.result?.tools || [];
  console.log(`  ${tools.length} tools: ${tools.map(t => t.name).join(', ')}\n`);

  // 6. Call list-master company
  console.log('--- 6. Call list-master (company) ---');
  const callRes = await jsonPost('/mcp', {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list-master', arguments: { collection: 'company' } },
  }, mcpHeaders);
  const content = callRes.json?.result?.content || callRes.json?.error || {};
  const textParts = Array.isArray(content)
    ? content.filter(c => c.type === 'text').map(c => c.text).join('\n')
    : JSON.stringify(content);
  console.log(`  status: ${callRes.status}`);
  console.log(`  isError: ${callRes.json?.result?.isError || false}`);
  console.log(`  data:\n${textParts.slice(0, 1500)}\n`);

  console.log('=== TUNNEL TEST COMPLETE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
