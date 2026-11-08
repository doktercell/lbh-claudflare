# LBH ASYSYUJA — Sistem Pengaduan & Manajemen Perkara

> **Ada dua versi deployment:**
>
> | Versi | Lokasi | Cocok untuk |
> |---|---|---|
> | **GAS-hosted** | `Code.gs` + `index.html` (root) | Cepat mulai, semua dalam Apps Script |
> | **Cloudflare** | `cloudflare/` | Produksi: CDN cepat, domain sendiri, tanpa batasan iframe |
>
> Untuk versi Cloudflare (Pages + Worker), lihat **[`cloudflare/README.md`](cloudflare/README.md)**.
>
> **Perbaikan penting (v1.1.0):** Error *"Tag meta yang Anda tentukan tidak diperbolehkan dalam konteks ini"* sudah diperbaiki. Penyebabnya: `HtmlService.addMetaTag('theme-color', ...)` tidak diizinkan Apps Script dan membuat `doGet()` gagal total. Tag tersebut kini ditulis langsung di dalam `<head>` HTML.
>
> **Yang harus Anda lakukan:** salin ulang `Code.gs` terbaru → **Deploy → Manage deployments → Edit → Version: New version → Deploy** → buka ulang URL web app. Lihat [Catatan Perbaikan v1.1.0](#catatan-perbaikan-v110).

Aplikasi full-stack untuk lembaga bantuan hukum (LBH):

- **Backend**: Google Apps Script + Google Sheets (database) + Google Drive (penyimpanan bukti)
- **Frontend**: Single-page `index.html` — HTML, Tailwind CSS, JavaScript vanilla
- **Fitur publik**: form pengaduan section A–E, upload bukti (drag & drop + kamera), saksi dinamis, notifikasi toast, submit via WhatsApp, publikasi perkara
- **Fitur admin**: login, dashboard, kelola perkara, ubah status, publikasi, cetak BAP, pengaturan branding, ganti password

---

## Struktur File

| File | Fungsi |
|---|---|
| `Code.gs` | Backend Apps Script — API, database Sheets, upload Drive, autentikasi |
| `index.html` | Frontend single-page (form pengaduan + dashboard admin) |
| `appsscript.json` | Manifest project Apps Script (zona waktu, scope, konfigurasi web app) |
| `server.js` | Server pengembangan lokal (Node) untuk menguji UI **tanpa** deploy |
| `cloudflare/` | **Versi Cloudflare Pages + Worker** — lihat [`cloudflare/README.md`](cloudflare/README.md) |
| `PANDUAN.md` | Dokumen ini |

### Dua Versi Deployment

| Versi | File | Cara Deploy | Kelebihan |
|---|---|---|---|
| **GAS-hosted** | `Code.gs` + `index.html` | Semua di dalam Apps Script | Paling cepat mulai, tanpa akun tambahan |
| **Cloudflare** | `cloudflare/backend/Code.gs` + `cloudflare/pages/public/index.html` + Worker/Function | Pages + Cloudflare proxy | CDN cepat, domain sendiri, kamera & cetak normal |

Keduanya memakai **struktur Spreadsheet yang sama**, jadi bisa berpindah tanpa migrasi data.

---

## A. Menjalankan di Komputer (Preview Lokal)

```bash
node server.js
```

Buka **http://localhost:3000**

- Data demo otomatis dimuat (di memori, hilang saat server dihentikan).
- Login admin: **admin / Admin#LBH2026**
- Upload berkas, ubah status, publikasi, dan ekspor CSV dapat diuji penuh.
- Catatan: server lokal tidak mengirim berkas ke Drive (hanya mencatat metadata) dan tidak menyimpan password baru.

---

## B. Deploy ke Google Apps Script (Produksi)

### 1. Buat Database & Folder

1. Buka [script.google.com](https://script.google.com) → **New project**.
2. Ganti nama project, misal `LBH ASYSYUJA - Backend`.
3. Hapus isi `Code.gs` bawaan, tempel seluruh isi file **`Code.gs`** dari repo ini.
4. Klik **+** → **HTML** → beri nama `index` → hapus isinya, tempel seluruh isi file **`index.html`**.
5. (Opsional tapi disarankan) Aktifkan manifest: Project Settings → centang **Show "appsscript.json"** → ganti isinya dengan file **`appsscript.json`** dari repo ini.
6. Di editor, pilih fungsi **`setupDatabase`** → klik **Run**.
   - Izinkan semua permission yang diminta (Sheets + Drive).
   - Cek **Execution log**: akan muncul URL Spreadsheet, URL folder Drive, dan kredensial admin default.
7. Buka Spreadsheet yang dibuat — terdapat sheet: `Pengaturan`, `Perkara`, `Saksi`, `Bukti`, `Admin`, `RiwayatStatus`, `LogAktivitas`.
8. Di folder Drive `LBH ASYSYUJA — Berkas Pengaduan`, berkas bukti tersimpan privat per-perkara.

### 2. Deploy Web App

1. **Deploy → New deployment → Web app**.
2. Isi:
   - **Description**: versi awal
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
3. **Deploy** → salin **Web app URL**.
4. Buka URL tersebut di browser — aplikasi siap dipakai.

> Setiap kali `Code.gs` atau `index.html` diubah, lakukan **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy** agar perubahan aktif.

### 3. Ganti Password Admin

1. Buka web app → klik ikon **perisai/orang** di kanan atas → login dengan `admin / Admin#LBH2026`.
2. Menu **Keamanan** → **Ganti Password**.
3. Ganti password akan otomatis mengakhiri semua sesi login lain.

### 4. Sesuaikan Branding

Menu **Branding Lembaga** di dashboard admin:

- Nama & subjudul lembaga
- Nomor WhatsApp tujuan (format `62xxx` — dipakai di semua tombol WA)
- Telepon, email, alamat, jam operasional
- Logo (unggah langsung, tersimpan di Drive, otomatis dipakai di header/footer/BAP)
- Teks hero, badge, footer

Semua tersimpan di sheet `Pengaturan` dan langsung tampil di halaman publik.

---

## Alur Data Pengaduan

```
Pengadu isi form (A–E)
        │
        ▼
submitPengaduan ──► sheet Perkara + Saksi + RiwayatStatus
        │              (nomor registrasi otomatis: LBH-YYYYMMDD-001)
        ▼
uploadBukti (berulang per berkas) ──► folder Drive per-perkara + sheet Bukti
        │
        ▼
Modal sukses: nomor registrasi + tombol WhatsApp (ringkasan terisi otomatis)
        │
        ▼
Admin: verifikasi → Diverifikasi → Dalam Proses → Mediasi → Selesai / Ditolak
        │
        ▼
(Opsional) Publikasi ringkasan tanpa identitas → tampil di halaman publik
```

---

## Form Pengaduan (Section A–E)

| Section | Isi | Validasi utama |
|---|---|---|
| **A — Data Pengadu** | Nama, NIK, TTL, JK, agama, status kawin, pendidikan, pekerjaan, alamat KTP, RT/RW, desa→provinsi, HP, email | NIK 16 digit, format `08xx`/`62xx`, email valid |
| **B — Perkara & Kronologi** | Jenis perkara, judul, tanggal & lokasi kejadian, pihak lawan, nilai kerugian, urgensi, riwayat pelaporan, kronologi | Kronologi min. 50 karakter; jika "sudah dilaporkan" → instansi wajib |
| **C — Bukti** | Drag & drop / pilih berkas / **kamera** | JPG, PNG, WEBP, HEIC, PDF, DOC, DOCX; maks. 5 MB/berkas, 8 berkas, 20 MB total |
| **D — Saksi** | Dinamis, tombol tambah/hapus | Maks. 5 saksi; NIK saksi 16 digit bila diisi |
| **E — Harapan & Pernyataan** | Harapan klien, tanda tangan (canvas), 2 checkbox pernyataan | Harapan min. 10 karakter; kedua pernyataan wajib |

Progress bar & stepper menuntun pengisian; error ditampilkan per kolom dengan toast.

---

## Keamanan

- Password admin: hash **SHA-256 + salt** (tidak pernah tersimpan plaintext), minimal 8 karakter huruf+angka.
- Sesi admin: token acak via `CacheService`, berlaku **6 jam**, dibatalkan massal saat ganti password.
- Rate limit login: 5 percobaan gagal → terkunci 15 menit per username.
- Berkas bukti **privat** di Drive (akses hanya akun pemilik deploy); logo disetel "anyone with link - viewer" agar bisa tampil.
- Perlindungan formula injection (`=`, `+`, `-`, `@`) pada semua penulisan ke Sheets.
- Semua aksi admin tercatat di sheet `LogAktivitas`.
- Data publikasi hanya ringkasan + inisial — identitas pengadu tidak pernah tampil publik.

---

## API (untuk integrasi lanjutan)

Semua lewat satu endpoint `apiRequest`:

```js
// Contoh: daftar publikasi (POST JSON ke URL web app)
{ "action": "getPublikasi", "payload": { "limit": 6 } }

// Contoh: aksi admin (butuh token dari login)
{ "action": "listPerkara", "token": "<token>" }
```

| Action | Auth | Keterangan |
|---|---|---|
| `getBootstrap` | — | Branding + statistik + publikasi |
| `submitPengaduan` | — | Simpan pengaduan, kembalikan nomor registrasi + token upload |
| `uploadBukti` | upload token | Unggah satu berkas bukti |
| `login` / `logout` | — | Sesi admin |
| `getDashboard` / `listPerkara` / `getPerkara` | admin | Data dashboard & perkara |
| `updateStatus` / `updatePublikasi` / `deletePerkara` | admin | Kelola perkara |
| `saveBranding` / `uploadLogo` / `changePassword` | admin | Pengaturan |
| `getBuktiData` | admin | Unduh isi berkas (base64) |

---

## Catatan Perbaikan v1.1.0

Error **"Tag meta yang Anda tentukan tidak diperbolehkan dalam konteks ini"** terjadi karena `HtmlService.addMetaTag()` hanya mengizinkan tag `viewport`. Tag `theme-color` menyebabkan `doGet()` melempar error sehingga seluruh halaman gagal dimuat dan jatuh ke halaman fallback.

Perubahan pada versi ini:

| Perubahan | File |
|---|---|
| `addMetaTag('theme-color', ...)` dihapus; tag ditulis langsung di `<head>` HTML | `Code.gs`, `index.html` |
| `doGet` dibuat defensif — kegagalan branding tidak menggagalkan halaman | `Code.gs` |
| `resolveHtmlFile_()` mencoba beberapa nama file (`index`, `index.html`, dll.) | `Code.gs` |
| Fungsi baru `diagnose()` dan `repairSetup()` | `Code.gs` |
| Kamera memakai fallback native (`capture`) di dalam iframe Apps Script | `index.html` |
| Cetak BAP memakai jendela baru di mode Apps Script | `index.html` |
| Pratinjau bukti memakai URL Drive langsung di mode Apps Script | `index.html` |
| Ekspor CSV punya fallback bila unduhan diblokir sandbox | `index.html` |
| Penanda versi `window.LBH.version` di Console | `index.html` |

**Setelah menyalin ulang `Code.gs`, Anda WAJIB membuat deployment versi baru**, jika tidak browser tetap memuat versi lama.

---

## Troubleshooting

| Masalah | Solusi |
|---|---|
| **"Tag meta yang Anda tentukan tidak diperbolehkan dalam konteks ini"** | Inilah penyebab halaman tidak terbuka. `HtmlService.addMetaTag()` **hanya mengizinkan `viewport`**; tag `theme-color` ditolak dan membuat `doGet` gagal total. **Sudah diperbaiki** — `theme-color` kini ditulis langsung di `<head>` HTML. Salin ulang `Code.gs` terbaru lalu **Deploy → New version**. |
| Halaman blank / error saat dibuka | Jalankan fungsi **`diagnose()`** dari editor Apps Script, lihat Execution log. |
| "File HTML tidak ditemukan" | File HTML harus bernama **`index`** (tanpa `.html`). Jika Anda menamainya `index.html`, nama internalnya menjadi `index.html.html`. Kode sudah mencoba beberapa variasi, tetapi penamaan `index` tetap disarankan. |
| Login selalu gagal | Jalankan **`repairSetup()`** dari editor; cek sheet `Admin` berisi 1 baris admin. |
| Upload gagal "Sesi unggah berakhir" | Token upload berlaku 2 jam setelah submit; pengadu harus mengirim ulang form. |
| Perubahan kode tidak muncul | **Deploy → Manage deployments → Edit → Version: New version → Deploy**. |
| Kamera tidak terbuka | Di dalam iframe Apps Script, `getUserMedia` dibatasi browser. Aplikasi otomatis memakai kamera bawaan perangkat (input `capture`). |
| Cetak BAP kosong | Di Apps Script, BAP dibuka di jendela baru lalu dialog cetak dipanggil. Jika pop-up diblokir, izinkan pop-up untuk situs `script.google.com`. |

### Cara Cepat Memastikan Versi Terbaru Aktif

Buka web app, tekan **F12 → Console**. Akan tampil:

```
 LBH ASYSYUJA  v1.1.0  Apps Script
```

Jika versi berbeda atau tidak muncul, berarti deployment masih memakai versi lama.

### Fungsi Diagnostik

Jalankan dari editor Apps Script (pilih fungsi → Run → lihat Execution log):

- **`diagnose()`** — memeriksa file HTML, Spreadsheet, jumlah kolom sheet, folder Drive, akun admin, dan URL web app.
- **`repairSetup()`** — membuat/melengkapi sheet, branding, admin, dan folder Drive bila ada yang hilang. Aman dijalankan berulang.


