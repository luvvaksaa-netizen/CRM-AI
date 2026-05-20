# 🚀 Panduan Setup Akses Publik (Cloudflare Tunnel)

Dokumen ini menjelaskan langkah-demi-langkah cara meng-online-kan server lokal CRM Anda (di PC Windows) ke domain publik `crm.datasdm.com` agar mampu menangani trafik hingga 1000 pelanggan/hari secara stabil, tanpa perlu menyewa VPS tambahan, dan 100% gratis.

Solusi yang kita gunakan adalah **Cloudflare Tunnel (cloudflared)**. Solusi ini jauh lebih kuat daripada Ngrok (versi gratis) karena tidak memiliki limit koneksi, otomatis mendapatkan SSL (https), dan tahan serangan DDoS.

## Prasyarat
1. Domain Anda (`datasdm.com`) sudah menggunakan **Name Server Cloudflare** (DNS dikelola di dashboard Cloudflare).
2. PC Server Lokal menyala dan terhubung ke internet.
3. Aplikasi CRM Anda sudah berjalan di port lokal (biasanya `http://localhost:3000`).

---

## Langkah 1: Download & Install Cloudflared
1. Buka browser di PC Server Anda dan unduh file installer `cloudflared` resmi untuk Windows:
   👉 [Download cloudflared-windows-amd64.msi](https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi)
2. Buka file `.msi` yang baru diunduh dan ikuti proses instalasinya (klik Next sampai selesai).

## Langkah 2: Autentikasi Cloudflare
1. Buka aplikasi **Command Prompt (CMD)** atau **PowerShell** sebagai Administrator.
2. Ketik perintah berikut dan tekan Enter:
   ```cmd
   cloudflared tunnel login
   ```
3. Browser Anda akan terbuka secara otomatis, meminta Anda untuk login ke akun Cloudflare.
4. Pilih domain Anda (`datasdm.com`) lalu klik **Authorize**.
5. Kembali ke CMD, Anda akan melihat pesan bahwa sertifikat telah berhasil diunduh.

## Langkah 3: Membuat Tunnel
Di CMD yang sama, buat sebuah Tunnel baru (mari kita namakan `wa-crm-tunnel`):
```cmd
cloudflared tunnel create wa-crm-tunnel
```
*(Catat ID Tunnel yang muncul di layar, contoh: `a1b2c3d4-xxxx-xxxx-xxxx-...`)*

## Langkah 4: Mengarahkan Domain (Routing)
Sekarang, hubungkan Tunnel tersebut ke subdomain `crm.datasdm.com` milik Anda. Ketik perintah ini:
```cmd
cloudflared tunnel route dns wa-crm-tunnel crm.datasdm.com
```
Perintah ini akan secara otomatis membuat *record CNAME* di DNS Cloudflare Anda.

## Langkah 5: Membuat File Konfigurasi
Anda perlu memberi tahu Cloudflare ke port mana lalu lintas harus diarahkan (yaitu port aplikasi CRM kita, `localhost:3000`).

1. Buka folder `.cloudflared` di *user directory* Anda (biasanya di `C:\Users\NAMA_USER_ANDA\.cloudflared\`).
2. Buat file baru bernama `config.yml` (pastikan ekstensinya `.yml`, bukan `.txt`).
3. Buka file tersebut dengan Notepad, dan isikan kode berikut (Ganti `<TUNNEL_ID>` dengan ID panjang yang Anda dapatkan di Langkah 3):

```yaml
tunnel: <TUNNEL_ID>
credentials-file: C:\Users\NAMA_USER_ANDA\.cloudflared\<TUNNEL_ID>.json

ingress:
  - hostname: crm.datasdm.com
    service: http://localhost:3000
  - service: http_status:404
```
> **Catatan:** Ganti `NAMA_USER_ANDA` dengan username Windows Anda.

## Langkah 6: Menjalankan Tunnel sebagai Windows Service (Otomatis)
Agar Tunnel selalu berjalan otomatis saat komputer dinyalakan tanpa harus membuka CMD terus menerus:

1. Di CMD (Run as Administrator), ketik:
   ```cmd
   cloudflared service install
   ```
2. Jalankan servicenya dengan membuka aplikasi **Services** bawaan Windows, cari `Cloudflared`, klik kanan, lalu pilih **Start**.
   *(Alternatif dari CMD: ketik `net start cloudflared`)*

---

## 🎉 Selesai!
Sekarang, cobalah buka browser di HP atau perangkat lain (gunakan jaringan seluler) dan akses:
**https://crm.datasdm.com**

Anda akan melihat dashboard CRM Anda berjalan dengan gembok hijau (SSL) yang aman!

### Mengapa ini yang Terbaik untuk 1000 Customer/Hari?
- **Koneksi Stabil (WebSocket Friendly):** Cloudflare mempertahankan koneksi *real-time* Socket.io tanpa *drop* (berbeda dengan Ngrok gratis yang sering terputus).
- **Caching & Proteksi:** Cloudflare otomatis menyaring bot/spam, meringankan beban CPU PC lokal Anda.
- **Auto-Reconnect:** Jika PC restart atau internet sempat putus, *service cloudflared* akan otomatis terhubung kembali tanpa ganti URL.
