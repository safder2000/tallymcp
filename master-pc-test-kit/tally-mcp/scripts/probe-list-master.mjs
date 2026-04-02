/**
 * POST list-master (company) to Tally XML port; print raw XML (first 12k chars).
 * Run: cd tally-mcp && node scripts/probe-list-master.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import nunjucks from 'nunjucks';

const pullDir = path.join(process.cwd(), 'pull');
const xmlPath = path.join(pullDir, 'list-master.xml');
if (!fs.existsSync(xmlPath)) {
  console.error('Need ./pull/list-master.xml. cd into tally-mcp first. cwd=', process.cwd());
  process.exit(1);
}

nunjucks.configure({
  tags: {
    blockStart: '<nunjuck>',
    blockEnd: '</nunjuck>',
    variableStart: '{{',
    variableEnd: '}}',
    commentStart: '<comment>begin</comment>',
    commentEnd: '<comment>end</comment>',
  },
});

const tmpl = fs.readFileSync(xmlPath, 'utf8');
const ctx = { collection: 'company' };
const dc = (process.env.TALLY_DEFAULT_COMPANY || '').trim();
if (dc) ctx.targetCompany = dc;
const xml = nunjucks.renderString(tmpl, ctx);
const host = process.env.TALLY_HOST || '127.0.0.1';
const port = parseInt(process.env.TALLY_PORT || '9000', 10);

const req = http.request(
  {
    hostname: host,
    port,
    method: 'POST',
    path: '',
    headers: {
      'Content-Type': 'text/xml;charset=utf-16',
      'Content-Length': Buffer.byteLength(xml, 'utf16le'),
    },
  },
  (res) => {
    let data = '';
    res.setEncoding('utf16le');
    res.on('data', (c) => {
      data += c;
    });
    res.on('end', () => {
      console.log('--- status', res.statusCode, 'chars', data.length);
      console.log(data.slice(0, 12000));
    });
  },
);
req.on('error', (e) => console.error(e));
req.write(xml, 'utf16le');
req.end();
