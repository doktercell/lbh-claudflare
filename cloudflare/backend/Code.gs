/**
 * ============================================================================
 *  LBH ASYSYUJA — BACKEND API (GOOGLE APPS SCRIPT)
 *  Dijalankan sebagai Web App "API only" untuk frontend statis
 *  (Cloudflare Pages / hosting apa pun).
 * ============================================================================
 *
 *  ARSITEKTUR
 *  ┌──────────────────┐      ┌────────────────────┐      ┌──────────────────┐
 *  │ Cloudflare Pages │─────▶│ Pages Function     │─────▶│  Apps Script API │
 *  │  index.html      │ /api │ / Worker (proxy)   │ POST │  Code.gs         │
 *  └──────────────────┘      └────────────────────┘      └────────┬─────────┘
 *                                                                  │
 *                                                        ┌─────────▼────────┐
 *                                                        │ Sheets + Drive   │
 *                                                        └──────────────────┘
 *
 *  LANGKAH DEPLOY
 *  1. Buat project Apps Script, tempel file ini sebagai Code.gs.
 *  2. (Opsional) Tempel appsscript.json untuk scope otomatis.
 *  3. Jalankan setupDatabase() satu kali dari editor.
 *  4. Jalankan setApiKey() — menampilkan kunci acak. Simpan kunci ini;
 *     kunci yang sama dimasukkan sebagai secret API_KEY di Cloudflare.
 *  5. Deploy > New deployment > Web app
 *       Execute as   : Me
 *       Who has access: Anyone
 *  6. Salin Web app URL (…/exec). URL ini dipakai sebagai GAS_URL di Cloudflare.
 *
 *  CATATAN
 *  - File ini TIDAK memuat HTML apa pun. doGet hanya mengembalikan status JSON.
 *  - CORS ditangani Cloudflare (Pages Function / Worker), bukan Apps Script.
 *  - Bila API_KEY diisi di Script Properties, setiap permintaan wajib
 *     menyertakan kunci yang cocok (?key=… atau field "key" pada body).
 *
 *  KEAMANAN
 *  - Password admin: hash SHA-256 + salt.
 *  - Sesi admin: token acak, berlaku 6 jam, disimpan di CacheService.
 *  - Bukti tersimpan privat di Google Drive.
 *  - Data pengadu tidak pernah tampil publik; publikasi memakai inisial.
 * ============================================================================
 */

const APP = {
  NAME: 'LBH ASYSYUJA',
  VERSION: '2.0.0',
  TZ: 'Asia/Jakarta',
  SPREADSHEET_NAME: 'LBH ASYSYUJA — Database Pengaduan',
  DRIVE_FOLDER_NAME: 'LBH ASYSYUJA — Berkas Pengaduan',
  BRANDING_FOLDER_NAME: 'LBH ASYSYUJA — Branding',
  MAX_FILE_MB: 5,
  MAX_FILES: 8,
  MAX_TOTAL_MB: 20,
  TOKEN_TTL: 21600,            // 6 jam (maksimum CacheService)
  MAX_LOGIN_ATTEMPTS: 5,
  MAX_WITNESSES: 5,
  DEFAULT_ADMIN_USER: 'admin',
  DEFAULT_ADMIN_PASS: 'Admin#LBH2026'
};

const SHEETS = {
  SETTINGS: 'Pengaturan',
  PERKARA: 'Perkara',
  SAKSI: 'Saksi',
  BUKTI: 'Bukti',
  ADMIN: 'Admin',
  STATUS: 'RiwayatStatus',
  LOG: 'LogAktivitas'
};

/** Urutan kolom sheet Perkara. Jangan ubah urutan tanpa migrasi data. */
const PERKARA_FIELDS = [
  ['id', 'ID'],
  ['nomorRegistrasi', 'Nomor Registrasi'],
  ['waktuDaftar', 'Waktu Daftar'],
  ['nama', 'Nama Pengadu'],
  ['nik', 'NIK'],
  ['tempatLahir', 'Tempat Lahir'],
  ['tanggalLahir', 'Tanggal Lahir'],
  ['jenisKelamin', 'Jenis Kelamin'],
  ['agama', 'Agama'],
  ['statusPerkawinan', 'Status Perkawinan'],
  ['pendidikan', 'Pendidikan'],
  ['pekerjaan', 'Pekerjaan'],
  ['alamat', 'Alamat KTP'],
  ['rt', 'RT'],
  ['rw', 'RW'],
  ['desa', 'Desa/Kelurahan'],
  ['kecamatan', 'Kecamatan'],
  ['kabupaten', 'Kabupaten/Kota'],
  ['provinsi', 'Provinsi'],
  ['noHP', 'No. HP/WhatsApp'],
  ['email', 'Email'],
  ['jenisPerkara', 'Jenis Perkara'],
  ['judulPerkara', 'Judul Perkara'],
  ['kronologi', 'Kronologi'],
  ['tanggalKejadian', 'Tanggal Kejadian'],
  ['lokasiKejadian', 'Lokasi Kejadian'],
  ['pihakLawan', 'Pihak Lawan'],
  ['nilaiKerugian', 'Nilai Kerugian'],
  ['sudahDilaporkan', 'Sudah Dilaporkan'],
  ['instansi', 'Instansi Pelaporan'],
  ['noLaporan', 'No. Laporan'],
  ['punyaKuasaHukum', 'Punya Kuasa Hukum'],
  ['urgensi', 'Urgensi'],
  ['harapan', 'Harapan Klien'],
  ['tandaTangan', 'Tanda Tangan'],
  ['pernyataan', 'Pernyataan Kebenaran'],
  ['persetujuan', 'Persetujuan Data'],
  ['status', 'Status'],
  ['statusCatatan', 'Catatan Status'],
  ['publikasi', 'Publikasi'],
  ['ringkasanPublik', 'Ringkasan Publikasi'],
  ['buktiCount', 'Jumlah Bukti'],
  ['driveFolderId', 'Folder Drive'],
  ['waktuUpdate', 'Waktu Update']
];

const PERKARA_KEYS = PERKARA_FIELDS.map(function (f) { return f[0]; });

const SAKSI_FIELDS = [
  ['id', 'ID'], ['perkaraId', 'ID Perkara'], ['nama', 'Nama Saksi'],
  ['nik', 'NIK'], ['hubungan', 'Hubungan'], ['alamat', 'Alamat'],
  ['noHP', 'No. HP'], ['keterangan', 'Keterangan'], ['waktu', 'Waktu']
];

const BUKTI_FIELDS = [
  ['id', 'ID'], ['perkaraId', 'ID Perkara'], ['namaFile', 'Nama File'],
  ['mimeType', 'MIME Type'], ['ukuran', 'Ukuran (byte)'], ['driveFileId', 'Drive File ID'],
  ['url', 'URL'], ['sumber', 'Sumber'], ['waktu', 'Waktu']
];

const STATUS_FIELDS = [
  ['id', 'ID'], ['perkaraId', 'ID Perkara'], ['statusLama', 'Status Lama'],
  ['statusBaru', 'Status Baru'], ['catatan', 'Catatan'], ['oleh', 'Oleh'], ['waktu', 'Waktu']
];

const ADMIN_FIELDS = [
  ['username', 'Username'], ['nama', 'Nama'], ['passwordHash', 'Password Hash'],
  ['salt', 'Salt'], ['role', 'Role'], ['aktif', 'Aktif'], ['dibuat', 'Dibuat'],
  ['terakhirLogin', 'Terakhir Login']
];

const SETTINGS_FIELDS = [
  ['key', 'Key'], ['value', 'Value'], ['deskripsi', 'Deskripsi'], ['diperbarui', 'Diperbarui']
];

const LOG_FIELDS = [
  ['waktu', 'Waktu'], ['aktor', 'Aktor'], ['aksi', 'Aksi'], ['detail', 'Detail']
];

const DEFAULT_BRANDING = {
  brandTitle: 'LBH ASYSYUJA',
  brandSubtitle: 'Lembaga Bantuan Hukum',
  waNumber: '6281234567890',
  telepon: '(021) 1234-5678',
  email: 'pengaduan@lbhasysyuja.or.id',
  alamat: 'Jl. Keadilan No. 17, Kecamatan Setiabudi, Jakarta Selatan, DKI Jakarta 12910',
  jamOperasional: 'Senin – Jumat, 08.00 – 17.00 WIB',
  logoUrl: '',
  footerText: 'LBH ASYSYUJA berkomitmen memberikan layanan bantuan hukum yang adil, rahasia, dan profesional bagi masyarakat yang membutuhkan.',
  heroBadge: 'Lembaga Bantuan Hukum Terpercaya',
  heroTitle: 'Membela Hak Anda, Menegakkan Keadilan',
  heroDesc: 'Sampaikan permasalahan hukum Anda secara aman dan rahasia. Tim advokat dan paralegal kami siap mendampingi proses hukum Anda dari awal hingga tuntas.',
  tentangSingkat: 'LBH ASYSYUJA adalah lembaga bantuan hukum yang berfokus pada pendampingan masyarakat kurang mampu, korban kekerasan, dan kelompok rentan. Kami percaya bahwa keadilan adalah hak setiap orang.'
};

const SETTING_DESCRIPTIONS = {
  brandTitle: 'Nama lembaga',
  brandSubtitle: 'Subjudul / jenis lembaga',
  waNumber: 'Nomor WhatsApp tujuan pengaduan (format 62xxx)',
  telepon: 'Nomor telepon kantor',
  email: 'Email resmi lembaga',
  alamat: 'Alamat kantor',
  jamOperasional: 'Jam layanan',
  logoUrl: 'URL logo (diisi otomatis dari upload)',
  footerText: 'Teks footer',
  heroBadge: 'Badge kecil di hero',
  heroTitle: 'Judul utama hero',
  heroDesc: 'Deskripsi hero',
  tentangSingkat: 'Deskripsi singkat lembaga'
};

const STATUS_LIST = ['Baru', 'Diverifikasi', 'Dalam Proses', 'Mediasi', 'Selesai', 'Ditolak'];
const JENIS_PERKARA_LIST = [
  'Pidana', 'Perdata', 'Keluarga', 'Tata Usaha Negara',
  'Hubungan Industrial', 'Perlindungan Anak & Perempuan',
  'Konsumen', 'Pertanahan', 'Lainnya'
];
const URGENSI_LIST = ['Rendah', 'Sedang', 'Tinggi', 'Darurat'];

/* ========================================================================== */
/*  ENTRY POINT WEB APP                                                       */
/* ========================================================================== */

/**
 * doGet — hanya untuk health check. Tidak menyajikan halaman HTML.
 * Berguna untuk memastikan deployment API hidup.
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var info = {
    service: APP.NAME + ' API',
    status: 'ok',
    time: nowIso_(),
    apiKeyRequired: !!getApiKey_()
  };

  // Ringkasan kecil agar mudah diperiksa dari browser.
  if (params.ping === '1') {
    try {
      var stats = getPublicStats_();
      info.stats = stats;
    } catch (err) {
      info.dbError = err && err.message;
    }
  }

  return jsonOut_({ ok: true, data: info });
}

/**
 * doPost — satu-satunya pintu masuk API.
 * Menerima JSON { action, payload, token }.
 * Wajib menyertakan X-API-Key bila API key sudah diset.
 */
function doPost(e) {
  var body = {};
  var raw = e && e.postData ? e.postData.contents : '{}';

  try {
    body = JSON.parse(raw || '{}');
  } catch (err) {
    return jsonOut_({ ok: false, error: 'Format permintaan tidak valid.', code: 'BAD_REQUEST' });
  }

  // Verifikasi API key (opsional, aktif bila diset di Script Properties).
  var expectedKey = getApiKey_();
  if (expectedKey) {
    var provided = '';
    try {
      provided = (e && e.parameter && e.parameter.key) || '';
    } catch (err) { /* abaikan */ }

    // Apps Script tidak mengekspos header kustom dengan mudah pada doPost,
    // jadi Worker mengirim kunci lewat query string ?key=… sekaligus body.key.
    if (!provided) provided = String(body.key || '');
    if (!safeEqual_(provided, expectedKey)) {
      return jsonOut_({ ok: false, error: 'Kunci API tidak valid.', code: 'FORBIDDEN' });
    }
  }

  return jsonOut_(apiRequest(body));
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(typeof obj === 'string' ? obj : JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** API key disimpan di Script Properties. */
function getApiKey_() {
  try {
    return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
  } catch (e) {
    return '';
  }
}

/** Informasi singkat backend — dipakai Worker untuk memeriksa kesehatan. */
function health_() {
  var out = {
    service: APP.NAME + ' API',
    version: APP.VERSION,
    status: 'ok',
    time: nowIso_()
  };
  try {
    out.stats = getPublicStats_();
  } catch (e) {
    out.stats = null;
    out.dbReady = false;
  }
  return out;
}

/**
 * Jalankan sekali dari editor untuk membuat / menampilkan API key.
 * Salin nilainya ke secret API_KEY pada Cloudflare Worker.
 */
function setApiKey() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty('API_KEY');

  if (existing) {
    Logger.log('API_KEY sudah ada (tidak diubah):\n' + existing);
    return existing;
  }

  var key = 'lbh_' + Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  props.setProperty('API_KEY', key);
  Logger.log('API_KEY baru dibuat. Simpan nilai ini di Cloudflare Worker:\n' + key);
  return key;
}

/** Menghapus API key (API menjadi terbuka — hanya untuk pengujian). */
function clearApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  Logger.log('API_KEY dihapus. API kini dapat diakses tanpa kunci.');
}

/**
 * Satu pintu untuk seluruh API. Menerima objek atau string JSON.
 * Mengembalikan string JSON agar kompatibel dengan doPost.
 */
function apiRequest(input) {
  var body;
  try {
    body = typeof input === 'string' ? JSON.parse(input) : (input || {});
  } catch (err) {
    return JSON.stringify({ ok: false, error: 'Format permintaan tidak valid.', code: 'BAD_REQUEST' });
  }

  var action = String(body.action || '');
  var payload = body.payload || {};
  var token = body.token || payload.token || '';

  try {
    var data = route_(action, payload, token);
    return JSON.stringify({ ok: true, data: data });
  } catch (err) {
    var code = (err && err.code) || 'SERVER';
    var message = (err && err.message) || 'Terjadi kesalahan pada server.';
    if (code === 'SERVER') {
      console.error('API ERROR [' + action + ']: ' + (err && err.stack ? err.stack : err));
    }
    return JSON.stringify({ ok: false, error: message, code: code });
  }
}

/**
 * Diagnostik: jalankan dari editor untuk memeriksa kesiapan backend API.
 * Lihat hasilnya di Execution log.
 */
function diagnose() {
  var out = { version: APP.VERSION, mode: 'API only (Cloudflare Pages/Worker)' };

  try {
    var ss = db_();
    out.spreadsheet = ss.getName();
    out.spreadsheetUrl = ss.getUrl();
    out.sheets = ss.getSheets().map(function (s) { return s.getName(); });
    var perkara = ss.getSheetByName(SHEETS.PERKARA);
    out.perkaraColumns = perkara ? perkara.getLastColumn() : 0;
    out.perkaraRows = perkara ? Math.max(0, perkara.getLastRow() - 1) : 0;
    var admin = ss.getSheetByName(SHEETS.ADMIN);
    out.adminRows = admin ? Math.max(0, admin.getLastRow() - 1) : 0;
  } catch (e) {
    out.spreadsheet = 'ERROR — ' + e.message;
  }

  try {
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty('DRIVE_FOLDER_ID');
    out.driveFolderId = folderId || '(belum diset)';
    out.driveFolderOk = folderId ? !!DriveApp.getFolderById(folderId) : false;
    out.apiKeySet = !!props.getProperty('API_KEY');
  } catch (e) {
    out.driveFolderOk = false;
    out.apiKeySet = false;
  }

  try {
    out.webAppUrl = ScriptApp.getService().getUrl() || '(belum di-deploy)';
  } catch (e) {
    out.webAppUrl = '(belum di-deploy)';
  }

  out.timezone = Session.getScriptTimeZone();
  out.expectedColumns = PERKARA_KEYS.length;

  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * Perbaikan cepat: pastikan sheet, branding, admin, dan folder siap.
 */
function repairSetup() {
  var info = setupDatabase();
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) info.webAppUrl = url;
  } catch (e) { /* belum dideploy */ }
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function route_(action, payload, token) {
  switch (action) {
    /* Utilitas */
    case 'health':            return health_();

    /* Publik */
    case 'getBootstrap':      return getBootstrap_();
    case 'getPublikasi':      return getPublikasi_(Number(payload.limit) || 6);
    case 'submitPengaduan':   return submitPengaduan_(payload);
    case 'uploadBukti':       return uploadBukti_(payload);

    /* Autentikasi */
    case 'login':             return login_(payload);
    case 'logout':            return logout_(token);

    /* Admin — wajib token */
    case 'getDashboard':      requireAuth_(token); return getDashboard_();
    case 'listPerkara':       requireAuth_(token); return listPerkara_();
    case 'getPerkara':        requireAuth_(token); return getPerkara_(payload.id);
    case 'updateStatus':      return updateStatus_(payload, token);
    case 'updatePublikasi':   return updatePublikasi_(payload, token);
    case 'deletePerkara':     return deletePerkara_(payload.id, token);
    case 'saveBranding':      return saveBranding_(payload.branding || payload, token);
    case 'uploadLogo':        return uploadLogo_(payload, token);
    case 'changePassword':    return changePassword_(payload, token);
    case 'getBuktiData':      requireAuth_(token); return getBuktiData_(payload.id);

    default:
      throw apiError_('Aksi tidak dikenali: ' + action, 'BAD_REQUEST');
  }
}

/* ========================================================================== */
/*  SETUP DATABASE                                                            */
/* ========================================================================== */

/**
 * Jalankan sekali dari editor Apps Script.
 * Membuat spreadsheet (jika standalone), sheet, folder Drive, branding,
 * dan akun admin default.
 */
function setupDatabase() {
  var ss = getOrCreateSpreadsheet_();
  ensureSheets_(ss);
  seedBranding_(ss);
  seedAdmin_(ss);

  var props = PropertiesService.getScriptProperties();
  var folder = getOrCreateFolder_(APP.DRIVE_FOLDER_NAME);
  var brandFolder = getOrCreateFolder_(APP.BRANDING_FOLDER_NAME);
  props.setProperty('DB_ID', ss.getId());
  props.setProperty('DB_READY', '1');
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  props.setProperty('BRANDING_FOLDER_ID', brandFolder.getId());
  props.setProperty('AUTH_VERSION', props.getProperty('AUTH_VERSION') || '1');

  var info = {
    spreadsheetUrl: ss.getUrl(),
    spreadsheetId: ss.getId(),
    driveFolderUrl: folder.getUrl(),
    adminUser: APP.DEFAULT_ADMIN_USER,
    adminPassword: APP.DEFAULT_ADMIN_PASS
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function getOrCreateSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var ss = null;

  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }

  if (!ss) {
    var id = props.getProperty('DB_ID');
    if (id) {
      try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create(APP.SPREADSHEET_NAME);
    props.setProperty('DB_ID', ss.getId());
  }
  return ss;
}

var DB_CACHE_ = null;

function db_() {
  if (DB_CACHE_) return DB_CACHE_;
  var props = PropertiesService.getScriptProperties();
  var ss = getOrCreateSpreadsheet_();

  if (props.getProperty('DB_READY') !== '1' || !ss.getSheetByName(SHEETS.PERKARA)) {
    ensureSheets_(ss);
    seedBranding_(ss);
    seedAdmin_(ss);
    props.setProperty('DB_READY', '1');
    props.setProperty('DB_ID', ss.getId());
  }

  DB_CACHE_ = ss;
  return ss;
}

function ensureSheets_(ss) {
  ensureSheet_(ss, SHEETS.SETTINGS, SETTINGS_FIELDS, [180, 420, 300, 170]);
  ensureSheet_(ss, SHEETS.PERKARA, PERKARA_FIELDS, [190, 160, 150, 180, 140, 150, 130, 120, 110, 140, 120, 150, 260, 60, 60, 150, 150, 150, 150, 150, 190, 160, 220, 380, 130, 200, 180, 130, 140, 160, 140, 150, 120, 300, 260, 140, 140, 120, 240, 110, 280, 110, 170, 160]);
  ensureSheet_(ss, SHEETS.SAKSI, SAKSI_FIELDS, [190, 190, 180, 140, 130, 260, 150, 260, 150]);
  ensureSheet_(ss, SHEETS.BUKTI, BUKTI_FIELDS, [190, 190, 240, 150, 120, 200, 260, 100, 150]);
  ensureSheet_(ss, SHEETS.ADMIN, ADMIN_FIELDS, [150, 200, 300, 260, 100, 80, 160, 170]);
  ensureSheet_(ss, SHEETS.STATUS, STATUS_FIELDS, [190, 190, 130, 130, 280, 150, 150]);
  ensureSheet_(ss, SHEETS.LOG, LOG_FIELDS, [150, 150, 170, 400]);

  // Hapus Sheet1 bawaan hanya jika kosong.
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
}

function ensureSheet_(ss, name, fields, widths) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  var headers = fields.map(function (f) { return f[1]; });

  // Pastikan jumlah kolom cukup (sheet baru hanya memiliki 26 kolom).
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeader = sheet.getLastRow() === 0;
  if (!needsHeader) {
    needsHeader = String(firstRow[0] || '') !== String(headers[0] || '');
  }
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#064e3b')
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('left');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 34);

  for (var i = 0; i < widths.length; i++) {
    try { sheet.setColumnWidth(i + 1, widths[i]); } catch (e) { /* abaikan */ }
  }

  // Validasi data untuk kolom status & publikasi.
  if (name === SHEETS.PERKARA) {
    var statusCol = PERKARA_KEYS.indexOf('status') + 1;
    var publikasiCol = PERKARA_KEYS.indexOf('publikasi') + 1;
    var maxRows = sheet.getMaxRows();
    if (maxRows >= 2) {
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build();
      var pubRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['YA', 'TIDAK'], true).setAllowInvalid(false).build();
      sheet.getRange(2, statusCol, maxRows - 1, 1).setDataValidation(statusRule);
      sheet.getRange(2, publikasiCol, maxRows - 1, 1).setDataValidation(pubRule);
    }
  }
  return sheet;
}

function seedBranding_(ss) {
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  if (!sheet) return;
  var existing = {};
  var last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) existing[String(r[0])] = true;
    });
  }
  var rows = [];
  Object.keys(DEFAULT_BRANDING).forEach(function (key) {
    if (!existing[key]) {
      rows.push([key, DEFAULT_BRANDING[key], SETTING_DESCRIPTIONS[key] || '', nowIso_()]);
    }
  });
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
}

function seedAdmin_(ss) {
  var sheet = ss.getSheetByName(SHEETS.ADMIN);
  if (!sheet || sheet.getLastRow() > 1) return;
  var salt = Utilities.getUuid();
  var hash = hashPassword_(APP.DEFAULT_ADMIN_PASS, salt);
  sheet.appendRow([
    APP.DEFAULT_ADMIN_USER, 'Administrator LBH', hash, salt,
    'admin', 'YA', nowIso_(), ''
  ]);
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function getFolder_(propKey, name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(propKey);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* lanjut */ }
  }
  var folder = getOrCreateFolder_(name);
  props.setProperty(propKey, folder.getId());
  return folder;
}

/* ========================================================================== */
/*  UTILITAS UMUM                                                             */
/* ========================================================================== */

function apiError_(message, code) {
  var err = new Error(message);
  err.code = code || 'SERVER';
  return err;
}

function assert_(condition, message, code) {
  if (!condition) throw apiError_(message, code || 'VALIDATION');
}

function nowIso_() {
  return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function todayKey_() {
  return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd');
}

function str_(value, max) {
  var s = String(value == null ? '' : value).trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

function digits_(value) {
  return String(value == null ? '' : value).replace(/[^0-9]/g, '');
}

function normalizePhone_(value) {
  var d = digits_(value);
  if (d.indexOf('62') === 0) return d;
  if (d.indexOf('0') === 0) return '62' + d.slice(1);
  if (d.indexOf('8') === 0) return '62' + d;
  return d;
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Mencegah formula injection saat menulis ke Google Sheets. */
function cell_(value) {
  var s = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function hashPassword_(password, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + '::' + String(password),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var v = (b & 0xff).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function getAuthVersion_() {
  var sheet = db_().getSheetByName(SHEETS.SETTINGS);
  var last = sheet.getLastRow();
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === 'authVersion') return String(rows[i][1] || '1');
    }
  }
  return '1';
}

function bumpAuthVersion_() {
  var sheet = db_().getSheetByName(SHEETS.SETTINGS);
  var last = sheet.getLastRow();
  var current = Number(getAuthVersion_()) || 1;
  var next = String(current + 1);
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === 'authVersion') {
        sheet.getRange(i + 2, 2).setValue(next);
        sheet.getRange(i + 2, 4).setValue(nowIso_());
        return next;
      }
    }
  }
  sheet.appendRow(['authVersion', next, 'Versi autentikasi (otomatis)', nowIso_()]);
  return next;
}

function log_(aktor, aksi, detail) {
  try {
    var sheet = db_().getSheetByName(SHEETS.LOG);
    sheet.appendRow([nowIso_(), cell_(aktor), cell_(aksi), cell_(String(detail || '').slice(0, 900))]);
    var last = sheet.getLastRow();
    if (last > 5001) {
      sheet.deleteRows(2, 1000);
    }
  } catch (e) { /* logging tidak boleh menggagalkan aksi utama */ }
}

/* ========================================================================== */
/*  BRANDING / PENGATURAN                                                     */
/* ========================================================================== */

function getBranding_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('BRANDING_V1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* abaikan */ }
  }

  var sheet = db_().getSheetByName(SHEETS.SETTINGS);
  var branding = {};
  Object.keys(DEFAULT_BRANDING).forEach(function (k) { branding[k] = DEFAULT_BRANDING[k]; });

  var last = sheet.getLastRow();
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
    rows.forEach(function (r) {
      var key = String(r[0] || '');
      if (key && Object.prototype.hasOwnProperty.call(DEFAULT_BRANDING, key)) {
        branding[key] = String(r[1] == null ? '' : r[1]);
      }
    });
  }

  cache.put('BRANDING_V1', JSON.stringify(branding), 300);
  return branding;
}

function saveBranding_(payload, token) {
  var admin = requireAuth_(token);
  var sheet = db_().getSheetByName(SHEETS.SETTINGS);
  var last = sheet.getLastRow();
  var rowMap = {};
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, 1).getValues();
    rows.forEach(function (r, i) { rowMap[String(r[0])] = i + 2; });
  }

  var limits = {
    brandTitle: 80, brandSubtitle: 120, waNumber: 20, telepon: 40, email: 120,
    alamat: 300, jamOperasional: 120, logoUrl: 500, footerText: 600,
    heroBadge: 100, heroTitle: 140, heroDesc: 500, tentangSingkat: 800
  };

  var updates = [];
  Object.keys(DEFAULT_BRANDING).forEach(function (key) {
    if (payload[key] === undefined) return;
    var value = str_(payload[key], limits[key] || 500);
    if (key === 'waNumber') value = normalizePhone_(value);
    if (key === 'email' && value && !isEmail_(value)) {
      throw apiError_('Format email lembaga tidak valid.', 'VALIDATION');
    }
    if (key === 'waNumber') {
      assert_(/^62\d{8,14}$/.test(value), 'Nomor WhatsApp harus diawali 62 dan berisi 10–15 digit.', 'VALIDATION');
    }
    if (key === 'logoUrl' && value && !/^https:\/\//i.test(value) && !/^data:image\//i.test(value)) {
      throw apiError_('URL logo tidak valid.', 'VALIDATION');
    }
    if (key === 'brandTitle') assert_(value.length > 0, 'Nama lembaga wajib diisi.', 'VALIDATION');

    if (rowMap[key]) {
      updates.push([rowMap[key], value]);
    } else {
      sheet.appendRow([key, value, SETTING_DESCRIPTIONS[key] || '', nowIso_()]);
    }
  });

  updates.forEach(function (u) {
    sheet.getRange(u[0], 2).setValue(cell_(u[1]));
    sheet.getRange(u[0], 4).setValue(nowIso_());
  });

  CacheService.getScriptCache().remove('BRANDING_V1');
  log_(admin.u, 'PENGATURAN', 'Memperbarui branding lembaga');
  return getBranding_();
}

function uploadLogo_(payload, token) {
  var admin = requireAuth_(token);
  var data = String(payload.dataBase64 || '');
  var mime = String(payload.mimeType || '').toLowerCase();
  var name = str_(payload.fileName || 'logo.png', 120);

  assert_(/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(mime), 'Logo harus berupa gambar PNG, JPG, WEBP, atau SVG.', 'VALIDATION');
  assert_(data.length > 0, 'Data logo kosong.', 'VALIDATION');

  var bytes = base64ToBytes_(data);
  assert_(bytes.length <= 2 * 1024 * 1024, 'Ukuran logo maksimal 2 MB.', 'VALIDATION');

  var folder = getFolder_('BRANDING_FOLDER_ID', APP.BRANDING_FOLDER_NAME);
  var safeName = 'logo_' + Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd_HHmmss') + '_' + name.replace(/[^a-zA-Z0-9._-]/g, '_');
  var blob = Utilities.newBlob(bytes, mime, safeName);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w512';
  log_(admin.u, 'BRANDING', 'Mengunggah logo baru: ' + safeName);
  return { url: url, fileId: file.getId() };
}

/* ========================================================================== */
/*  AUTENTIKASI ADMIN                                                         */
/* ========================================================================== */

function login_(payload) {
  var username = str_(payload.username, 80).toLowerCase();
  var password = String(payload.password || '');
  assert_(username && password, 'Username dan password wajib diisi.', 'VALIDATION');

  var cache = CacheService.getScriptCache();
  var failKey = 'LOGIN_FAIL:' + username;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= APP.MAX_LOGIN_ATTEMPTS) {
    throw apiError_('Terlalu banyak percobaan login. Silakan coba lagi 15 menit kemudian.', 'LIMIT');
  }

  var sheet = db_().getSheetByName(SHEETS.ADMIN);
  var last = sheet.getLastRow();
  assert_(last > 1, 'Akun admin belum tersedia. Jalankan setupDatabase().', 'SETUP');

  var rows = sheet.getRange(2, 1, last - 1, ADMIN_FIELDS.length).getValues();
  var idx = {};
  ADMIN_FIELDS.forEach(function (f, i) { idx[f[0]] = i; });

  var found = null;
  var foundRow = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idx.username] || '').trim().toLowerCase() === username) {
      found = rows[i];
      foundRow = i + 2;
      break;
    }
  }

  var valid = false;
  if (found && String(found[idx.aktif] || '').toUpperCase() === 'YA') {
    var hash = hashPassword_(password, String(found[idx.salt] || ''));
    valid = safeEqual_(hash, String(found[idx.passwordHash] || ''));
  }

  if (!valid) {
    cache.put(failKey, String(fails + 1), 900);
    throw apiError_('Username atau password salah.', 'AUTH');
  }

  cache.remove(failKey);
  sheet.getRange(foundRow, idx.terakhirLogin + 1).setValue(nowIso_());

  var admin = {
    username: String(found[idx.username]),
    nama: String(found[idx.nama] || 'Administrator'),
    role: String(found[idx.role] || 'admin')
  };
  var session = createToken_(admin);
  log_(admin.username, 'LOGIN', 'Login admin berhasil');
  return session;
}

function createToken_(admin) {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var exp = Date.now() + (APP.TOKEN_TTL * 1000);
  var payload = {
    u: admin.username,
    nama: admin.nama,
    role: admin.role,
    ver: getAuthVersion_(),
    exp: exp
  };
  CacheService.getScriptCache().put('TOKEN:' + token, JSON.stringify(payload), APP.TOKEN_TTL);
  return {
    token: token,
    exp: exp,
    admin: admin
  };
}

function requireAuth_(token) {
  if (!token) throw apiError_('Sesi berakhir. Silakan masuk kembali.', 'AUTH');
  var raw = CacheService.getScriptCache().get('TOKEN:' + token);
  if (!raw) throw apiError_('Sesi berakhir. Silakan masuk kembali.', 'AUTH');

  var p;
  try { p = JSON.parse(raw); } catch (e) { throw apiError_('Sesi tidak valid.', 'AUTH'); }
  if (!p.exp || p.exp < Date.now()) throw apiError_('Sesi berakhir. Silakan masuk kembali.', 'AUTH');
  if (String(p.ver) !== String(getAuthVersion_())) {
    throw apiError_('Sesi telah diperbarui. Silakan masuk kembali.', 'AUTH');
  }
  return p;
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('TOKEN:' + token);
  return { ok: true };
}

function changePassword_(payload, token) {
  var admin = requireAuth_(token);
  var current = String(payload.current || '');
  var baru = String(payload.baru || '');
  var konfirmasi = String(payload.konfirmasi || '');

  assert_(current && baru && konfirmasi, 'Semua kolom password wajib diisi.', 'VALIDATION');
  assert_(baru.length >= 8, 'Password baru minimal 8 karakter.', 'VALIDATION');
  assert_(/[A-Za-z]/.test(baru) && /[0-9]/.test(baru), 'Password baru harus memuat huruf dan angka.', 'VALIDATION');
  assert_(baru === konfirmasi, 'Konfirmasi password tidak sama.', 'VALIDATION');

  var sheet = db_().getSheetByName(SHEETS.ADMIN);
  var last = sheet.getLastRow();
  var rows = sheet.getRange(2, 1, last - 1, ADMIN_FIELDS.length).getValues();
  var idx = {};
  ADMIN_FIELDS.forEach(function (f, i) { idx[f[0]] = i; });

  var foundRow = 0;
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idx.username]).toLowerCase() === String(admin.u).toLowerCase()) {
      found = rows[i];
      foundRow = i + 2;
      break;
    }
  }
  assert_(found, 'Akun admin tidak ditemukan.', 'NOT_FOUND');

  var hash = hashPassword_(current, String(found[idx.salt]));
  assert_(safeEqual_(hash, String(found[idx.passwordHash])), 'Password saat ini salah.', 'AUTH');

  var salt = Utilities.getUuid();
  sheet.getRange(foundRow, idx.salt + 1).setValue(salt);
  sheet.getRange(foundRow, idx.passwordHash + 1).setValue(hashPassword_(baru, salt));
  bumpAuthVersion_();
  log_(admin.u, 'KEAMANAN', 'Mengganti password admin');
  return { relogin: true };
}

/* ========================================================================== */
/*  PENGADUAN PUBLIK                                                          */
/* ========================================================================== */

function getBootstrap_() {
  var branding = getBranding_();
  return {
    branding: branding,
    publikasi: getPublikasi_(6),
    stats: getPublicStats_()
  };
}

function getPublicStats_() {
  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var last = sheet.getLastRow();
  var stats = { total: 0, selesai: 0, publikasi: 0, bulanIni: 0 };
  if (last < 2) return stats;

  var values = sheet.getRange(2, 1, last - 1, PERKARA_KEYS.length).getValues();
  var iStatus = PERKARA_KEYS.indexOf('status');
  var iPub = PERKARA_KEYS.indexOf('publikasi');
  var iWaktu = PERKARA_KEYS.indexOf('waktuDaftar');
  var month = todayKey_().slice(0, 7);

  values.forEach(function (r) {
    stats.total++;
    if (String(r[iStatus]) === 'Selesai') stats.selesai++;
    if (String(r[iPub]).toUpperCase() === 'YA') stats.publikasi++;
    if (String(r[iWaktu] || '').slice(0, 7) === month) stats.bulanIni++;
  });
  return stats;
}

function getPublikasi_(limit) {
  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, PERKARA_KEYS.length).getValues();
  var out = [];
  var idx = {};
  PERKARA_KEYS.forEach(function (k, i) { idx[k] = i; });

  values.forEach(function (r) {
    if (String(r[idx.publikasi]).toUpperCase() !== 'YA') return;
    var ringkasan = String(r[idx.ringkasanPublik] || '').trim();
    if (!ringkasan) return;

    out.push({
      nomorRegistrasi: String(r[idx.nomorRegistrasi] || ''),
      jenisPerkara: String(r[idx.jenisPerkara] || ''),
      ringkasanPublik: ringkasan,
      status: String(r[idx.status] || 'Baru'),
      tanggalKejadian: String(r[idx.tanggalKejadian] || ''),
      kabupaten: String(r[idx.kabupaten] || ''),
      inisial: initials_(String(r[idx.nama] || '')),
      waktuUpdate: String(r[idx.waktuUpdate] || r[idx.waktuDaftar] || '')
    });
  });

  out.sort(function (a, b) { return String(b.waktuUpdate).localeCompare(String(a.waktuUpdate)); });
  return out.slice(0, Math.max(1, Math.min(limit || 6, 24)));
}

function initials_(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function submitPengaduan_(payload) {
  var data = payload.data || {};
  var saksiInput = Array.isArray(payload.saksi) ? payload.saksi.slice(0, APP.MAX_WITNESSES) : [];

  /* ---- Validasi data pengadu ---- */
  var nama = str_(data.nama, 120);
  var nik = str_(data.nik, 16);
  var tempatLahir = str_(data.tempatLahir, 100);
  var tanggalLahir = str_(data.tanggalLahir, 10);
  var jenisKelamin = str_(data.jenisKelamin, 20);
  var agama = str_(data.agama, 30);
  var statusPerkawinan = str_(data.statusPerkawinan, 40);
  var pendidikan = str_(data.pendidikan, 60);
  var pekerjaan = str_(data.pekerjaan, 100);
  var alamat = str_(data.alamat, 400);
  var rt = str_(data.rt, 5);
  var rw = str_(data.rw, 5);
  var desa = str_(data.desa, 100);
  var kecamatan = str_(data.kecamatan, 100);
  var kabupaten = str_(data.kabupaten, 100);
  var provinsi = str_(data.provinsi, 100);
  var noHP = normalizePhone_(data.noHP);
  var email = str_(data.email, 120).toLowerCase();

  assert_(nama.length >= 3, 'Nama lengkap wajib diisi (minimal 3 karakter).', 'VALIDATION');
  assert_(/^\d{16}$/.test(nik), 'NIK harus terdiri dari 16 digit angka.', 'VALIDATION');
  assert_(tempatLahir, 'Tempat lahir wajib diisi.', 'VALIDATION');
  assert_(/^\d{4}-\d{2}-\d{2}$/.test(tanggalLahir), 'Tanggal lahir wajib diisi.', 'VALIDATION');
  assert_(jenisKelamin === 'Laki-laki' || jenisKelamin === 'Perempuan', 'Jenis kelamin wajib dipilih.', 'VALIDATION');
  assert_(pekerjaan, 'Pekerjaan wajib diisi.', 'VALIDATION');
  assert_(alamat.length >= 5, 'Alamat sesuai KTP wajib diisi.', 'VALIDATION');
  assert_(desa, 'Desa/Kelurahan wajib diisi.', 'VALIDATION');
  assert_(kecamatan, 'Kecamatan wajib diisi.', 'VALIDATION');
  assert_(kabupaten, 'Kabupaten/Kota wajib diisi.', 'VALIDATION');
  assert_(provinsi, 'Provinsi wajib diisi.', 'VALIDATION');
  assert_(/^62\d{8,14}$/.test(noHP), 'Nomor HP/WhatsApp tidak valid. Gunakan format 08xx atau 62xx.', 'VALIDATION');
  assert_(!email || isEmail_(email), 'Format email tidak valid.', 'VALIDATION');

  /* ---- Validasi data perkara ---- */
  var jenisPerkara = str_(data.jenisPerkara, 80);
  var judulPerkara = str_(data.judulPerkara, 180);
  var kronologi = str_(data.kronologi, 10000);
  var tanggalKejadian = str_(data.tanggalKejadian, 10);
  var lokasiKejadian = str_(data.lokasiKejadian, 300);
  var pihakLawan = str_(data.pihakLawan, 180);
  var nilaiKerugian = str_(data.nilaiKerugian, 30);
  var sudahDilaporkan = str_(data.sudahDilaporkan, 5).toUpperCase() === 'YA' ? 'YA' : 'TIDAK';
  var instansi = str_(data.instansi, 180);
  var noLaporan = str_(data.noLaporan, 100);
  var punyaKuasaHukum = str_(data.punyaKuasaHukum, 5).toUpperCase() === 'YA' ? 'YA' : 'TIDAK';
  var urgensi = str_(data.urgensi, 20);

  assert_(JENIS_PERKARA_LIST.indexOf(jenisPerkara) !== -1, 'Jenis perkara wajib dipilih.', 'VALIDATION');
  assert_(judulPerkara.length >= 5, 'Judul perkara wajib diisi (minimal 5 karakter).', 'VALIDATION');
  assert_(kronologi.length >= 50, 'Kronologi wajib diisi minimal 50 karakter agar dapat dipahami petugas.', 'VALIDATION');
  assert_(/^\d{4}-\d{2}-\d{2}$/.test(tanggalKejadian), 'Tanggal kejadian wajib diisi.', 'VALIDATION');
  assert_(lokasiKejadian.length >= 5, 'Lokasi kejadian wajib diisi.', 'VALIDATION');
  assert_(pihakLawan.length >= 3, 'Pihak lawan wajib diisi.', 'VALIDATION');
  assert_(URGENSI_LIST.indexOf(urgensi) !== -1, 'Tingkat urgensi wajib dipilih.', 'VALIDATION');
  if (sudahDilaporkan === 'YA') {
    assert_(instansi, 'Instansi tempat melapor wajib diisi.', 'VALIDATION');
  }

  /* ---- Harapan & persetujuan ---- */
  var harapan = str_(data.harapan, 5000);
  var pernyataan = data.pernyataan === true || String(data.pernyataan) === 'true';
  var persetujuan = data.persetujuan === true || String(data.persetujuan) === 'true';
  assert_(harapan.length >= 10, 'Harapan klien wajib diisi minimal 10 karakter.', 'VALIDATION');
  assert_(pernyataan, 'Anda harus menyatakan bahwa data yang diberikan adalah benar.', 'VALIDATION');
  assert_(persetujuan, 'Anda harus menyetujui pemrosesan data pribadi.', 'VALIDATION');

  /* ---- Tanda tangan (opsional) ---- */
  var tandaTangan = String(data.tandaTangan || '');
  if (tandaTangan) {
    assert_(/^data:image\/(png|jpeg|jpg);base64,/i.test(tandaTangan), 'Format tanda tangan tidak valid.', 'VALIDATION');
    assert_(tandaTangan.length <= 49000, 'Tanda tangan terlalu besar. Silakan hapus dan gambar ulang.', 'VALIDATION');
  }

  /* ---- Validasi saksi ---- */
  var cleanSaksi = [];
  saksiInput.forEach(function (s) {
    var namaSaksi = str_(s.nama, 120);
    var alamatSaksi = str_(s.alamat, 300);
    var hpSaksi = str_(s.noHP, 30);
    var ketSaksi = str_(s.keterangan, 500);
    var nikSaksi = str_(s.nik, 16);
    if (!namaSaksi && !alamatSaksi && !hpSaksi && !ketSaksi && !nikSaksi) return;

    assert_(namaSaksi.length >= 3, 'Nama saksi wajib diisi.', 'VALIDATION');
    assert_(!nikSaksi || /^\d{16}$/.test(nikSaksi), 'NIK saksi harus 16 digit.', 'VALIDATION');
    cleanSaksi.push({
      nama: namaSaksi,
      nik: nikSaksi,
      hubungan: str_(s.hubungan, 80),
      alamat: alamatSaksi,
      noHP: hpSaksi,
      keterangan: ketSaksi
    });
  });

  var ss = db_();
  var sheet = ss.getSheetByName(SHEETS.PERKARA);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var now = nowIso_();
    var id = 'P-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    var nomor = nextRegistrationNumber_(sheet);
    var waNumber = getBranding_().waNumber;

    var row = {
      id: id,
      nomorRegistrasi: nomor,
      waktuDaftar: now,
      nama: nama,
      nik: nik,
      tempatLahir: tempatLahir,
      tanggalLahir: tanggalLahir,
      jenisKelamin: jenisKelamin,
      agama: agama,
      statusPerkawinan: statusPerkawinan,
      pendidikan: pendidikan,
      pekerjaan: pekerjaan,
      alamat: alamat,
      rt: rt,
      rw: rw,
      desa: desa,
      kecamatan: kecamatan,
      kabupaten: kabupaten,
      provinsi: provinsi,
      noHP: noHP,
      email: email,
      jenisPerkara: jenisPerkara,
      judulPerkara: judulPerkara,
      kronologi: kronologi,
      tanggalKejadian: tanggalKejadian,
      lokasiKejadian: lokasiKejadian,
      pihakLawan: pihakLawan,
      nilaiKerugian: nilaiKerugian,
      sudahDilaporkan: sudahDilaporkan,
      instansi: instansi,
      noLaporan: noLaporan,
      punyaKuasaHukum: punyaKuasaHukum,
      urgensi: urgensi,
      harapan: harapan,
      tandaTangan: tandaTangan,
      pernyataan: 'YA',
      persetujuan: 'YA',
      status: 'Baru',
      statusCatatan: '',
      publikasi: 'TIDAK',
      ringkasanPublik: '',
      buktiCount: 0,
      driveFolderId: '',
      waktuUpdate: now
    };

    var values = PERKARA_KEYS.map(function (k) { return cell_(row[k]); });
    sheet.appendRow(values);
    var rowIndex = sheet.getLastRow();

    /* Simpan saksi */
    if (cleanSaksi.length) {
      var saksiSheet = ss.getSheetByName(SHEETS.SAKSI);
      var saksiRows = cleanSaksi.map(function (s) {
        return [
          'S-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
          id,
          cell_(s.nama),
          cell_(s.nik),
          cell_(s.hubungan),
          cell_(s.alamat),
          cell_(s.noHP),
          cell_(s.keterangan),
          now
        ];
      });
      saksiSheet.getRange(saksiSheet.getLastRow() + 1, 1, saksiRows.length, SAKSI_FIELDS.length).setValues(saksiRows);
    }

    /* Riwayat status awal */
    var statusSheet = ss.getSheetByName(SHEETS.STATUS);
    statusSheet.appendRow([
      'H-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
      id, '', 'Baru', 'Pengaduan diterima melalui formulir online.', 'Pengadu', now
    ]);

    var uploadToken = Utilities.getUuid().replace(/-/g, '');
    CacheService.getScriptCache().put('UPLOAD:' + id, uploadToken, 7200);

    log_(nama, 'PENGADUAN_BARU', nomor + ' — ' + jenisPerkara + ' — ' + judulPerkara);

    return {
      id: id,
      nomorRegistrasi: nomor,
      uploadToken: uploadToken,
      waNumber: waNumber,
      brandTitle: getBranding_().brandTitle,
      nama: nama,
      jenisPerkara: jenisPerkara,
      judulPerkara: judulPerkara,
      waktuDaftar: now,
      rowIndex: rowIndex
    };
  } finally {
    lock.releaseLock();
  }
}

function nextRegistrationNumber_(sheet) {
  var prefix = 'LBH-' + Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd') + '-';
  var last = sheet.getLastRow();
  var max = 0;
  if (last > 1) {
    var col = PERKARA_KEYS.indexOf('nomorRegistrasi') + 1;
    var values = sheet.getRange(2, col, last - 1, 1).getValues();
    values.forEach(function (r) {
      var s = String(r[0] || '');
      if (s.indexOf(prefix) === 0) {
        var n = parseInt(s.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return prefix + ('00' + (max + 1)).slice(-3);
}

function uploadBukti_(payload) {
  var caseId = str_(payload.caseId, 80);
  var token = str_(payload.uploadToken, 80);
  assert_(caseId && token, 'Permintaan unggah tidak valid.', 'VALIDATION');

  var expected = CacheService.getScriptCache().get('UPLOAD:' + caseId);
  assert_(expected && safeEqual_(expected, token), 'Sesi unggah berakhir. Silakan hubungi petugas dengan menyebutkan nomor registrasi Anda.', 'AUTH');

  var ss = db_();
  var sheet = ss.getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, caseId);
  assert_(rowIndex, 'Perkara tidak ditemukan.', 'NOT_FOUND');

  var row = getPerkaraRowObject_(sheet, rowIndex);

  var buktiSheet = ss.getSheetByName(SHEETS.BUKTI);
  var existing = countBukti_(buktiSheet, caseId);
  assert_(existing < APP.MAX_FILES, 'Jumlah berkas bukti maksimal ' + APP.MAX_FILES + ' per perkara.', 'LIMIT');

  var data = String(payload.dataBase64 || '');
  assert_(data.length > 0, 'Data berkas kosong.', 'VALIDATION');
  var bytes = base64ToBytes_(data);
  assert_(bytes.length > 0, 'Berkas tidak valid.', 'VALIDATION');
  assert_(bytes.length <= APP.MAX_FILE_MB * 1024 * 1024, 'Ukuran setiap berkas maksimal ' + APP.MAX_FILE_MB + ' MB.', 'LIMIT');

  var mime = String(payload.mimeType || '').toLowerCase().split(';')[0];
  var allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  assert_(allowed.indexOf(mime) !== -1, 'Tipe berkas tidak diizinkan. Gunakan JPG, PNG, WEBP, PDF, DOC, atau DOCX.', 'VALIDATION');

  var sumber = String(payload.sumber || 'unggah').toLowerCase() === 'kamera' ? 'kamera' : 'unggah';
  var originalName = str_(payload.fileName || 'bukti', 140);
  var safeName = originalName.replace(/[\\/:*?"<>|#%{}]/g, '_').replace(/\s+/g, '_').slice(-90);
  var fileName = Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMdd-HHmmss') + '_' +
    sumber + '_' + safeName;

  var folder = getCaseFolder_(row);
  var file = folder.createFile(Utilities.newBlob(bytes, mime, fileName));

  var now = nowIso_();
  var fileId = 'B-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';

  buktiSheet.appendRow([
    fileId, caseId, cell_(originalName), mime, bytes.length,
    file.getId(), url, sumber, now
  ]);

  var total = countBukti_(buktiSheet, caseId);
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('buktiCount') + 1).setValue(total);
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('waktuUpdate') + 1).setValue(now);

  return {
    id: fileId,
    namaFile: originalName,
    mimeType: mime,
    ukuran: bytes.length,
    url: url,
    sumber: sumber,
    total: total
  };
}

function getCaseFolder_(row) {
  if (row.driveFolderId) {
    try { return DriveApp.getFolderById(row.driveFolderId); } catch (e) { /* buat ulang */ }
  }
  var parent = getFolder_('DRIVE_FOLDER_ID', APP.DRIVE_FOLDER_NAME);
  var safeName = (row.nomorRegistrasi || row.id) + ' - ' +
    String(row.nama || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 60);
  var folder = parent.createFolder(safeName);

  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, row.id);
  if (rowIndex) {
    sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('driveFolderId') + 1).setValue(folder.getId());
  }
  return folder;
}

function countBukti_(sheet, caseId) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var values = sheet.getRange(2, 2, last - 1, 1).getValues();
  var count = 0;
  values.forEach(function (r) { if (String(r[0]) === String(caseId)) count++; });
  return count;
}

function base64ToBytes_(data) {
  var clean = String(data || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s/g, '');
  try {
    return Utilities.base64Decode(clean);
  } catch (e) {
    throw apiError_('Berkas tidak dapat dibaca. Silakan unggah ulang.', 'VALIDATION');
  }
}

/* ========================================================================== */
/*  ADMIN — DASHBOARD & PERKARA                                               */
/* ========================================================================== */

function getDashboard_() {
  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var last = sheet.getLastRow();
  var empty = {
    stats: { total: 0, baru: 0, proses: 0, selesai: 0, ditolak: 0, publikasi: 0, bulanIni: 0 },
    statusCounts: [], jenisCounts: [], monthly: [], recent: []
  };
  if (last < 2) return empty;

  var values = sheet.getRange(2, 1, last - 1, PERKARA_KEYS.length).getValues();
  var idx = {};
  PERKARA_KEYS.forEach(function (k, i) { idx[k] = i; });

  var stats = { total: 0, baru: 0, proses: 0, selesai: 0, ditolak: 0, publikasi: 0, bulanIni: 0 };
  var statusMap = {};
  var jenisMap = {};
  var month = todayKey_().slice(0, 7);
  var now = new Date();
  var months = [];
  var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  for (var m = 5; m >= 0; m--) {
    var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
    months.push({ key: key, label: monthNames[d.getMonth()], count: 0 });
  }

  var cases = [];
  values.forEach(function (r) {
    var status = String(r[idx.status] || 'Baru');
    stats.total++;
    if (status === 'Baru') stats.baru++;
    if (status === 'Diverifikasi' || status === 'Dalam Proses' || status === 'Mediasi') stats.proses++;
    if (status === 'Selesai') stats.selesai++;
    if (status === 'Ditolak') stats.ditolak++;
    if (String(r[idx.publikasi]).toUpperCase() === 'YA') stats.publikasi++;
    if (String(r[idx.waktuDaftar] || '').slice(0, 7) === month) stats.bulanIni++;

    statusMap[status] = (statusMap[status] || 0) + 1;
    var jenis = String(r[idx.jenisPerkara] || 'Lainnya');
    jenisMap[jenis] = (jenisMap[jenis] || 0) + 1;

    var wkey = String(r[idx.waktuDaftar] || '').slice(0, 7);
    months.forEach(function (mm) { if (mm.key === wkey) mm.count++; });

    cases.push(summaryFromRow_(r, idx));
  });

  cases.sort(function (a, b) { return String(b.waktuDaftar).localeCompare(String(a.waktuDaftar)); });

  var statusCounts = STATUS_LIST.map(function (s) {
    return { label: s, count: statusMap[s] || 0 };
  }).filter(function (s) { return s.count > 0; });

  var jenisCounts = Object.keys(jenisMap).map(function (k) {
    return { label: k, count: jenisMap[k] };
  }).sort(function (a, b) { return b.count - a.count; });

  return {
    stats: stats,
    statusCounts: statusCounts,
    jenisCounts: jenisCounts,
    monthly: months,
    recent: cases.slice(0, 6)
  };
}

function summaryFromRow_(r, idx) {
  return {
    id: String(r[idx.id] || ''),
    nomorRegistrasi: String(r[idx.nomorRegistrasi] || ''),
    nama: String(r[idx.nama] || ''),
    nik: String(r[idx.nik] || ''),
    noHP: String(r[idx.noHP] || ''),
    jenisPerkara: String(r[idx.jenisPerkara] || ''),
    judulPerkara: String(r[idx.judulPerkara] || ''),
    kabupaten: String(r[idx.kabupaten] || ''),
    urgensi: String(r[idx.urgensi] || ''),
    status: String(r[idx.status] || 'Baru'),
    publikasi: String(r[idx.publikasi] || 'TIDAK'),
    buktiCount: Number(r[idx.buktiCount] || 0),
    waktuDaftar: String(r[idx.waktuDaftar] || ''),
    waktuUpdate: String(r[idx.waktuUpdate] || ''),
    tanggalKejadian: String(r[idx.tanggalKejadian] || '')
  };
}

function listPerkara_() {
  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var last = sheet.getLastRow();
  if (last < 2) return [];

  var values = sheet.getRange(2, 1, last - 1, PERKARA_KEYS.length).getValues();
  var idx = {};
  PERKARA_KEYS.forEach(function (k, i) { idx[k] = i; });

  var out = values.map(function (r) { return summaryFromRow_(r, idx); });
  out.sort(function (a, b) { return String(b.waktuDaftar).localeCompare(String(a.waktuDaftar)); });
  return out;
}

function getPerkara_(id) {
  id = str_(id, 80);
  assert_(id, 'ID perkara wajib diisi.', 'VALIDATION');

  var ss = db_();
  var sheet = ss.getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, id);
  assert_(rowIndex, 'Perkara tidak ditemukan.', 'NOT_FOUND');

  var perkara = getPerkaraRowObject_(sheet, rowIndex);

  var saksi = [];
  var saksiSheet = ss.getSheetByName(SHEETS.SAKSI);
  var sLast = saksiSheet.getLastRow();
  if (sLast > 1) {
    saksiSheet.getRange(2, 1, sLast - 1, SAKSI_FIELDS.length).getValues().forEach(function (r) {
      if (String(r[1]) !== id) return;
      saksi.push({
        id: String(r[0]), nama: String(r[2]), nik: String(r[3]),
        hubungan: String(r[4]), alamat: String(r[5]),
        noHP: String(r[6]), keterangan: String(r[7])
      });
    });
  }

  var bukti = [];
  var buktiSheet = ss.getSheetByName(SHEETS.BUKTI);
  var bLast = buktiSheet.getLastRow();
  if (bLast > 1) {
    buktiSheet.getRange(2, 1, bLast - 1, BUKTI_FIELDS.length).getValues().forEach(function (r) {
      if (String(r[1]) !== id) return;
      bukti.push({
        id: String(r[0]), namaFile: String(r[2]), mimeType: String(r[3]),
        ukuran: Number(r[4] || 0), driveFileId: String(r[5]), url: String(r[6]),
        sumber: String(r[7]), waktu: String(r[8])
      });
    });
  }

  var riwayat = [];
  var statusSheet = ss.getSheetByName(SHEETS.STATUS);
  var hLast = statusSheet.getLastRow();
  if (hLast > 1) {
    statusSheet.getRange(2, 1, hLast - 1, STATUS_FIELDS.length).getValues().forEach(function (r) {
      if (String(r[1]) !== id) return;
      riwayat.push({
        id: String(r[0]), statusLama: String(r[2]), statusBaru: String(r[3]),
        catatan: String(r[4]), oleh: String(r[5]), waktu: String(r[6])
      });
    });
  }
  riwayat.sort(function (a, b) { return String(a.waktu).localeCompare(String(b.waktu)); });

  return { perkara: perkara, saksi: saksi, bukti: bukti, riwayat: riwayat };
}

function findPerkaraRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var values = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 2;
  }
  return 0;
}

function getPerkaraRowObject_(sheet, rowIndex) {
  var values = sheet.getRange(rowIndex, 1, 1, PERKARA_KEYS.length).getValues()[0];
  var obj = {};
  PERKARA_KEYS.forEach(function (k, i) { obj[k] = values[i]; });
  obj.buktiCount = Number(obj.buktiCount || 0);
  return obj;
}

function updateStatus_(payload, token) {
  var admin = requireAuth_(token);
  var id = str_(payload.id, 80);
  var status = str_(payload.status, 40);
  var catatan = str_(payload.catatan, 1000);

  assert_(id, 'ID perkara wajib diisi.', 'VALIDATION');
  assert_(STATUS_LIST.indexOf(status) !== -1, 'Status tidak valid.', 'VALIDATION');

  var ss = db_();
  var sheet = ss.getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, id);
  assert_(rowIndex, 'Perkara tidak ditemukan.', 'NOT_FOUND');

  var old = getPerkaraRowObject_(sheet, rowIndex);
  var now = nowIso_();

  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('status') + 1).setValue(status);
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('statusCatatan') + 1).setValue(cell_(catatan));
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('waktuUpdate') + 1).setValue(now);

  var statusSheet = ss.getSheetByName(SHEETS.STATUS);
  statusSheet.appendRow([
    'H-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
    id, String(old.status || ''), status, cell_(catatan || 'Status diperbarui.'), admin.nama, now
  ]);

  log_(admin.u, 'UPDATE_STATUS', old.nomorRegistrasi + ': ' + old.status + ' → ' + status);
  return summaryFromRow_(getPerkaraRowObject_(sheet, rowIndex), indexMap_());
}

function updatePublikasi_(payload, token) {
  var admin = requireAuth_(token);
  var id = str_(payload.id, 80);
  var publikasi = String(payload.publikasi || '').toUpperCase() === 'YA' ? 'YA' : 'TIDAK';
  var ringkasan = str_(payload.ringkasan, 800);

  assert_(id, 'ID perkara wajib diisi.', 'VALIDATION');
  if (publikasi === 'YA') {
    assert_(ringkasan.length >= 40, 'Ringkasan publikasi minimal 40 karakter agar aman dan informatif.', 'VALIDATION');
  }

  var sheet = db_().getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, id);
  assert_(rowIndex, 'Perkara tidak ditemukan.', 'NOT_FOUND');

  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('publikasi') + 1).setValue(publikasi);
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('ringkasanPublik') + 1).setValue(cell_(ringkasan));
  sheet.getRange(rowIndex, PERKARA_KEYS.indexOf('waktuUpdate') + 1).setValue(nowIso_());

  var row = getPerkaraRowObject_(sheet, rowIndex);
  log_(admin.u, 'PUBLIKASI', row.nomorRegistrasi + ' → ' + publikasi);
  return summaryFromRow_(row, indexMap_());
}

function indexMap_() {
  var idx = {};
  PERKARA_KEYS.forEach(function (k, i) { idx[k] = i; });
  return idx;
}

function deletePerkara_(id, token) {
  var admin = requireAuth_(token);
  id = str_(id, 80);
  assert_(id, 'ID perkara wajib diisi.', 'VALIDATION');

  var ss = db_();
  var sheet = ss.getSheetByName(SHEETS.PERKARA);
  var rowIndex = findPerkaraRow_(sheet, id);
  assert_(rowIndex, 'Perkara tidak ditemukan.', 'NOT_FOUND');
  var row = getPerkaraRowObject_(sheet, rowIndex);

  /* Hapus berkas Drive */
  var buktiSheet = ss.getSheetByName(SHEETS.BUKTI);
  var bLast = buktiSheet.getLastRow();
  if (bLast > 1) {
    var bRows = buktiSheet.getRange(2, 1, bLast - 1, BUKTI_FIELDS.length).getValues();
    for (var i = bRows.length - 1; i >= 0; i--) {
      if (String(bRows[i][1]) !== id) continue;
      try { DriveApp.getFileById(String(bRows[i][5])).setTrashed(true); } catch (e) { /* abaikan */ }
      buktiSheet.deleteRow(i + 2);
    }
  }
  if (row.driveFolderId) {
    try { DriveApp.getFolderById(String(row.driveFolderId)).setTrashed(true); } catch (e) { /* abaikan */ }
  }

  /* Hapus saksi & riwayat */
  deleteRowsByCase_(ss.getSheetByName(SHEETS.SAKSI), id, 2);
  deleteRowsByCase_(ss.getSheetByName(SHEETS.STATUS), id, 2);

  sheet.deleteRow(rowIndex);
  log_(admin.u, 'HAPUS_PERKARA', row.nomorRegistrasi + ' — ' + row.nama);
  return { ok: true, nomorRegistrasi: row.nomorRegistrasi };
}

function deleteRowsByCase_(sheet, caseId, col) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var values = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(caseId)) sheet.deleteRow(i + 2);
  }
}

function getBuktiData_(id) {
  id = str_(id, 80);
  assert_(id, 'ID bukti wajib diisi.', 'VALIDATION');

  var sheet = db_().getSheetByName(SHEETS.BUKTI);
  var last = sheet.getLastRow();
  assert_(last > 1, 'Bukti tidak ditemukan.', 'NOT_FOUND');

  var values = sheet.getRange(2, 1, last - 1, BUKTI_FIELDS.length).getValues();
  var found = null;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === id) { found = values[i]; break; }
  }
  assert_(found, 'Bukti tidak ditemukan.', 'NOT_FOUND');

  var file;
  try { file = DriveApp.getFileById(String(found[5])); } catch (e) {
    throw apiError_('Berkas tidak dapat diakses. Pastikan akun pemilik masih memiliki akses Drive.', 'NOT_FOUND');
  }
  var blob = file.getBlob();
  var bytes = blob.getBytes();
  assert_(bytes.length <= 15 * 1024 * 1024, 'Berkas terlalu besar untuk dipratinjau (maks. 15 MB).', 'LIMIT');

  return {
    namaFile: String(found[2]),
    mimeType: String(found[3]),
    ukuran: bytes.length,
    dataBase64: Utilities.base64Encode(bytes)
  };
}

/* ========================================================================== */
/*  UTIL TAMBAHAN                                                             */
/* ========================================================================== */

/** Menampilkan URL web app di log — berguna saat pertama kali deploy. */
function showWebAppUrl() {
  var url = ScriptApp.getService().getUrl();
  Logger.log(url || 'Web app belum di-deploy.');
  return url;
}
