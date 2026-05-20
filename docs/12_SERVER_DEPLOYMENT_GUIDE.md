# 🚀 Panduan Lengkap Deploy Aplikasi ke Laptop Server (Lokal)

Dokumen ini berisi langkah-demi-langkah (step-by-step) super komprehensif untuk memindahkan aplikasi CRM dari Laptop Development ke **Laptop Server**, dan menjalankannya secara terus-menerus.

Karena Anda sudah meremote Laptop Server dan keduanya memiliki **Git Bash** serta terhubung ke **GitHub**, kita akan menggunakan Git sebagai metode transfer yang paling aman dan efisien.

---

## TAHAP 1: Di Laptop Development (Laptop Saat Ini)

Tujuan tahap ini adalah memastikan semua kode terbaru yang sudah berjalan dengan baik di laptop ini diunggah (push) ke GitHub.

1. Buka terminal atau Git Bash di folder project `wa-ai-cs` di laptop development ini.
2. Pastikan file `.gitignore` sudah mengecualikan folder/file yang tidak perlu diunggah (seperti `node_modules/`, `data/`, `logs/`, `tmp/`, `.env`, dll.).
3. Simpan perubahan ke Git:
   ```bash
   git add .
   git commit -m "Siap deploy ke laptop server"
   ```
4. Push ke GitHub:
   ```bash
   git push origin main
   ```
   *(Catatan: Ganti `main` dengan nama branch Anda jika menggunakan nama branch yang berbeda, misalnya `master`).*

---

## TAHAP 2: Di Laptop Server (Via Remote)

Sekarang, pindah ke layar Laptop Server yang sedang Anda remote.

### Langkah 1: Persiapan Awal (Prasyarat)
Pastikan hal-hal berikut sudah terinstall di Laptop Server:
1. **Node.js**: Buka Git Bash, ketik `node -v` dan `npm -v`. Pastikan Node.js terdeteksi (versi >= 20 disarankan sesuai `package.json`). Jika belum ada, download dan install dari [nodejs.org](https://nodejs.org/).
2. **Git**: Sudah ada (Git Bash).

### Langkah 2: Clone/Pull Kode dari GitHub
1. Buka **Git Bash** di lokasi tempat Anda ingin meletakkan folder project (misalnya di `C:\Users\Username\Documents\`).
2. Clone repository Anda:
   ```bash
   git clone <URL_GITHUB_REPO_ANDA> wa-ai-cs
   ```
   *(Contoh: `git clone https://github.com/username/wa-ai-cs.git wa-ai-cs`)*
3. Masuk ke dalam folder project:
   ```bash
   cd wa-ai-cs
   ```

> [!NOTE]
> Jika Anda sudah pernah melakukan `git clone` sebelumnya di laptop server, Anda hanya perlu menjalankan `git pull origin main` dari dalam folder `wa-ai-cs`.

### Langkah 3: Install Dependencies
Aplikasi ini membutuhkan beberapa library pihak ketiga. Di Git Bash (masih di dalam folder `wa-ai-cs`), jalankan:
```bash
npm install
```
Tunggu hingga proses instalasi selesai. Proses ini akan membuat folder `node_modules` di dalam project.

### Langkah 4: Konfigurasi Environment Variables (`.env`)
Karena file `.env` tidak ikut dipush ke GitHub (sangat disarankan demi keamanan), Anda harus membuatnya di Laptop Server.

1. Di dalam folder `wa-ai-cs`, copy file `.env.example` menjadi `.env`.
   ```bash
   cp .env.example .env
   ```
2. Buka file `.env` tersebut menggunakan teks editor (misalnya Notepad atau VS Code).
3. Isi nilai variabelnya, pastikan Anda memasukkan Google Gemini API Key Anda.
   ```env
   GEMINI_API_KEY=API_KEY_ANDA_DISINI
   ```
4. Jika ada konfigurasi port (misal `PORT=3000`), pastikan port tersebut tidak sedang dipakai oleh aplikasi lain di Laptop Server.

### Langkah 5: (Opsional namun Penting) Install PM2
Karena ini adalah "Laptop Server" yang diharapkan menyala terus-menerus dan melayani trafik, sangat disarankan untuk menjalankan aplikasi menggunakan **PM2** (Process Manager). PM2 memastikan aplikasi Anda akan restart otomatis jika terjadi error atau *crash*.

Di Git Bash, jalankan perintah ini (hanya perlu dilakukan sekali):
```bash
npm install -g pm2
```

---

## TAHAP 3: Menjalankan Aplikasi di Laptop Server

### Opsi A: Menjalankan Tanpa PM2 (Untuk Testing Awal)
Sangat disarankan untuk melakukan *dry-run* terlebih dahulu tanpa PM2 untuk melihat apakah ada error di log.
1. Di Git Bash, jalankan:
   ```bash
   npm start
   ```
2. Perhatikan log di terminal. Jika ada QR Code yang muncul (dari `whatsapp-web.js` atau `wa-js`), scan QR Code tersebut menggunakan HP WhatsApp yang akan dijadikan admin/bot.
3. Jika tulisan "Ready" atau server berhasil berjalan, matikan dulu dengan menekan `Ctrl + C`.

### Opsi B: Menjalankan Menggunakan PM2 (Untuk Produksi/Jangka Panjang)
Setelah Opsi A berhasil, sekarang kita jadikan proses latar belakang.

1. Jalankan aplikasi dengan PM2:
   ```bash
   pm2 start index.js --name "wa-crm"
   ```
2. (Opsional) Untuk menyimpan konfigurasi PM2 agar otomatis jalan ketika laptop di-restart, ketik:
   ```bash
   pm2 save
   ```
   *(Pada Windows, membuat PM2 otomatis jalan saat boot terkadang memerlukan library tambahan seperti `pm2-windows-startup`, namun Anda bisa melewatinya dulu jika laptop server jarang direstart).*

**Perintah PM2 yang berguna:**
- `pm2 logs wa-crm` : Untuk melihat log (misalnya saat butuh scan QR Code baru).
- `pm2 stop wa-crm` : Untuk menghentikan aplikasi.
- `pm2 restart wa-crm` : Untuk merestart aplikasi.

---

## TAHAP 4: Meng-online-kan Laptop Server (Public Access)

Jika Anda ingin aplikasi ini bisa diakses secara publik (dari HP atau internet luar tanpa menggunakan WiFi yang sama), Anda perlu mengatur Cloudflare Tunnel di Laptop Server.

Panduan detil tentang ini sudah saya lihat ada di dalam file `docs/11_PUBLIC_ACCESS_SETUP.md`. Anda hanya perlu mengikuti panduan di dokumen tersebut *dari dalam Laptop Server*.

> [!IMPORTANT]
> - Pastikan koneksi internet di Laptop Server stabil.
> - Hindari menggunakan mode "Sleep" pada Laptop Server agar koneksi Cloudflare Tunnel dan WhatsApp Web tidak terputus. Atur Power Plan di Windows menjadi "High Performance" dan ubah "Put the computer to sleep" menjadi **Never**.

---
## Ringkasan Alur Kerja
`Laptop Dev (Push ke GitHub)` ➡️ `Laptop Server (Pull dari GitHub)` ➡️ `npm install` ➡️ `setup .env` ➡️ `pm2 start index.js` ➡️ `cloudflared (opsional)`.
