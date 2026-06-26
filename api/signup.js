// Serverless endpoint: appends a booking to a Google Sheet via the Sheets API.
// Zero npm dependencies — uses only Node built-ins (crypto + global fetch).
//
// Required Vercel environment variables (Project → Settings → Environment Variables):
//   GOOGLE_SA_EMAIL        service account email  (xxx@yyy.iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY  the service account private key (full PEM, BEGIN…END)
//   SHEET_ID               the spreadsheet id from the sheet URL .../d/<ID>/edit
//   SHEET_TAB              (optional) tab name to write to, defaults to "Signups"
//
// The Sheet must be shared with GOOGLE_SA_EMAIL as an Editor.

const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(email, key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signingInput = header + '.' + claim;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key, 'base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const assertion = signingInput + '.' + signature;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion)
  });
  if (!res.ok) throw new Error('token ' + res.status + ' ' + await res.text());
  return (await res.json()).access_token;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return req.body;
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  try {
    let body = await readBody(req);
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};

    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    if (!name || !phone) {
      res.status(400).json({ error: 'missing name or phone' });
      return;
    }
    const note = String(body.note || '').trim();
    const cls = String(body.cls || '').trim();
    const day = String(body.day || '').trim();
    const time = String(body.time || '').trim();

    const email = process.env.GOOGLE_SA_EMAIL;
    const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const sheetId = process.env.SHEET_ID;
    const tab = process.env.SHEET_TAB || 'Signups';
    if (!email || !key || !sheetId) {
      res.status(500).json({ error: 'server not configured' });
      return;
    }

    const token = await getAccessToken(email, key);

    const range = encodeURIComponent(tab) + '!A1';
    const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId +
      '/values/' + range + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS';
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const row = [ts, name, phone, cls, day, time, note];

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    });
    if (!r.ok) throw new Error('sheets ' + r.status + ' ' + await r.text());

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed', detail: String((err && err.message) || err) });
  }
};
