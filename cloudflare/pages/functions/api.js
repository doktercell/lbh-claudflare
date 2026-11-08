/**
 * ============================================================================
 *  LBH ASYSYUJA — CLOUDFLARE PAGES FUNCTION  →  POST /api
 * ============================================================================
 *
 *  Frontend statis dan API berada pada SATU domain: tanpa CORS,
 *  dan hanya perlu satu kali deploy (Cloudflare Pages).
 *
 *  STRUKTUR
 *    cloudflare/pages/
 *      public/            → aset statis (index.html, config.js, _headers…)
 *      functions/api.js   → file ini, menangani /api
 *
 *  VARIABEL (Pages → Settings → Variables and Secrets):
 *    GAS_URL   : URL Web App Apps Script, diakhiri /exec   [wajib]
 *    API_KEY   : kunci dari setApiKey() di Code.gs         [disarankan]
 *
 *  DEPLOY
 *    Cloudflare Dashboard → Workers & Pages → Create → Pages
 *    → Connect to Git → Root directory: cloudflare/pages
 *    → Build output directory: public
 *    (Framework preset: None, build command: kosong)
 *
 *  File ini berjalan di server Cloudflare, sehingga API_KEY aman
 *  dan tidak pernah dikirim ke browser.
 * ============================================================================
 */

const MAX_BODY_BYTES = 12 * 1024 * 1024;

/** Hanya action ini yang boleh melewati proxy. */
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

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

/** Pesan bantuan yang menjelaskan cara memperbaiki konfigurasi. */
function configHelp() {
  return [
    'Buka Cloudflare Dashboard → Workers & Pages → project ini → Settings → Variables and Secrets.',
    'Tambahkan GAS_URL (URL Web App Apps Script, diakhiri /exec) sebagai Secret.',
    'Tambahkan API_KEY (hasil fungsi setApiKey() di Apps Script) sebagai Secret.',
    'Lalu Deployments → Retry deployment agar variabel terbaca.'
  ];
}

export async function onRequest(context) {
  const { request, env } = context;

  /* ---------------------------------------------------- Health check (GET) */
  if (request.method === 'GET') {
    return json({
      ok: true,
      data: {
        service: 'LBH ASYSYUJA API (Pages Function)',
        status: 'ok',
        time: new Date().toISOString(),
        backendConfigured: !!env.GAS_URL,
        apiKeyConfigured: !!env.API_KEY,
        gasUrlHost: env.GAS_URL ? safeHost(env.GAS_URL) : null,
        help: env.GAS_URL ? undefined : configHelp()
      }
    });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Gunakan POST /api.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  if (!env.GAS_URL) {
    return json({
      ok: false,
      error: 'Backend belum dikonfigurasi: environment variable GAS_URL kosong.',
      code: 'NOT_CONFIGURED',
      help: configHelp()
    }, 500);
  }

  /* ------------------------------------------------------ Batas ukuran body */
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({
      ok: false,
      error: 'Ukuran permintaan terlalu besar. Maksimal 12 MB.',
      code: 'PAYLOAD_TOO_LARGE'
    }, 413);
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch (err) {
    return json({ ok: false, error: 'Gagal membaca permintaan.', code: 'BAD_REQUEST' }, 400);
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return json({
      ok: false,
      error: 'Ukuran permintaan terlalu besar. Maksimal 12 MB.',
      code: 'PAYLOAD_TOO_LARGE'
    }, 413);
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (err) {
    return json({ ok: false, error: 'Format JSON tidak valid.', code: 'BAD_REQUEST' }, 400);
  }

  const action = String(body.action || '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return json({
      ok: false,
      error: 'Aksi tidak diizinkan: ' + action,
      code: 'BAD_REQUEST'
    }, 400);
  }

  /* ------------------------------------------------- Teruskan ke Apps Script */
  let target;
  try {
    target = new URL(env.GAS_URL);
  } catch (err) {
    return json({
      ok: false,
      error: 'GAS_URL bukan URL yang valid: ' + env.GAS_URL,
      code: 'NOT_CONFIGURED',
      help: ['Pastikan GAS_URL diawali https:// dan diakhiri /exec.']
    }, 500);
  }

  // Peringatan bila URL tidak berakhiran /exec (sering jadi penyebab gagal).
  const urlLooksWrong = !/\/exec\/?$/.test(target.pathname);

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
    return json({
      ok: false,
      error: 'Tidak dapat menghubungi backend Apps Script.',
      code: 'UPSTREAM_ERROR',
      detail: String(err && err.message ? err.message : err),
      help: ['Periksa apakah GAS_URL benar dan deployment Web App masih aktif.']
    }, 502);
  }

  const text = await upstream.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    // Respons HTML biasanya berarti: URL salah, akses bukan "Anyone",
    // atau yang dibuka halaman editor, bukan deployment /exec.
    return json({
      ok: false,
      error: 'Respons backend bukan JSON. Kemungkinan GAS_URL salah atau akses Web App bukan "Anyone".',
      code: 'UPSTREAM_INVALID',
      upstreamStatus: upstream.status,
      upstreamHost: safeHost(env.GAS_URL),
      urlLooksWrong: urlLooksWrong,
      detail: text.slice(0, 300),
      help: [
        'Pastikan GAS_URL berakhiran /exec (bukan /dev atau /edit).',
        'Pastikan Deploy → Manage deployments → Who has access = Anyone.',
        'Buka GAS_URL langsung di browser: harus menampilkan JSON, bukan halaman login Google.'
      ]
    }, 502);
  }

  if (payload && payload.code === 'FORBIDDEN') {
    payload.help = [
      'API_KEY di Cloudflare tidak sama dengan kunci di Apps Script.',
      'Jalankan setApiKey() di editor Apps Script untuk melihat nilai yang benar.'
    ];
  }

  return json(payload, upstream.ok ? 200 : 502);
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch (err) {
    return null;
  }
}
