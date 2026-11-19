import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 8787;
const MAX_BODY_BYTES = 18 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function readAppsScriptUrl() {
  let contents;
  try {
    contents = readFileSync(new URL('./.env.local', import.meta.url), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Buat apps-script/.env.local dan isi APP_SCRIPT_URL dengan URL Web App /exec.');
    }
    throw error;
  }
  const entry = contents.split(/\r?\n/).find(line => /^\s*APP_SCRIPT_URL\s*=/.test(line));
  const value = entry ? entry.slice(entry.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('APP_SCRIPT_URL di apps-script/.env.local bukan URL yang valid.');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    throw new Error('APP_SCRIPT_URL harus URL Web App Google Apps Script yang berakhir dengan /exec.');
  }
  return url.href;
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' || !LOCAL_HOSTS.has(parsedOrigin.hostname)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (!setCorsHeaders(request, response)) {
    sendJson(response, 403, { ok: false, error: 'Origin tidak diizinkan oleh proxy lokal.' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api') {
    sendJson(response, 404, { ok: false, error: 'Rute proxy tidak ditemukan.' });
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(response, 413, { ok: false, error: 'Permintaan terlalu besar.' });
      return;
    }
    chunks.push(chunk);
  }

  try {
    const upstream = await fetch(readAppsScriptUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks)
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      sendJson(response, 502, { ok: false, error: `Apps Script mengembalikan HTTP ${upstream.status}.` });
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(text);
  } catch (error) {
    console.error('Proxy lokal gagal meneruskan permintaan:', error);
    sendJson(response, 502, { ok: false, error: error.message || 'Koneksi ke Apps Script gagal.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Proxy Apps Script aktif di http://127.0.0.1:${PORT}`);
  console.log('Proxy hanya menerima Origin localhost dan meneruskan ke URL /exec di .env.local.');
});
