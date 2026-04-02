# 🛡️ PANDUAN INTEGRITAS SISTEM OMNI-BOT CRM (NORTH STAR)
Dokumen ini adalah aturan tetap yang **HARUS** dipatuhi selama proses perombakan (refactoring) ke Next.js & Nest.js. Jangan sekali-kali menghilangkan atau mengubah logika di bawah ini tanpa persetujuan USER.

---

## 1. FITUR UTAMA (Wajib Ada & Utuh)

| Fitur | Deskripsi Logika | Status |
| :--- | :--- | :--- |
| **Multi-Tenant Agent** | Arsitektur "Otak Terpusat" (Agent) yang bisa dipakai banyak Device (Nomor WA). | 🚨 KRITIS |
| **AI Vision (Mata)** | AI harus bisa menganalisis foto pelanggan (Vision) dan memberikan insight di dashboard. | 🚨 KRITIS |
| **Whisper Voice (Telinga)** | AI harus bisa mentranskripsi Pesan Suara (Voice Note) pelanggan ke teks. | 🚨 KRITIS |
| **Rekap Chat (Summary)** | AI harus merangkum progress deal/status pelanggan secara non-blocking setiap ada chat. | 🚨 KRITIS |
| **Anti-Fraud Payment** | AI **HARAM** menerima klaim transfer tanpa bukti foto tanda terima. | 🚨 KRITIS |
| **Human Override** | Toggle "AI Menjawab" per kontak untuk intervensi manual Admin. | 🚨 KRITIS |
| **Temporal Context** | Injeksi Jam & Tanggal server ke AI agar paham referensi waktu (kemarin/minggu depan). | 🚨 KRITIS |

---

## 2. ATURAN PENGEMBANGAN (Development Rules)

### 🧱 Arsitektur
- **Modularitas:** Folder harus rapi (Domain-Driven Design). Jangan campur logika AI dengan UI.
- **Data Integrity:** Migrasi SQLite -> PostgreSQL harus menyertakan skema `contact_summaries` dan indices.

### 🤖 Logika AI
- **Memory:** Limit riwayat minimal 20-30 pesan.
- **Context:** `system_prompt` dan `knowledge` harus bisa diatur per Agen secara dinamis.
- **Tone:** Tetap ramah, santun (Bahasa Indonesia), dan fokus pada konversi sales.

### 🎨 User Interface (UI/UX)
- **Fluid Experience:** Dashboard harus terasa ringan (SPA/Next.js) dan premium.
- **Responsive:** Daftar chat dan isi chat harus berdampingan (Row Layout) di layar lebar.
- **AI Badges:** Insight AI (Vision & Transkrip) harus dipisah secara visual dari chat asli pelanggan.

---

## 3. PROSES MIGRASI (Roadmap)
1. **v1.5 (Stable SQLite):** Push versi saat ini ke Production sebagai baseline fungsional.
2. **Backend NestJS:** Pasang mesin modular di server tanpa UI dulu.
3. **Frontend NextJS:** Pasang Dashboard mewah yang menghubung ke mesin baru.
4. **Final Sync:** Pindahkan seluruh database lama ke database baru secara tuntas.

---
**Tertanda,**
*Antigravity (AI Architect)* & *User (Project Owner)*
