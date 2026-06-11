# 05 — Keamanan (Security)

> **Dokumen:** Keamanan & Hardening — CRM-AI v2-core  
> **Versi:** 1.0  
> **Terakhir diperbarui:** Juni 2026

---

## Daftar Isi

1. [Fitur Keamanan yang Diimplementasikan](#1-fitur-keamanan-yang-diimplementasikan)
2. [Alur Autentikasi (JWT)](#2-alur-autentikasi-jwt)
3. [Tabel Otorisasi Berbasis Peran](#3-tabel-otorisasi-berbasis-peran)
4. [Strategi Rate Limiting](#4-strategi-rate-limiting)
5. [Server Hardening Checklist](#5-server-hardening-checklist)
6. [Keamanan Database](#6-keamanan-database)
7. [Keamanan Upload File](#7-keamanan-upload-file)
8. [Catatan Validasi Input](#8-catatan-validasi-input)
9. [Keamanan Environment Variable](#9-keamanan-environment-variable)
10. [Deployment Security Checklist](#10-deployment-security-checklist)
11. [Peringatan Kredensial Default](#11-peringatan-kredensial-default)
12. [Logging dan Monitoring](#12-logging-dan-monitoring)


## 1. Fitur Keamanan yang Diimplementasikan

Sistem CRM-AI v2-core telah menerapkan lapisan keamanan berikut:

| Lapisan | Fitur | Lokasi |
|---------|-------|--------|
| **Autentikasi** | JWT (JSON Web Token) | middleware auth.middleware.ts |
| **Otorisasi** | Role-based access (admin, operator) | middleware authorize() |
| **Rate Limiting** | Login (10/15 menit) & Chat (30/menit) | auth.routes.ts, chat.routes.ts |
| **Server Hardening** | Helmet + CORS whitelist | src/app.ts |
| **Upload Aman** | Filter MIME + Batas ukuran 50MB | routes/media.routes.ts |
| **Error Handling** | Global handler tanpa stack trace | middleware/errorHandler.ts |
| **Graceful Shutdown** | SIGINT/SIGTERM + DB + Exit | src/app.ts |
| **Env Validation** | Validasi env wajib saat startup | config.js + requireEnv() |

---

## 2. Alur Autentikasi (JWT)

```
+----------+      POST /api/auth/login      +--------------+
|  Client  | ------------------------------> |   Express    |
| (Browser) |                                 |   Server     |
+----------+                                  +--------------+
      ^                                            |
      |        { token: "eyJ..." }                 |
      +--------------------------------------------+
                    (JWT Access Token)

Setiap Request Terproteksi:
+----------+   Header: Authorization: Bearer ***   +----------------+
|  Client  | -------------------------------------> | auth.middleware |
+----------+                                         +----------------+
                                                              |
                                                         Validasi:
                                                         1. Cek header
                                                         2. Verifikasi signature
                                                         3. Cek expired
                                                         4. Decode payload
                                                              |
                                                              v
                                                    +------------------+
                                                    |  Request Diterima |
                                                    |  req.user terisi  |
                                                    +------------------+
```

### Detail Implementasi

- **Library:** jsonwebtoken
- **Secret:** Wajib dari JWT_SECRET environment variable
- **Expiry:** Dikonfigurasi via JWT_EXPIRES_IN (default: 24 jam)
- **Flow:**
  1. Client login dengan username & password
  2. Server memverifikasi kredensial terhadap database
  3. Server menerbitkan JWT token
  4. Client menyertakan token di header Authorization: Bearer ***  5. Middleware auth.middleware.ts memvalidasi token setiap request
- **Respon Error:**
  - 401 - Unauthorized. Harap login. (token tidak ada)
  - 403 - Token tidak valid / expired. (token invalid/kedaluwarsa)

---

## 3. Tabel Otorisasi Berbasis Peran

Middleware authorize(role1, role2, ...) membatasi akses berdasarkan peran pengguna.

| Fitur / Endpoint | admin | operator | Tidak Login |
|------------------|-------|----------|-------------|
| Login | Ya | Ya | Ya |
| Dashboard | Ya | Ya | Tidak |
| Manajemen Chat | Ya | Ya | Tidak |
| Kirim Pesan | Ya | Ya | Tidak |
| Manajemen Kontak | Ya | Ya | Tidak |
| Manajemen Media | Ya | Ya | Tidak |
| Manajemen Pengguna | Ya | Tidak | Tidak |
| Log Aktivitas | Ya | Tidak | Tidak |
| Konfigurasi Sistem | Ya | Tidak | Tidak |

### Cara Penggunaan Middleware

```typescript
// Hanya admin
router.get('/users', authorize('admin'), userController.list);

// Admin dan operator
router.post('/chat/send', authorize('admin', 'operator'), chatController.send);

// Publik (tanpa autentikasi)
router.post('/auth/login', authController.login);
```

---

## 4. Strategi Rate Limiting

Rate limiting diterapkan menggunakan express-rate-limit untuk mencegah brute force dan abuse.

### Login Endpoint

| Parameter | Nilai |
|-----------|-------|
| **Endpoint** | /api/auth/login |
| **Window** | 15 menit |
| **Max Request** | 10 |
| **Message** | Terlalu banyak percobaan login. Silakan coba lagi dalam 15 menit. |
| **Tujuan** | Mencegah brute force attack |

### Send Message Endpoint

| Parameter | Nilai |
|-----------|-------|
| **Endpoint** | /api/chat/send (atau rute chat terproteksi) |
| **Window** | 1 menit |
| **Max Request** | 30 |
| **Message** | Terlalu banyak permintaan. Silakan coba lagi nanti. |
| **Tujuan** | Mencegah spam & abuse API |

### Rekomendasi Pengembangan

- Tambahkan rate limiting di endpoint lain jika diperlukan
- Pertimbangkan sliding window untuk distribusi yang lebih merata
- Implementasikan IP-based blocking untuk serangan berkelanjutan
- Gunakan Redis sebagai store rate limit di production (multi-instance)

---

## 5. Server Hardening Checklist

### Helmet Middleware

Helmet dipasang untuk mengamankan header HTTP:

```typescript
// backend/src/app.ts
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
```

| Header | Default | Status |
|--------|---------|--------|
| X-Content-Type-Options | nosniff | Aktif |
| X-Frame-Options | DENY | Aktif |
| X-XSS-Protection | 0 | Aktif |
| Strict-Transport-Security | Max age 15552000 | Aktif |
| Content-Security-Policy | Default | Aktif |
| Cross-Origin-Resource-Policy | cross-origin | Di-set |

### CORS (Cross-Origin Resource Sharing)

```typescript
// backend/src/app.ts
const whitelist = process.env.CORS_ORIGINS?.split(',') || [];
app.use(cors({ origin: whitelist }));
```

- **Whitelist:** Dari environment variable CORS_ORIGINS
- **Format:** Daftar origin yang dipisahkan koma (contoh: http://localhost:5173,https://app.example.com)
- **Catatan:** Jangan gunakan wildcard (*) di production

### Checklist Server

| Item | Status | Keterangan |
|------|--------|------------|
| Helmet terpasang | Aktif | Semua header keamanan HTTP |
| CORS whitelist | Aktif | Origin terbatas |
| HTTPS di production | Perlu | Wajib di production (gunakan reverse proxy) |
| HSTS | Aktif | Via Helmet |
| CSP (Content Security Policy) | Perlu | Sesuaikan dengan kebutuhan frontend |
| Rate limiting | Aktif | Login & Chat |
| Validasi input | Aktif | MIME filter & ukuran file |

---

## 6. Keamanan Database

### SQLite Configuration

```typescript
const db = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(dataDir, 'database.sqlite'),
    logging: false,
    pool: { max: 1, min: 0, acquire: 30000, idle: 10000 },
    dialectOptions: {
        mode: SQLiteOpenFlags.READ_WRITE | SQLiteOpenFlags.CREATE
    }
});
```

### Aspek Keamanan

| Aspek | Implementasi | Keterangan |
|-------|-------------|-----------|
| WAL Mode | Write-Ahead Logging | Performa lebih baik, integritas terjaga |
| No Force Sync | sync({ force: false }) | Tidak menghapus data production |
| Busy Timeout | 30 detik | Mencegah deadlock |
| Pool Size | 1 koneksi | SQLite limitation - aman untuk single-writer |
| Logging | Nonaktif | Tidak ada bocor query ke log |
| SQL Injection | Via Sequelize ORM | Parameterized query otomatis |

### Best Practice Database

1. **Backup rutin** - backup file database.sqlite secara berkala
2. **Enkripsi at-rest** - enkripsi volume/direktori data di production
3. **Akses terbatas** - hanya process user yang bisa membaca file database
4. **File permission** - chmod 600 pada file SQLite di production

---

## 7. Keamanan Upload File

### Implementasi

File upload menggunakan Multer dengan validasi MIME type dan batas ukuran.

```typescript
// backend/src/routes/media.routes.ts
const ALLOWED_MIMES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

const upload = multer({
    storage: multer.diskStorage({ ... }),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipe file tidak diizinkan'), false);
        }
    }
});
```

### Detail Keamanan Upload

| Aspek | Nilai | Keterangan |
|-------|-------|-----------|
| Batas Ukuran | 50 MB | Cegah file besar abuse |
| MIME Filter | Whitelist terbatas | Hanya gambar, PDF, TXT, DOCX, XLSX |
| Handler | Multer middleware | Validasi sebelum disk |
| Penyimpanan | Disk lokal (DATA_DIR/media) | Terpisah dari direktori aplikasi |
| Nama File | Gunakan UUID/timestamp | Hindari path traversal |

### Checklist Keamanan Upload

- [x] Batas ukuran file (50MB)
- [x] Whitelist MIME type
- [x] Gunakan library aman (Multer)
- [ ] Scan file upload dengan antivirus (rekomendasi)
- [ ] Simpan file di luar direktori web root
- [ ] Gunakan UUID untuk nama file (hindari nama asli)
- [ ] Set permission baca-saja setelah upload
- [ ] Limit jumlah file per user

---

## 8. Catatan Validasi Input

### Strategi Validasi

Sistem menggunakan kombinasi validasi:

1. **Sequelize ORM** - Otomatis melakukan parameterized query, mencegah SQL injection
2. **Multer** - Validasi MIME tipe file upload
3. **Express middleware** - Validasi body request di route handler
4. **Joi / Zod** (rekomendasi) - Belum diterapkan, tetapi sangat disarankan

### Praktik yang Sudah Diterapkan

- Parameterized queries via Sequelize
- MIME type validation untuk upload
- JSON body parsing via express.json()
- CORS whitelist
- Rate limiting

### Praktik yang Perlu Ditambahkan

| Praktik | Prioritas | Keterangan |
|---------|-----------|-----------|
| Validasi skema payload (Joi/Zod) | Tinggi | Validasi tipe data, panjang string, enum |
| Sanitasi input teks | Sedang | Cegah XSS di chat/teks |
| CSRF protection | Sedang | Jika menggunakan cookie-based auth |
| Content-Type validation | Rendah | Pastikan Content-Type sesuai |

---

## 9. Keamanan Environment Variable

### Variabel Wajib

| Variable | Wajib | Fungsi | Catatan Keamanan |
|----------|-------|--------|-----------------|
| JWT_SECRET | Ya | Secret key JWT | Minimal 32 karakter, acak |
| CORS_ORIGINS | Ya | Whitelist CORS | Daftar origin valid |
| DATA_DIR | Ya | Direktori data | Jangan di dalam public web root |
| PORT | Tidak | Port server | Default: 3000 |

### Cara Penggunaan

```javascript
// config.js
const dotenv = require('dotenv');
dotenv.config();

function requireEnv(name) {
    if (!process.env[name]) {
        console.error('ERROR: Environment variable ' + name + ' wajib diisi.');
        process.exit(1);
    }
    return process.env[name];
}
```

### Best Practice

1. **Jangan commit .env** - Pastikan .env ada di .gitignore
2. **Gunakan .env.example** - Dokumentasikan semua variabel tanpa nilai rahasia
3. **Rotasi secret** - Ubah JWT_SECRET secara berkala
4. **Gunakan secret manager** - Untuk production, gunakan vault/secret manager
5. **Minimal privilege** - Environment variable hanya dibaca oleh proses aplikasi
6. **Hindari logging** - Jangan pernah log nilai secret

---

## 10. Deployment Security Checklist

Gunakan checklist ini sebelum deploy ke production:

### Pra-Deploy

- [ ] NODE_ENV=production sudah di-set
- [ ] JWT_SECRET sudah diubah dari default - jangan pakai nilai contoh
- [ ] CORS_ORIGINS hanya berisi domain yang valid
- [ ] File .env tidak ikut ter-commit ke repository
- [ ] Semua dependency sudah di-audit (npm audit)
- [ ] Logging error tidak menampilkan stack trace
- [ ] Database tidak dalam mode force sync
- [ ] Directory permission sudah diatur (600 untuk database, 700 untuk data)

### Saat Deploy

- [ ] Gunakan reverse proxy (Nginx/Caddy) dengan HTTPS
- [ ] Aktifkan firewall - tutup port selain 80/443
- [ ] Jalankan aplikasi dengan non-root user
- [ ] Gunakan fail2ban atau IPS untuk proteksi tambahan
- [ ] Set file descriptor limits yang memadai

### Pasca-Deploy

- [ ] Verifikasi semua endpoint terproteksi dengan benar
- [ ] Test rate limiting berfungsi
- [ ] Monitor log untuk aktivitas mencurigakan
- [ ] Backup database secara rutin
- [ ] Update dependency secara berkala (npm update)

---

## 11. Peringatan Kredensial Default

> PERINGATAN KEAMANAN KRITIS

Sistem CRM-AI v2-core membuat akun **admin default** saat inisialisasi pertama:

| Field | Nilai Default |
|-------|---------------|
| **Username** | admin |
| **Password** | admin123 |
| **Role** | admin |

### Tindakan yang Harus Dilakukan

1. **Ubah password segera setelah login pertama**
2. **Jangan gunakan kredensial default di production**
3. **Hapus akun default** jika tidak diperlukan (buat akun admin baru, lalu hapus admin)
4. **Gunakan password yang kuat:**
   - Minimal 12 karakter
   - Kombinasi huruf besar, huruf kecil, angka, dan simbol
   - Bukan kata yang umum atau mudah ditebak
5. **Aktifkan 2FA/MFA** jika tersedia

### Cara Mengubah Password

```bash
# Melalui API (contoh menggunakan curl)
curl -X PUT http://localhost:3000/api/users/profile   -H "Authorization: Bearer ***   -H "Content-Type: application/json"   -d '{"password": "Str0ng!Passw0rd#2026"}'
```

---

## 12. Logging dan Monitoring

### Rekomendasi Logging

| Aspek | Rekomendasi | Keterangan |
|-------|-------------|-----------|
| Framework | Winston / Pino | Struktur log JSON |
| Level | info (production), debug (development) | Jangan log debug di production |
| Akses Log | Akses API, IP address, timestamp | Untuk audit trail |
| Error Log | Stack trace terbatas, context jelas | Tanpa bocor secret |
| Auth Log | Login sukses/gagal, IP, timestamp | Deteksi brute force |

### Event yang Perlu Dimonitor

| Event | Severity | Tindakan |
|-------|----------|----------|
| Login gagal berulang | Tinggi | Blokir IP sementara |
| Token invalid berulang | Sedang | Investigasi abuse |
| Upload file gagal (MIME) | Rendah | Catat untuk audit |
| Rate limit terpicu | Sedang | Monitor pola abuse |
| Error 500 | Tinggi | Segera investigasi |
| Graceful shutdown | Rendah | Informasi maintenance |

### Integrasi Monitoring

1. **Health Endpoint** - Buat endpoint /health untuk monitoring uptime
2. **APM** - Gunakan Sentry, DataDog, atau New Relic
3. **Log Aggregation** - ELK Stack atau Loki + Grafana
4. **Alerting** - Integrasi dengan Slack/Telegram/Email untuk notifikasi real-time
5. **Uptime Monitoring** - Gunakan UptimeRobot, Pingdom, atau layanan serupa

### Contoh Konfigurasi Winston

```javascript
const winston = require('winston');

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5242880,
            maxFiles: 10
        })
    ]
});
```

---

## Lampiran A: Referensi

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT.io - JSON Web Token](https://jwt.io/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
- [Express Rate Limit](https://github.com/express-rate-limit/express-rate-limit)
- [Multer Documentation](https://github.com/expressjs/multer)

---

## Lampiran B: Riwayat Perubahan

| Tanggal | Versi | Perubahan | Penulis |
|---------|-------|-----------|---------|
| Juni 2026 | 1.0 | Dokumen awal keamanan | CRM-AI Team |
