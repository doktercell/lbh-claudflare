/**
 * ============================================================================
 *  LBH ASYSYUJA — CLOUDFLARE WORKER (API PROXY)
 * ============================================================================
 *
 *  Tugas Worker ini:
 *   1. Menjadi satu-satunya endpoint API yang dilihat browser (/api).
 *   2. Menambahkan CORS sehingga frontend di Cloudflare Pages bisa memanggilnya.
 *   3. Menyembunyikan URL Google Apps Script dan API key dari publik.
 *   4. Membatasi ukuran body, menolak action terlarang, dan rate limiting ringan.
 *   5. Menyajikan health check di GET /api.
 *
 *  SECRET YANG DIBUTUHKAN (Settings > Variables and Secrets):
 *   - GAS_URL   : URL Web App Apps Script, diakhiri /exec  (wajib)
 *   - API_KEY   : kunci dari fungsi setApiKey() di Code.gs (disarankan)
 *   - ALLOWED_ORIGIN : origin frontend, mis. https://lbh.pages.dev (opsional)
 *
 *  DEPLOY
 *   npx wrangler deploy
 *   npx wrangler secret put GAS_URL
 *   npx wrangler secret put API_KEY
 * ============================================================================
 */

const MAX_BODY_BYTES = 12 * 1024 * 1024;   // 12 MB (cukup untuk 1 berkas 5 MB base64)
const RATE_LIMIT_MAX = 40;                 // permintaan per menit per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Action yang boleh dipanggil lewat proxy ini. */
const ALLOWED_ACTIONS = new Set([
  'health',
  'getBootstrap',
  'getPublikasi',
  'submitPengaduan',
  'uploadBukti',
  'login',
  'logout',
  'getDashboard',
  'listPerkara',
  'getPerkara',
  'updateStatus',
  'updatePublikasi',
  'deletePerkara',
  'saveBranding',
  'uploadLogo',
  'changePassword',
  'getBuktiData'
]);

/** Rate limit sederhana berbasis memori isolate (bukan global akurat). */
const buckets = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX - bucket.count };
}

function corsHeaders(origin, allowedOrigin) {
  // Jika ALLOWED_ORIGIN diisi, hanya origin itu yang diizinkan.
  // Jika kosong, izinkan semua (cocok untuk Pages preview & domain kustom).
  const allow = allowedOrigin
    ? (origin === allowedOrigin ? origin : allowedOrigin)
    : (origin || '*');

  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      headers || {}
    )
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    /* ---------- Preflight ---------- */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    /* ---------- Health check ---------- */
    if (request.method === 'GET' && url.pathname === '/api') {
      return jsonResponse({
        ok: true,
        data: {
          service: 'LBH ASYSYUJA API Proxy',
          status: 'ok',
          time: new Date().toISOString(),
          backendConfigured: !!(env.GAS_URL || env.APPS_SCRIPT_URL),
          apiKeyConfigured: !!env.API_KEY
        }
      }, 200, cors);
    }

    /* ---------- Cek konfigurasi ---------- */
    // Terima dua nama env agar kompatibel dengan wrangler (GAS_URL)
    // dan dev server lokal (APPS_SCRIPT_URL).
    const gasUrl = env.GAS_URL || env.APPS_SCRIPT_URL;

    if (!gasUrl) {
      return jsonResponse({
        ok: false,
        error: 'Backend belum dikonfigurasi. Set secret GAS_URL pada Worker.',
        code: 'NOT_CONFIGURED'
      }, 500, cors);
    }

    /* ---------- Hanya POST ke /api ---------- */
    if (request.method !== 'POST' || url.pathname !== '/api') {
      return jsonResponse({
        ok: false,
        error: 'Endpoint tidak ditemukan. Gunakan POST /api.',
        code: 'NOT_FOUND'
      }, 404, cors);
    }

    /* ---------- Rate limit ---------- */
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const limit = rateLimit(ip);
    if (!limit.allowed) {
      return jsonResponse({
        ok: false,
        error: 'Terlalu banyak permintaan. Coba lagi dalam satu menit.',
        code: 'RATE_LIMIT'
      }, 429, Object.assign({ 'Retry-After': '60' }, cors));
    }

    /* ---------- Baca & validasi body ---------- */
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({
        ok: false,
        error: 'Ukuran permintaan terlalu besar. Maksimal 12 MB.',
        code: 'PAYLOAD_TOO_LARGE'
      }, 413, cors);
    }

    let rawBody;
    try {
      rawBody = await request.text();
    } catch (err) {
      return jsonResponse({ ok: false, error: 'Gagal membaca permintaan.', code: 'BAD_REQUEST' }, 400, cors);
    }

    if (rawBody.length > MAX_BODY_BYTES) {
      return jsonResponse({
        ok: false,
        error: 'Ukuran permintaan terlalu besar. Maksimal 12 MB.',
        code: 'PAYLOAD_TOO_LARGE'
      }, 413, cors);
    }

    let body;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch (err) {
      return jsonResponse({ ok: false, error: 'Format JSON tidak valid.', code: 'BAD_REQUEST' }, 400, cors);
    }

    const action = String(body.action || '');
    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonResponse({
        ok: false,
        error: 'Aksi tidak diizinkan: ' + action,
        code: 'BAD_REQUEST'
      }, 400, cors);
    }

    /* ---------- Teruskan ke Apps Script ---------- */
    // Apps Script doPost tidak membaca header kustom dengan andal,
    // jadi API key dikirim melalui query string dan body.
    const target = new URL(gasUrl);
    if (env.API_KEY) target.searchParams.set('key', env.API_KEY);

    const forwardBody = env.API_KEY
      ? JSON.stringify(Object.assign({}, body, { key: env.API_KEY }))
      : JSON.stringify(body);

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'Accept': 'application/json'
        },
        body: forwardBody,
        redirect: 'follow'
      });
    } catch (err) {
      return jsonResponse({
        ok: false,
        error: 'Tidak dapat menghubungi server backend. Periksa konfigurasi GAS_URL.',
        code: 'UPSTREAM_ERROR',
        detail: String(err && err.message ? err.message : err)
      }, 502, cors);
    }

    const text = await upstream.text();

    /* ---------- Normalisasi respons ---------- */
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      // Apps Script kadang mengembalikan halaman HTML error.
      return jsonResponse({
        ok: false,
        error: 'Respons backend tidak valid. Pastikan GAS_URL mengarah ke deployment Web App yang benar.',
        code: 'UPSTREAM_INVALID',
        detail: text.slice(0, 300)
      }, 502, cors);
    }

    return jsonResponse(payload, upstream.ok ? 200 : 502, cors);
  }
};
