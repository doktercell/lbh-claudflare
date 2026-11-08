/**
 * ============================================================================
 *  DEV SERVER — Preview lokal untuk versi Cloudflare (Pages + Worker)
 * ============================================================================
 *
 *  Menyajikan frontend statis dari cloudflare/pages/public dan meneruskan
 *  /api ke kode Cloudflare Worker yang sesungguhnya
 *  (cloudflare/worker/src/index.js). Perilaku lokal identik dengan produksi.
 *
 *  PRASYARAT
 *   1. Mock backend Apps Script (port 3000):
 *        node server.js
 *
 *   2. Dev server ini:
 *        node cloudflare/dev/server.js
 *
 *   3. Buka http://localhost:4100
 *
 *  ENVIRONMENT (opsional)
 *   PORT            port dev server (default 4100)
 *   GAS_URL         URL backend (default http://localhost:3000/api)
 *   API_KEY         kunci API (default kosong = tanpa kunci)
 *   ALLOWED_ORIGIN  origin yang diizinkan (default kosong = semua)
 * ============================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = Number(process.env.PORT || 4100);
const GAS_URL = process.env.GAS_URL || 'http://localhost:3000/api';
const API_KEY = process.env.API_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

const PAGES_DIR = path.resolve(__dirname, '..', 'pages', 'public');

// MODE menentukan kode proxy yang diuji:
//   pages  → cloudflare/pages/functions/api.js  (default, sesuai Opsi A)
//   worker → cloudflare/worker/src/index.js     (Opsi B)
const MODE = String(process.env.MODE || 'pages').toLowerCase();
const PROXY_ENTRY = MODE === 'worker'
  ? path.resolve(__dirname, '..', 'worker', 'src', 'index.js')
  : path.resolve(__dirname, '..', 'pages', 'functions', 'api.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 30 * 1024 * 1024) {
        reject(new Error('Body terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendFile(res, filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(PAGES_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PAGES_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback ke index.html
      filePath = path.join(PAGES_DIR, 'index.html');
      fs.stat(filePath, (e2, s2) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('404 — halaman tidak ditemukan');
        }
        sendFile(res, filePath, s2);
      });
      return;
    }
    sendFile(res, filePath, stat);
  });
}

async function handleApi(req, res) {
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v);
    }

    const request = new Request('http://localhost' + req.url, {
      method: req.method,
      headers,
      body: body && body.length ? body : undefined
    });

    // Muat ulang setiap request agar perubahan kode proxy langsung terlihat.
    const mod = await import(pathToFileURL(PROXY_ENTRY).href + '?t=' + Date.now());

    const env = {
      GAS_URL,
      API_KEY,
      ALLOWED_ORIGIN
    };

    // Pages Function memakai onRequest, Worker memakai default.fetch.
    const response = typeof mod.onRequest === 'function'
      ? await mod.onRequest({ request, env })
      : await mod.default.fetch(request, env);
    const text = await response.text();

    const outHeaders = {};
    response.headers.forEach((value, key) => { outHeaders[key] = value; });

    res.writeHead(response.status, outHeaders);
    res.end(text);
  } catch (err) {
    console.error('Worker error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Dev server gagal memproses permintaan: ' + err.message,
      code: 'DEV_ERROR'
    }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    handleApi(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('405 Method Not Allowed');
  }

  serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  console.log('');
  console.log('  LBH ASYSYUJA — dev server (Cloudflare mode)');
  console.log('  → http://localhost:' + PORT);
  console.log('  Static : cloudflare/pages/public');
  console.log('  Proxy  : ' + (MODE === 'worker'
    ? 'cloudflare/worker/src/index.js'
    : 'cloudflare/pages/functions/api.js') + '  (MODE=' + MODE + ')');
  console.log('  Backend: ' + GAS_URL);
  console.log('  API key: ' + (API_KEY ? '(diset)' : '(kosong)'));
  console.log('');
  console.log('  Pastikan mock backend berjalan: node server.js');
  console.log('');
});
