/**
 * LBH ASYSYUJA — Server pengembangan lokal.
 *
 * Bukan untuk produksi. Tujuannya agar index.html dapat diuji penuh
 * (termasuk upload, login admin, dashboard) sebelum di-deploy ke Google
 * Apps Script. Data disimpan di memori dan hilang saat server dimatikan.
 *
 * Jalankan:  node server.js        lalu buka http://localhost:3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Admin#LBH2026';
const TOKEN_TTL = 6 * 60 * 60 * 1000;

const db = {
  branding: {
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
    tentangSingkat: 'LBH ASYSYUJA adalah lembaga bantuan hukum yang berfokus pada pendampingan masyarakat kurang mampu, korban kekerasan, dan kelompok rentan.'
  },
  cases: [],
  sessions: new Map(),
  uploads: new Map(),
  seq: 1
};

const STATUS_LIST = ['Baru', 'Diverifikasi', 'Dalam Proses', 'Mediasi', 'Selesai', 'Ditolak'];
const JENIS_LIST = ['Pidana', 'Perdata', 'Keluarga', 'Tata Usaha Negara', 'Hubungan Industrial', 'Perlindungan Anak & Perempuan', 'Konsumen', 'Pertanahan', 'Lainnya'];
const URGENSI_LIST = ['Rendah', 'Sedang', 'Tinggi', 'Darurat'];

/* --------------------------------------------------------------- helpers */
const err = (message, code = 'VALIDATION') => { const e = new Error(message); e.code = code; return e; };
const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');
const normPhone = (v) => {
  const d = digits(v);
  if (d.startsWith('62')) return d;
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
};
const nowIso = () => {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 19);
};
const today = () => nowIso().slice(0, 10);

function initials(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function summary(c) {
  return {
    id: c.id, nomorRegistrasi: c.nomorRegistrasi, nama: c.nama, nik: c.nik, noHP: c.noHP,
    jenisPerkara: c.jenisPerkara, judulPerkara: c.judulPerkara, kabupaten: c.kabupaten,
    urgensi: c.urgensi, status: c.status, publikasi: c.publikasi,
    buktiCount: (c.bukti || []).length, waktuDaftar: c.waktuDaftar,
    waktuUpdate: c.waktuUpdate, tanggalKejadian: c.tanggalKejadian
  };
}

function auth(token) {
  const s = db.sessions.get(token);
  if (!s || s.exp < Date.now()) {
    db.sessions.delete(token);
    throw err('Sesi berakhir. Silakan masuk kembali.', 'AUTH');
  }
  return s.admin;
}

function nextNomor() {
  const prefix = 'LBH-' + today().replace(/-/g, '') + '-';
  const max = db.cases.reduce((acc, c) => {
    if (!c.nomorRegistrasi.startsWith(prefix)) return acc;
    const n = parseInt(c.nomorRegistrasi.slice(prefix.length), 10);
    return Number.isNaN(n) ? acc : Math.max(acc, n);
  }, 0);
  return prefix + String(max + 1).padStart(3, '0');
}

/* ---------------------------------------------------------------- routes */
function getBootstrap() {
  const s = getPublicStats();
  return {
    branding: db.branding,
    stats: s,
    publikasi: db.cases
      .filter((c) => c.publikasi === 'YA' && c.ringkasanPublik)
      .sort((a, b) => String(b.waktuUpdate).localeCompare(String(a.waktuUpdate)))
      .slice(0, 6)
      .map((c) => ({
        nomorRegistrasi: c.nomorRegistrasi, jenisPerkara: c.jenisPerkara,
        ringkasanPublik: c.ringkasanPublik, status: c.status,
        tanggalKejadian: c.tanggalKejadian, kabupaten: c.kabupaten,
        inisial: initials(c.nama), waktuUpdate: c.waktuUpdate
      }))
  };
}

function getPublicStats() {
  const month = today().slice(0, 7);
  return {
    total: db.cases.length,
    selesai: db.cases.filter((c) => c.status === 'Selesai').length,
    publikasi: db.cases.filter((c) => c.publikasi === 'YA').length,
    bulanIni: db.cases.filter((c) => String(c.waktuDaftar).slice(0, 7) === month).length
  };
}

function submitPengaduan(payload) {
  const d = payload.data || {};
  const req = (cond, msg) => { if (!cond) throw err(msg); };

  req(String(d.nama || '').trim().length >= 3, 'Nama lengkap wajib diisi (minimal 3 karakter).');
  req(/^\d{16}$/.test(digits(d.nik)), 'NIK harus terdiri dari 16 digit angka.');
  req(String(d.tempatLahir || '').trim(), 'Tempat lahir wajib diisi.');
  req(/^\d{4}-\d{2}-\d{2}$/.test(String(d.tanggalLahir || '')), 'Tanggal lahir wajib diisi.');
  req(d.jenisKelamin === 'Laki-laki' || d.jenisKelamin === 'Perempuan', 'Jenis kelamin wajib dipilih.');
  req(String(d.pekerjaan || '').trim(), 'Pekerjaan wajib diisi.');
  req(String(d.alamat || '').trim().length >= 5, 'Alamat sesuai KTP wajib diisi.');
  req(String(d.desa || '').trim(), 'Desa/Kelurahan wajib diisi.');
  req(String(d.kecamatan || '').trim(), 'Kecamatan wajib diisi.');
  req(String(d.kabupaten || '').trim(), 'Kabupaten/Kota wajib diisi.');
  req(String(d.provinsi || '').trim(), 'Provinsi wajib diisi.');
  req(/^62\d{8,14}$/.test(normPhone(d.noHP)), 'Nomor HP/WhatsApp tidak valid.');
  req(JENIS_LIST.includes(d.jenisPerkara), 'Jenis perkara wajib dipilih.');
  req(String(d.judulPerkara || '').trim().length >= 5, 'Judul perkara wajib diisi (minimal 5 karakter).');
  req(String(d.kronologi || '').trim().length >= 50, 'Kronologi wajib diisi minimal 50 karakter.');
  req(/^\d{4}-\d{2}-\d{2}$/.test(String(d.tanggalKejadian || '')), 'Tanggal kejadian wajib diisi.');
  req(String(d.lokasiKejadian || '').trim().length >= 5, 'Lokasi kejadian wajib diisi.');
  req(String(d.pihakLawan || '').trim().length >= 3, 'Pihak lawan wajib diisi.');
  req(URGENSI_LIST.includes(d.urgensi), 'Tingkat urgensi wajib dipilih.');
  req(String(d.harapan || '').trim().length >= 10, 'Harapan klien wajib diisi minimal 10 karakter.');
  req(d.pernyataan === true, 'Anda harus menyatakan data yang diberikan adalah benar.');
  req(d.persetujuan === true, 'Anda harus menyetujui pemrosesan data pribadi.');

  const id = 'P-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const nomor = nextNomor();
  const now = nowIso();

  const perkara = {
    id, nomorRegistrasi: nomor, waktuDaftar: now,
    nama: String(d.nama).trim(), nik: digits(d.nik),
    tempatLahir: d.tempatLahir, tanggalLahir: d.tanggalLahir,
    jenisKelamin: d.jenisKelamin, agama: d.agama || '', statusPerkawinan: d.statusPerkawinan || '',
    pendidikan: d.pendidikan || '', pekerjaan: d.pekerjaan, alamat: d.alamat,
    rt: d.rt || '', rw: d.rw || '', desa: d.desa, kecamatan: d.kecamatan,
    kabupaten: d.kabupaten, provinsi: d.provinsi,
    noHP: normPhone(d.noHP), email: String(d.email || '').toLowerCase(),
    jenisPerkara: d.jenisPerkara, judulPerkara: d.judulPerkara, kronologi: d.kronologi,
    tanggalKejadian: d.tanggalKejadian, lokasiKejadian: d.lokasiKejadian,
    pihakLawan: d.pihakLawan, nilaiKerugian: digits(d.nilaiKerugian),
    sudahDilaporkan: String(d.sudahDilaporkan).toUpperCase() === 'YA' ? 'YA' : 'TIDAK',
    instansi: d.instansi || '', noLaporan: d.noLaporan || '',
    punyaKuasaHukum: String(d.punyaKuasaHukum).toUpperCase() === 'YA' ? 'YA' : 'TIDAK',
    urgensi: d.urgensi, harapan: d.harapan, tandaTangan: d.tandaTangan || '',
    status: 'Baru', statusCatatan: '', publikasi: 'TIDAK', ringkasanPublik: '',
    waktuUpdate: now,
    saksi: (payload.saksi || []).filter((s) => s && s.nama).map((s, i) => ({
      id: 'S-' + (db.seq++) + '-' + i, nama: s.nama, nik: s.nik || '',
      hubungan: s.hubungan || '', alamat: s.alamat || '', noHP: s.noHP || '', keterangan: s.keterangan || ''
    })),
    bukti: [],
    riwayat: [{ id: 'H-' + db.seq++, statusLama: '', statusBaru: 'Baru', catatan: 'Pengaduan diterima melalui formulir online.', oleh: 'Pengadu', waktu: now }]
  };

  db.cases.push(perkara);

  const uploadToken = crypto.randomBytes(16).toString('hex');
  db.uploads.set(id, uploadToken);

  return {
    id, nomorRegistrasi: nomor, uploadToken, waNumber: db.branding.waNumber,
    brandTitle: db.branding.brandTitle, nama: perkara.nama,
    jenisPerkara: perkara.jenisPerkara, judulPerkara: perkara.judulPerkara, waktuDaftar: now
  };
}

function uploadBukti(payload) {
  const { caseId, uploadToken, fileName, mimeType, dataBase64, sumber } = payload;
  if (!caseId || !uploadToken) throw err('Permintaan unggah tidak valid.');
  if (db.uploads.get(caseId) !== uploadToken) throw err('Sesi unggah berakhir.', 'AUTH');

  const c = db.cases.find((x) => x.id === caseId);
  if (!c) throw err('Perkara tidak ditemukan.', 'NOT_FOUND');
  if (c.bukti.length >= 8) throw err('Jumlah berkas bukti maksimal 8 per perkara.', 'LIMIT');

  const size = Math.floor((String(dataBase64 || '').length * 3) / 4);
  if (!size) throw err('Data berkas kosong.');
  if (size > 5 * 1024 * 1024) throw err('Ukuran setiap berkas maksimal 5 MB.', 'LIMIT');

  const item = {
    id: 'B-' + (db.seq++), namaFile: fileName, mimeType,
    ukuran: size, driveFileId: '', url: '', sumber: sumber === 'kamera' ? 'kamera' : 'unggah',
    waktu: nowIso()
  };
  c.bukti.push(item);
  c.waktuUpdate = item.waktu;
  return { ...item, total: c.bukti.length };
}

function getDashboard() {
  const stats = { total: db.cases.length, baru: 0, proses: 0, selesai: 0, ditolak: 0, publikasi: 0, bulanIni: 0 };
  const statusMap = {};
  const jenisMap = {};
  const month = today().slice(0, 7);
  const now = new Date();
  const months = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: names[d.getMonth()], count: 0 });
  }

  db.cases.forEach((c) => {
    if (c.status === 'Baru') stats.baru++;
    if (['Diverifikasi', 'Dalam Proses', 'Mediasi'].includes(c.status)) stats.proses++;
    if (c.status === 'Selesai') stats.selesai++;
    if (c.status === 'Ditolak') stats.ditolak++;
    if (c.publikasi === 'YA') stats.publikasi++;
    if (String(c.waktuDaftar).slice(0, 7) === month) stats.bulanIni++;
    statusMap[c.status] = (statusMap[c.status] || 0) + 1;
    jenisMap[c.jenisPerkara] = (jenisMap[c.jenisPerkara] || 0) + 1;
    const mk = String(c.waktuDaftar).slice(0, 7);
    const mo = months.find((x) => x.key === mk);
    if (mo) mo.count++;
  });

  const sorted = [...db.cases].sort((a, b) => String(b.waktuDaftar).localeCompare(String(a.waktuDaftar)));

  return {
    stats,
    statusCounts: STATUS_LIST.filter((s) => statusMap[s]).map((s) => ({ label: s, count: statusMap[s] })),
    jenisCounts: Object.keys(jenisMap).map((k) => ({ label: k, count: jenisMap[k] })).sort((a, b) => b.count - a.count),
    monthly: months,
    recent: sorted.slice(0, 6).map(summary)
  };
}

function updateStatus(payload, token) {
  const admin = auth(token);
  const c = db.cases.find((x) => x.id === payload.id);
  if (!c) throw err('Perkara tidak ditemukan.', 'NOT_FOUND');
  if (!STATUS_LIST.includes(payload.status)) throw err('Status tidak valid.');

  const now = nowIso();
  const old = c.status;
  c.status = payload.status;
  c.statusCatatan = String(payload.catatan || '');
  c.waktuUpdate = now;
  c.riwayat.push({
    id: 'H-' + (db.seq++), statusLama: old, statusBaru: payload.status,
    catatan: payload.catatan || 'Status diperbarui.', oleh: admin.nama, waktu: now
  });
  return summary(c);
}

function updatePublikasi(payload, token) {
  auth(token);
  const c = db.cases.find((x) => x.id === payload.id);
  if (!c) throw err('Perkara tidak ditemukan.', 'NOT_FOUND');
  const pub = String(payload.publikasi).toUpperCase() === 'YA' ? 'YA' : 'TIDAK';
  const ringkasan = String(payload.ringkasan || '').trim();
  if (pub === 'YA' && ringkasan.length < 40) {
    throw err('Ringkasan publikasi minimal 40 karakter agar aman dan informatif.');
  }
  c.publikasi = pub;
  c.ringkasanPublik = ringkasan;
  c.waktuUpdate = nowIso();
  return summary(c);
}

function deletePerkara(payload, token) {
  auth(token);
  const i = db.cases.findIndex((x) => x.id === payload.id);
  if (i === -1) throw err('Perkara tidak ditemukan.', 'NOT_FOUND');
  const nomor = db.cases[i].nomorRegistrasi;
  db.cases.splice(i, 1);
  return { ok: true, nomorRegistrasi: nomor };
}

function saveBranding(payload, token) {
  auth(token);
  const b = payload.branding || payload;
  const limits = {
    brandTitle: 80, brandSubtitle: 120, waNumber: 20, telepon: 40, email: 120,
    alamat: 300, jamOperasional: 120, logoUrl: 500, footerText: 600,
    heroBadge: 100, heroTitle: 140, heroDesc: 500, tentangSingkat: 800
  };
  Object.keys(b).forEach((k) => {
    if (!(k in db.branding)) return;
    let v = String(b[k] ?? '').trim().slice(0, limits[k] || 500);
    if (k === 'waNumber') {
      v = normPhone(v);
      if (!/^62\d{8,14}$/.test(v)) throw err('Nomor WhatsApp harus diawali 62 dan berisi 10–15 digit.');
    }
    if (k === 'brandTitle' && !v) throw err('Nama lembaga wajib diisi.');
    if (k === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw err('Format email lembaga tidak valid.');
    db.branding[k] = v;
  });
  return db.branding;
}

function login(payload) {
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    throw err('Username atau password salah.', 'AUTH');
  }
  const token = crypto.randomBytes(24).toString('hex');
  const exp = Date.now() + TOKEN_TTL;
  const admin = { username: ADMIN_USER, nama: 'Administrator LBH', role: 'admin' };
  db.sessions.set(token, { admin, exp });
  return { token, exp, admin };
}

/* ------------------------------------------------------------------- api */
function handleApi(body) {
  const action = String(body.action || '');
  const payload = body.payload || {};
  const token = body.token || '';

  switch (action) {
    case 'getBootstrap': return getBootstrap();
    case 'getPublikasi': return getBootstrap().publikasi;
    case 'submitPengaduan': return submitPengaduan(payload);
    case 'uploadBukti': return uploadBukti(payload);
    case 'login': return login(payload);
    case 'logout': db.sessions.delete(token); return { ok: true };
    case 'getDashboard': auth(token); return getDashboard();
    case 'listPerkara': auth(token); return [...db.cases]
      .sort((a, b) => String(b.waktuDaftar).localeCompare(String(a.waktuDaftar))).map(summary);
    case 'getPerkara': {
      auth(token);
      const c = db.cases.find((x) => x.id === payload.id);
      if (!c) throw err('Perkara tidak ditemukan.', 'NOT_FOUND');
      return { perkara: c, saksi: c.saksi, bukti: c.bukti, riwayat: c.riwayat };
    }
    case 'updateStatus': return updateStatus(payload, token);
    case 'updatePublikasi': return updatePublikasi(payload, token);
    case 'deletePerkara': return deletePerkara(payload, token);
    case 'saveBranding': return saveBranding(payload, token);
    case 'uploadLogo': {
      auth(token);
      return { url: String(payload.dataBase64 || ''), fileId: 'local' };
    }
    case 'changePassword':
      auth(token);
      return { relogin: true, note: 'Server lokal tidak menyimpan perubahan password.' };
    case 'getBuktiData':
      auth(token);
      throw err('Pratinjau berkas tidak tersedia pada server lokal.', 'NOT_FOUND');
    default:
      throw err('Aksi tidak dikenali: ' + action, 'BAD_REQUEST');
  }
}

/* --------------------------------------------------------------- seeding */
function seed() {
  const samples = [
    {
      nama: 'Siti Rahmawati', nik: '3174014508900001', jenisKelamin: 'Perempuan',
      jenisPerkara: 'Perlindungan Anak & Perempuan', urgensi: 'Tinggi', status: 'Dalam Proses',
      judulPerkara: 'Kekerasan dalam rumah tangga yang belum ditindaklanjuti',
      kabupaten: 'Jakarta Selatan', provinsi: 'DKI Jakarta', publikasi: 'YA',
      ringkasanPublik: 'Pendampingan hukum bagi korban kekerasan dalam rumah tangga yang membutuhkan perlindungan dan pendampingan proses pelaporan.',
      daysAgo: 3
    },
    {
      nama: 'Budi Santoso', nik: '3273011207850002', jenisKelamin: 'Laki-laki',
      jenisPerkara: 'Hubungan Industrial', urgensi: 'Sedang', status: 'Diverifikasi',
      judulPerkara: 'Pemutusan hubungan kerja tanpa pesangon yang layak',
      kabupaten: 'Bandung', provinsi: 'Jawa Barat', publikasi: 'YA',
      ringkasanPublik: 'Pendampingan terkait hak pesangon pekerja yang mengalami pemutusan hubungan kerja sepihak oleh perusahaan.',
      daysAgo: 9
    },
    {
      nama: 'Ahmad Fauzi', nik: '3517012301700003', jenisKelamin: 'Laki-laki',
      jenisPerkara: 'Pertanahan', urgensi: 'Darurat', status: 'Baru',
      judulPerkara: 'Sengketa batas tanah warisan dengan tetangga',
      kabupaten: 'Sidoarjo', provinsi: 'Jawa Timur', publikasi: 'TIDAK',
      ringkasanPublik: '', daysAgo: 1
    },
    {
      nama: 'Maria Kristina', nik: '5371015602920004', jenisKelamin: 'Perempuan',
      jenisPerkara: 'Keluarga', urgensi: 'Rendah', status: 'Selesai',
      judulPerkara: 'Pengurusan hak asuh anak setelah perceraian',
      kabupaten: 'Kupang', provinsi: 'Nusa Tenggara Timur', publikasi: 'YA',
      ringkasanPublik: 'Pendampingan mediasi untuk kesepakatan hak asuh dan nafkah anak yang berkeadilan bagi kedua pihak.',
      daysAgo: 24
    },
    {
      nama: 'Rudi Hartono', nik: '6471010101800005', jenisKelamin: 'Laki-laki',
      jenisPerkara: 'Konsumen', urgensi: 'Sedang', status: 'Mediasi',
      judulPerkara: 'Wanprestasi pengembang perumahan',
      kabupaten: 'Balikpapan', provinsi: 'Kalimantan Timur', publikasi: 'TIDAK',
      ringkasanPublik: '', daysAgo: 15
    },
    {
      nama: 'Nur Aisyah', nik: '7371016503950006', jenisKelamin: 'Perempuan',
      jenisPerkara: 'Pidana', urgensi: 'Tinggi', status: 'Ditolak',
      judulPerkara: 'Laporan dugaan penipuan investasi daring',
      kabupaten: 'Makassar', provinsi: 'Sulawesi Selatan', publikasi: 'TIDAK',
      ringkasanPublik: '', daysAgo: 40
    }
  ];

  samples.forEach((s, i) => {
    const d = new Date(Date.now() - s.daysAgo * 86400000);
    const iso = new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 19);
    const id = 'P-DEMO' + String(i + 1).padStart(3, '0');
    const nomor = 'LBH-' + iso.slice(0, 10).replace(/-/g, '') + '-' + String(i + 1).padStart(3, '0');
    db.cases.push({
      id, nomorRegistrasi: nomor, waktuDaftar: iso,
      nama: s.nama, nik: s.nik, tempatLahir: s.kabupaten,
      tanggalLahir: '1985-04-12', jenisKelamin: s.jenisKelamin,
      agama: 'Islam', statusPerkawinan: 'Menikah', pendidikan: 'SMA/SMK',
      pekerjaan: 'Karyawan Swasta',
      alamat: 'Jl. Melati No. 24', rt: '004', rw: '007',
      desa: 'Sukamaju', kecamatan: 'Setiabudi',
      kabupaten: s.kabupaten, provinsi: s.provinsi,
      noHP: '62812345678' + String(10 + i), email: 'contoh' + (i + 1) + '@email.com',
      jenisPerkara: s.jenisPerkara, judulPerkara: s.judulPerkara,
      kronologi: 'Pengadu menjelaskan bahwa peristiwa terjadi pada awal tahun dan telah berulang kali diupayakan penyelesaian secara kekeluargaan, namun tidak menemukan titik temu. Pengadu membutuhkan pendampingan hukum untuk memahami hak dan langkah yang dapat ditempuh.',
      tanggalKejadian: '2026-0' + ((i % 8) + 1) + '-14',
      lokasiKejadian: s.kabupaten + ', ' + s.provinsi,
      pihakLawan: 'Pihak terkait dalam perkara', nilaiKerugian: String(5000000 * (i + 1)),
      sudahDilaporkan: i % 2 === 0 ? 'TIDAK' : 'YA',
      instansi: i % 2 === 0 ? '' : 'Polres setempat',
      noLaporan: i % 2 === 0 ? '' : 'LP/2026/0' + (i + 1),
      punyaKuasaHukum: 'TIDAK', urgensi: s.urgensi,
      harapan: 'Pengadu berharap memperoleh pendampingan hukum, pemahaman atas hak-haknya, serta bantuan penyelesaian perkara secara adil.',
      tandaTangan: '', status: s.status, statusCatatan: '',
      publikasi: s.publikasi, ringkasanPublik: s.ringkasanPublik,
      waktuUpdate: iso,
      saksi: i < 2 ? [{ id: 'S-' + i, nama: 'Saksi ' + (i + 1), nik: '', hubungan: 'Tetangga', alamat: 'Alamat saksi', noHP: '08120000000' + i, keterangan: 'Menyaksikan langsung kejadian.' }] : [],
      bukti: i < 3 ? [{ id: 'B-' + i, namaFile: 'bukti_pendukung_' + (i + 1) + '.pdf', mimeType: 'application/pdf', ukuran: 245000, driveFileId: '', url: '', sumber: 'unggah', waktu: iso }] : [],
      riwayat: [{ id: 'H-' + i, statusLama: '', statusBaru: 'Baru', catatan: 'Pengaduan diterima melalui formulir online.', oleh: 'Pengadu', waktu: iso }]
    });
  });
}

/* ---------------------------------------------------------------- server */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

seed();

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 40 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Format permintaan tidak valid.', code: 'BAD_REQUEST' })); }
      let out;
      try {
        out = { ok: true, data: handleApi(body) };
      } catch (e) {
        if (e.code !== 'AUTH' && e.code !== 'VALIDATION' && e.code !== 'NOT_FOUND' && e.code !== 'LIMIT' && e.code !== 'BAD_REQUEST') {
          console.error(e);
        }
        out = { ok: false, error: e.message || 'Terjadi kesalahan.', code: e.code || 'SERVER' };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out));
    });
    return;
  }

  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 — Berkas tidak ditemukan'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  LBH ASYSYUJA — server pengembangan');
  console.log('  → http://localhost:' + PORT);
  console.log('  Login admin: ' + ADMIN_USER + ' / ' + ADMIN_PASS);
  console.log('  (Data demo dimuat di memori; restart = reset.)');
  console.log('');
});
