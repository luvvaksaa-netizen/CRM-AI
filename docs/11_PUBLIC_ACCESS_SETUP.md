# 🚀 Panduan Setup Akses Publik (Cloudflare Tunnel)

Dokumen ini menjelaskan cara meng-online-kan server lokal CRM Anda (di PC Windows) ke domain publik `crm.datasdm.com` agar dapat diakses dari mana saja (HP/Luar Kota).

**PENTING UNTUK KASUS ANDA:** Anda saat ini memiliki 2 aplikasi yang berjalan di laptop/server yang sama:
1. **Aplikasi KirimFoto** (`kirimfoto.com`) berjalan di Port `3000`
2. **Aplikasi WA CRM AI** (`crm.datasdm.com`) berjalan di Port `3001`

Jika sebelumnya Anda membuka `crm.datasdm.com` tapi yang muncul malah `kirimfoto.com`, itu karena **aturan routing (ingress) di Cloudflare Tunnel Anda saling bertabrakan atau mengarah ke port yang sama (3000).** 

Jika saat ini muncul **Error 1033 (Cloudflare Tunnel error)**, itu karena service `cloudflared` di laptop Anda sedang mati (karena perintah `net stop cloudflared` yang Anda jalankan sebelumnya).

Berikut adalah solusi tuntas langkah demi langkah yang sangat mudah dipahami.

---

## 🛠️ LANGKAH 1: Bersihkan & Matikan Tunnel Lama

Pertama, pastikan tidak ada tunnel yang nyangkut. Buka **Command Prompt (CMD) sebagai Administrator**, lalu jalankan:

```cmd
net stop cloudflared
cloudflared service uninstall
```

> *Abaikan jika muncul error "service not found" atau semacamnya, itu wajar.*

---

## 🛠️ LANGKAH 2: Konfigurasi Routing (Ingress) yang Benar

Karena Anda punya 2 domain (`kirimfoto.com` dan `crm.datasdm.com`), kita harus menggabungkannya dalam **SATU** file konfigurasi agar Cloudflare tidak bingung.

1. Buka File Explorer, masuk ke folder: `C:\Windows\System32\config\systemprofile\.cloudflared\`
   *(Jika folder tidak ada, coba cek di `C:\Users\NAMA_USER_ANDA\.cloudflared\`)*
2. Cari file bernama `config.yml`. Jika tidak ada, buat file baru menggunakan Notepad dan simpan dengan nama `config.yml` (pastikan ekstensinya `.yml`, BUKAN `.yml.txt`).
3. Hapus semua isi file tersebut, lalu **Copy-Paste kode di bawah ini**:

```yaml
tunnel: <TUNNEL_ID_ANDA>
credentials-file: C:\Windows\System32\config\systemprofile\.cloudflared\<TUNNEL_ID_ANDA>.json

ingress:
  # 1. Routing untuk KirimFoto (Aplikasi Lama) -> diarahkan ke Port 3000
  - hostname: kirimfoto.com
    service: http://localhost:3000
    
  # 2. Routing untuk WA CRM AI (Aplikasi Baru) -> diarahkan ke Port 3001
  - hostname: crm.datasdm.com
    service: http://localhost:3001
    
  # 3. Default jika ada salah ketik domain
  - service: http_status:404
```

**⚠️ PERHATIAN PENTING:** 
Ganti `<TUNNEL_ID_ANDA>` dengan ID Tunnel milik Anda yang asli (berupa kombinasi huruf dan angka panjang). Anda bisa melihat ID ini dari nama file `.json` yang ada di dalam folder `.cloudflared` tersebut. *Pastikan juga path `credentials-file` sesuai dengan lokasi folder tempat file json Anda berada.*

---

## 🛠️ LANGKAH 3: Install Ulang & Jalankan Service Tunnel

Setelah file `config.yml` disimpan dengan benar, kembali ke **CMD (Run as Administrator)** dan jalankan:

```cmd
cloudflared service install
net start cloudflared
```

Jika berhasil, Anda akan melihat pesan bahwa service telah dijalankan.

---

## 🛠️ LANGKAH 4: Pastikan DNS di Dashboard Cloudflare Sudah Benar

Log in ke website **dash.cloudflare.com**:

1. Buka pengaturan DNS untuk domain **datasdm.com**.
2. Pastikan ada **Record CNAME** untuk `crm` yang mengarah ke `<TUNNEL_ID_ANDA>.cfargotunnel.com`.
3. *(Lakukan hal yang sama untuk kirimfoto.com jika dikelola di Cloudflare juga).*

---

## ✅ LANGKAH 5: Verifikasi Akhir

Setelah service `cloudflared` statusnya **Running**, cobalah buka dari browser HP Anda:
1. Akses **https://kirimfoto.com** 👉 Harusnya terbuka Web KirimFoto.
2. Akses **https://crm.datasdm.com** 👉 Harusnya terbuka Web Dashboard WA CRM AI.

### Masalah & Solusi (Troubleshooting):
* **Masih Error 1033?** Berarti `cloudflared` gagal start. Coba buka CMD biasa, jalankan `cloudflared tunnel run` untuk melihat pesan errornya. Kemungkinan besar karena salah ketik spasi (indentasi) di dalam file `config.yml`.
* **Keduanya malah nyasar ke web yang sama?** Pastikan Anda TIDAK menjalankan perintah `cloudflared tunnel run` dua kali di terminal berbeda. Cukup gunakan service otomatis dari Langkah 3 di atas.
* **NPM Start Mati?** Pastikan `node index.js` untuk CRM berjalan di satu terminal, dan `npm start` untuk KirimFoto berjalan di terminal lainnya. Keduanya harus hidup agar website bisa diakses.
