# LBH ASYSYUJA — Versi Cloudflare (Pages + Worker)

Frontend **statis** (Cloudflare Pages) + **backend API** (Google Apps Script),
dihubungkan oleh **Pages Function** atau **Worker** sebagai proxy yang aman.

```
┌──────────────────────┐   POST    ┌──────────────────────┐   POST    ┌────────────────────┐
│  Cloudflare Pages    │   /api    │  Pages Function      │           │  Google Apps Script │
│  public/index.html   │──────────▶│  functions/api.js    │──────────▶│  backend/Code.gs    │
│  HTML + JS + Tailwind│           │  + API_KEY (secret)  │           │  Sheets + Drive     │
└──────────────────────┘           └──────────────────────┘           └────────────────────┘
        CDN global                    satu domain, tanpa CORS              database & berkas
```

**Keunggulan dibanding versi GAS-hosted:**
- Halaman dimuat dari CDN (cepat, tanpa iframe sandbox)
- Kamera, cetak BAP, dan unduh CSV berfungsi normal
- Domain sendiri, URL bersih
- API key backend tidak pernah terekspos ke browser
- Halaman publik tetap bisa diakses saat Apps Script lambat (konten awal instan)

---

## Struktur File

```
cloudflare/
├── backend/
│   ├── Code.gs              ← Backend API (tempel ke Apps Script)
│   └── appsscript.json      ← Manifest Apps Script
├── pages/
│   ├── public/              ← YANG DI-DEPLOY KE PAGES
│   │   ├── index.html       ← Frontend statis
│   │   ├── config.js        ← Konfigurasi apiBase
│   │   ├── _headers         ← Header keamanan
│   │   ├── _redirects       ← Catatan routing
│   │   └── _routes.json     ← Routing Pages Function
│   ├── functions/
│   │   └── api.js           ← Pages Function: proxy /api → Apps Script
│   ├── package.json         ← npm scripts + wrangler
│   └── wrangler.toml        ← Konfigurasi build Pages
├── worker/                  ← ALTERNATIF: proxy Worker terpisah
│   ├── src/index.js
│   ├── wrangler.toml
│   └── package.json
├── dev/
│   └── server.js            ← Preview lokal (memakai Worker asli)
├── .dev.vars.example
└── .gitignore
```

Pilih **salah satu**:
- **Opsi A (disarankan)** — Pages + Pages Function → satu deploy, satu domain
- **Opsi B** — Pages statis + Worker terpisah → API di subdomain sendiri

---

# LANGKAH 1 — Deploy Backend Apps Script

1. Buka [script.google.com](https://script.google.com) → **New project**.
2. Ganti nama project: `LBH ASYSYUJA API`.
3. Hapus isi `Code.gs` bawaan, tempel **seluruh isi** `cloudflare/backend/Code.gs`.
4. **Project Settings** → centang **Show "appsscript.json"** → tempel isi `cloudflare/backend/appsscript.json`.
5. Pilih fungsi **`setupDatabase`** → **Run** → izinkan semua permission.
   Execution log menampilkan URL Spreadsheet dan folder Drive.
6. Pilih fungsi **`setApiKey`** → **Run** → **salin API key** dari log:
   ```
   lbh_3f8a...c92d
   ```
7. **Deploy → New deployment → Web app**
   - Description: `API v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
8. Salin **Web app URL** (`https://script.google.com/macros/s/AKfy.../exec`).

### Uji backend

Buka URL web app di browser — harus tampil JSON:

```json
{"ok":true,"data":{"service":"LBH ASYSYUJA API","status":"ok","apiKeyRequired":true}}
```

> Jika muncul halaman login Google, berarti "Who has access" belum **Anyone**.

---

# LANGKAH 2 — Deploy Frontend (Opsi A: Pages + Function)

### 2a. Lewat Dashboard Cloudflare

1. **Cloudflare Dashboard** → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pilih repository project ini.
3. Konfigurasi build:
   - **Framework preset**: `None`
   - **Build command**: *(kosongkan)*
   - **Build output directory**: `cloudflare/pages/public`
4. **Save and Deploy**.
5. Buka **Settings → Environment variables**, tambahkan:

   | Nama | Nilai | Jenis |
   |---|---|---|
   | `GAS_URL` | `https://script.google.com/macros/s/AKfy.../exec` | Secret |
   | `API_KEY` | `lbh_3f8a...c92d` | Secret |

6. **Deployments → Retry deployment** (agar environment variable terbaca).
7. Buka URL `https://nama-project.pages.dev`.

### 2b. Lewat Wrangler (CLI)

```bash
cd cloudflare/pages
npx wrangler pages deploy public --project-name lbh-asysyuja
npx wrangler pages secret put GAS_URL --project-name lbh-asysyuja
npx wrangler pages secret put API_KEY --project-name lbh-asysyuja
```

### Verifikasi

1. Buka `https://nama-project.pages.dev/api` → harus muncul:

   ```json
   {"ok":true,"data":{"service":"LBH ASYSYUJA API (Pages Function)","backendConfigured":true,"apiKeyConfigured":true}}
   ```

2. Buka halaman utama → **F12 → Console**:

   ```
    LBH ASYSYUJA  v2.0.0  Statis → /api
   ```

3. Cek konten termuat: statistik di hero dan kartu publikasi terisi.

---

# LANGKAH 3 — Worker Terpisah (Opsi B, opsional)

Gunakan bila ingin API di subdomain seperti `api.domain.com`.

```bash
cd cloudflare/worker
npm install
npx wrangler login

npx wrangler secret put GAS_URL      # https://script.google.com/.../exec
npx wrangler secret put API_KEY      # lbh_...

# opsional: batasi origin di wrangler.toml
# [vars]
# ALLOWED_ORIGIN = "https://lbh.pages.dev"

npx wrangler deploy
```

Lalu ubah `cloudflare/pages/public/config.js`:

```js
window.LBH_CONFIG = {
  apiBase: 'https://lbh-asysyuja-api.<subdomain>.workers.dev/api'
};
```

Deploy ulang Pages. **Jangan** memakai Pages Function dan Worker sekaligus pada path `/api` yang sama.

---

# LANGKAH 4 — Preview Lokal

Dua terminal:

```bash
# Terminal 1 — mock backend (data demo, tanpa Google)
node server.js

# Terminal 2 — frontend + Worker asli
node cloudflare/dev/server.js
```

Buka **http://localhost:4100** — perilakunya identik dengan produksi,
termasuk proxy, validasi action, dan batas ukuran request.

Login admin: **admin / Admin#LBH2026**

---

## Environment Variables

| Nama | Wajib | Keterangan |
|---|---|---|
| `GAS_URL` | ✅ | URL Web App Apps Script, diakhiri `/exec` |
| `API_KEY` | disarankan | Kunci dari `setApiKey()` di `Code.gs` |
| `ALLOWED_ORIGIN` | opsional | Batasi origin (khusus Worker terpisah) |

> `API_KEY` **hanya** disimpan di Cloudflare (Secret). Jangan pernah menaruhnya di `config.js` atau `index.html`.

---

## Cara Kerja Keamanan

1. Browser → `POST /api` dengan `{ action, payload, token }`.
2. Function/Worker memvalidasi **action** terhadap daftar putih.
3. Function menambahkan `API_KEY` lalu meneruskan ke Apps Script.
4. `Code.gs` memverifikasi API key (perbandingan waktu-konstan).
5. Sesi admin diverifikasi lewat token 6 jam di `CacheService`.
6. Bukti tetap privat di Drive; hanya diambil lewat `getBuktiData` (butuh token admin).

Worker terpisah juga menerapkan rate limit 40 permintaan/menit per IP
dan header CORS yang dapat dibatasi ke satu origin.

---

## Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| Halaman tampil tapi data kosong | Buka `/api`. Jika `backendConfigured:false`, `GAS_URL` belum diset → set ulang lalu **Retry deployment**. |
| `Kunci API tidak valid` | `API_KEY` di Cloudflare ≠ hasil `setApiKey()`. Jalankan `setApiKey()` lagi (menampilkan nilai yang ada), lalu samakan. |
| `Respons backend tidak valid` | `GAS_URL` salah atau deployment belum versi baru. Pastikan berakhiran `/exec` dan akses **Anyone**. |
| `Aksi tidak diizinkan` | Nama action tidak ada di daftar putih `functions/api.js` / Worker. |
| 404 saat membuka `/api` | Pastikan `_routes.json` ikut ter-deploy di `public/`. |
| Upload gagal | Ukuran request > 12 MB. Maks. 5 MB per berkas, 8 berkas. |
| Cetak BAP kosong | Izinkan dialog cetak; gunakan Ctrl+P sebagai alternatif. |
| Data lama muncul | Lakukan hard refresh (Ctrl+Shift+R). `_headers` sudah menonaktifkan cache HTML. |
| Halaman publik lambat | Normal bila backend lambat — konten hero tampil instan, data menyusul. |

---

## Migrasi dari Versi GAS-hosted

1. Data di Spreadsheet **tetap sama** — tidak perlu migrasi.
2. Ganti `Code.gs` dengan `cloudflare/backend/Code.gs`.
3. Hapus file HTML `index` dari project Apps Script (tidak dipakai lagi).
4. Deploy ulang web app sebagai **New version**.
5. Deploy frontend ke Cloudflare Pages.
6. Ganti bookmark ke domain Pages.

---

## Perintah Ringkas

```bash
# Preview lokal
node server.js                     # backend mock  :3000
node cloudflare/dev/server.js      # frontend       :4100

# Deploy Pages (CLI)
cd cloudflare/pages
npx wrangler pages deploy public --project-name lbh-asysyuja

# Deploy Worker (opsional)
cd cloudflare/worker
npm install && npx wrangler deploy
```
