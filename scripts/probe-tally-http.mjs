/**
 * Raw probe: POST minimal body like Tally expects, log status + body length + preview.
 */
import http from 'node:http';
import https from 'node:https';

const host = process.env.TALLY_HOST || 'tally.emilda.co';
const port = parseInt(process.env.TALLY_PORT || '80', 10);
const useHttps = process.env.TALLY_HTTPS === '1' || process.env.TALLY_HTTPS === 'true';

const xml = '<?xml version="1.0" encoding="UTF-16"?><ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>';

const opts = {
  hostname: host,
  port,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'text/xml;charset=utf-16',
    'Content-Length': Buffer.byteLength(xml, 'utf16le'),
  },
};

const lib = useHttps ? https : http;
console.log(`Probe ${useHttps ? 'https' : 'http'}://${host}:${port}/ POST …`);

const req = lib.request(opts, (res) => {
  console.log('statusCode:', res.statusCode);
  console.log('headers:', JSON.stringify(res.headers, null, 2));
  let buf = Buffer.alloc(0);
  res.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
  });
  res.on('end', () => {
    console.log('body bytes:', buf.length);
    if (buf.length) console.log('preview (utf8):', buf.toString('utf8').slice(0, 400));
  });
});
req.on('error', (e) => console.error('req error:', e.message));
req.write(xml, 'utf16le');
req.end();
