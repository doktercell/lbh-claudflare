# LBH ASYSYUJA

Sistem Pengaduan & Manajemen Perkara untuk Lembaga Bantuan Hukum.

Tersedia **dua versi deployment** yang memakai database yang sama:

| Versi | Folder | Deploy | Keterangan |
|---|---|---|---|
| **Cloudflare** (disarankan) | `cloudflare/` | Cloudflare Pages + Function/Worker | CDN cepat, domain sendiri, tanpa batasan iframe |
| **GAS-hosted** | root (`Code.gs` + `index.html`) | Semua di Google Apps Script | Paling cepat mulai |

---

## Mulai Cepat — Versi Cloudflare

```bash
# 1. Backend: tempel cloudflare/backend/Code.gs ke Apps Script
#    → jalankan setupDatabase() → setApiKey() → Deploy Web App

# 2. Frontend: deploy folder cloudflare/pages
#    → set GAS_URL + API_KEY di Cloudflare

# 3. Preview lokal
node server.js                     # mock backend  :3000
node cloudflare/dev/server.js      # frontend       :4100
```

Panduan lengkap: **[`cloudflare/README.md`](cloudflare/README.md)**

---

## Mulai Cepat — Versi GAS-hosted

1. Tempel `Code.gs` dan `index.html` (nama file: `index`) ke project Apps Script.
2. Jalankan `setupDatabase()`.
3. Deploy sebagai Web app (Execute as: Me, Access: Anyone).

Panduan lengkap: **[`PANDUAN.md`](PANDUAN.md)**

---

## Fitur

**Publik**
- Form pengaduan A–E: data KTP, perkara & kronologi, bukti (drag & drop + kamera), saksi dinamis, harapan & pernyataan
- Validasi per kolom, stepper + progress bar
- Notifikasi toast, nomor registrasi otomatis
- Tombol WhatsApp dengan ringkasan pengaduan
- Halaman publikasi perkara (tanpa data pribadi)

**Admin**
- Login aman (SHA-256 + salt, sesi 6 jam, rate limit)
- Dashboard: statistik, grafik 6 bulan, distribusi status & jenis
- Kelola perkara: pencarian, filter, paginasi, detail 6 tab
- Ubah status + riwayat, publikasi, hapus perkara
- Cetak BAP (A4, kop lembaga, tanda tangan)
- Ekspor CSV
- Pengaturan branding live (judul, subjudul, WA, logo, footer)
- Ganti password

---

## Stack

- **Frontend**: HTML, Tailwind CSS (CDN), JavaScript vanilla, Font Awesome
- **Backend**: Google Apps Script
- **Database**: Google Sheets
- **Penyimpanan**: Google Drive (privat)
- **Edge**: Cloudflare Pages + Functions / Worker

---

## Struktur

```
.
├── Code.gs                     # Backend versi GAS-hosted
├── index.html                  # Frontend versi GAS-hosted
├── appsscript.json
├── server.js                   # Mock backend untuk pengembangan
├── PANDUAN.md                  # Panduan versi GAS-hosted
└── cloudflare/
    ├── README.md               # Panduan versi Cloudflare
    ├── backend/                # Code.gs API-only + manifest
    ├── pages/                  # Frontend statis + Pages Function
    ├── worker/                 # Alternatif: proxy Worker terpisah
    └── dev/                    # Preview lokal
```
