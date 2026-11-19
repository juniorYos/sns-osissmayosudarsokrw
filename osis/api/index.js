const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function jsonResponse(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

function getAppsScriptUrl() {
  let url;
  try {
    url = new URL(process.env.APP_SCRIPT_URL || '');
  } catch {
    throw new Error('Atur environment variable APP_SCRIPT_URL ke URL Web App Apps Script yang berakhir dengan /exec.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('APP_SCRIPT_URL harus URL Web App Google Apps Script yang berakhir dengan /exec.');
  }
  return url.href;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    jsonResponse(res, 405, { ok: false, error: 'Gunakan metode POST.' });
    return;
  }

  const origin = req.headers.origin;
  const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      jsonResponse(res, 403, { ok: false, error: 'Origin tidak diizinkan.' });
      return;
    }
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.host !== requestHost) {
      jsonResponse(res, 403, { ok: false, error: 'Origin tidak diizinkan.' });
      return;
    }
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { ok: false, error: 'Permintaan API tidak valid.' });
      return;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    jsonResponse(res, 400, { ok: false, error: 'Permintaan API tidak valid.' });
    return;
  }

  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload, 'utf8') > MAX_BODY_BYTES) {
    jsonResponse(res, 413, { ok: false, error: 'Data terlalu besar untuk API Vercel (maksimal 4 MB per permintaan).' });
    return;
  }

  let appsScriptUrl;
  try {
    appsScriptUrl = getAppsScriptUrl();
  } catch (error) {
    console.error('Konfigurasi URL Apps Script tidak valid:', error);
    jsonResponse(res, 500, { ok: false, error: error.message });
    return;
  }

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(35000) // 35 detik cukup untuk PBKDF2 20.000 iterasi (~2-3 detik)
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      jsonResponse(res, 502, { ok: false, error: `Apps Script mengembalikan HTTP ${upstream.status}.` });
      return;
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      jsonResponse(res, 502, { ok: false, error: 'Data dari Apps Script terlalu besar untuk batas respons Vercel. Kurangi data atau gunakan portal Apps Script.' });
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(text);
  } catch (error) {
    console.error('Proxy Vercel gagal menghubungi Apps Script:', error);
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      jsonResponse(res, 504, { ok: false, error: 'Apps Script tidak merespons dalam batas waktu. Coba login sekali lagi — proses pertama lebih lama karena enkripsi kata sandi.' });
      return;
    }
    jsonResponse(res, 502, { ok: false, error: 'Vercel tidak dapat menghubungi Apps Script. Periksa APP_SCRIPT_URL dan status deployment.' });
  }
};
