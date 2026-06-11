# Dokumentasi Socket Events — v2-core

> **Dokumen:** 07_SOCKET_EVENTS.md  
> **Proyek:** CRM-AI v2-core  
> **Bahasa:** Bahasa Indonesia  
> **Terakhir diperbarui:** 2026-06-08

---

## Daftar Isi

1. [Pendahuluan](#pendahuluan)
2. [Koneksi & Transport](#koneksi--transport)
3. [Siklus Hidup Socket Client](#siklus-hidup-socket-client)
4. [Event Room-based (joinStore / leaveStore)](#event-room-based-joinstore--leavestore)
5. [Daftar Lengkap Event Socket](#daftar-lengkap-event-socket)
   - [5.1 Message & Chat Events](#51-message--chat-events)
   - [5.2 Label Events](#52-label-events)
   - [5.3 Contact Identity Events](#53-contact-identity-events)
   - [5.4 WA Connection Events](#54-wa-connection-events)
   - [5.5 Store Events](#55-store-events)
   - [5.6 Follow-Up Events](#56-follow-up-events)
   - [5.7 Media Events](#57-media-events)
   - [5.8 Dashboard & System Events](#58-dashboard--system-events)
6. [Legacy Re-exports (app.ts)](#legacy-re-exports-appts)
7. [Implementasi Frontend (socket.ts)](#implementasi-frontend-socketts)

---

## Pendahuluan

Sistem **v2-core** menggunakan **Socket.IO** sebagai mekanisme komunikasi *real-time* antara server dan klien. Seluruh event dikirimkan melalui koneksi Socket.IO yang terenkripsi dan terautentikasi.

Dokumen ini menjelaskan seluruh event yang tersedia, arah pengiriman (client ↔ server), format *payload*, dan deskripsi fungsional masing-masing event.

---

## Koneksi & Transport

| Parameter         | Nilai                                |
|-------------------|--------------------------------------|
| **Library**       | Socket.IO Client (v4.x)              |
| **Transports**    | `['polling', 'websocket']`           |
| **Prioritas**     | Polling → WebSocket (upgrade)      |
| **Timeout**       | 20.000 ms (20 detik)                 |
| **Reconnection**  | Enabled (otomatis)                   |
| **Delay awal**    | 1.000 ms (1 detik)                   |
| **Delay maks**    | 10.000 ms (10 detik)                 |
| **Exponential backoff** | Ya                             |

Klien akan mencoba koneksi melalui *long-polling* terlebih dahulu, kemudian melakukan *upgrade* ke *WebSocket* jika tersedia.

```typescript
// Contoh inisialisasi koneksi — lihat frontend socket.ts untuk detail lengkap
const socket = io(serverUrl, {
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});
```

---

## Siklus Hidup Socket Client

Berikut adalah siklus hidup (*lifecycle*) koneksi socket pada aplikasi frontend:

```
                 +-------------+
                 |  Login/Sign |
                 |    In/Auth  |
                 +------+------+
                        |
                        v
              +-----------------+
              |    connect()    |  <-- Klien membuat koneksi
              +--------+-------+      ke server Socket.IO
                       |
                       v
             +---------------------+
             |  Autentikasi &      |
             |  joinStore(...)     |  <-- Bergabung ke room store
             +----------+----------+
                        |
            +-----------+-----------+
            |                       |
            v                       v
     +--------------+     +---------------------+
     |  Event Loop  |     |  Disconnect /       |
     |  Real-time   |     |  Error / Timeout    |
     +------+-------+     +----------+----------+
            |                       |
            |                       v
            |              +---------------------+
            |              | Reconnect (auto)    |
            |              | 1–10 detik       |
            |              | Exponential backoff |
            |              +----------+----------+
            |                       |
            +-----------------------+
                        |
                        v
             +---------------------+
             |   Logout /          |
             |   Disconnect        |  <-- disconnect() manual
             +---------------------+
```

**Tahapan:**

1. **connect** — Setelah login/auth berhasil, klien membuat koneksi ke server Socket.IO.
2. **joinStore** — Klien mengirim event `joinStore` untuk berlangganan (*subscribe*) ke room store tertentu.
3. **Event Loop** — Klien menerima event real-time (pesan baru, update QR, status koneksi, dll).
4. **Reconnect** — Jika koneksi terputus, klien akan mencoba reconnect secara otomatis dengan *exponential backoff* (1–10 detik).
5. **Disconnect** — Saat logout, klien mengirim `leaveStore` lalu memutus koneksi secara eksplisit.

---

## Event Room-based (joinStore / leaveStore)

Event **room-based** memungkinkan klien untuk berlangganan notifikasi dari store tertentu. Server mengelompokkan koneksi ke dalam *room* berdasarkan `storeId`.

### joinStore

Mengirimkan permintaan untuk bergabung ke dalam room store.

| Arah         | Payload             | Deskripsi                                |
|--------------|---------------------|------------------------------------------|
| Client → Server | `{ storeId: string }` | Bergabung ke room store untuk menerima event real-time dari store tersebut. |

```typescript
// Client → Server
socket.emit('joinStore', { storeId: 'store_abc123' });
```

**Server (socket.service.ts):**

```typescript
socket.on('joinStore', (data: { storeId: string }) => {
  const { storeId } = data;
  socket.join(storeId);
  // Bergabung ke room berdasarkan storeId
});
```

### leaveStore

Mengirimkan permintaan untuk keluar dari room store.

| Arah         | Payload             | Deskripsi                               |
|--------------|---------------------|-----------------------------------------|
| Client → Server | `{ storeId: string }` | Keluar dari room store (biasanya saat logout atau pindah store). |

```typescript
// Client → Server
socket.emit('leaveStore', { storeId: 'store_abc123' });
```

**Server (socket.service.ts):**

```typescript
socket.on('leaveStore', (data: { storeId: string }) => {
  const { storeId } = data;
  socket.leave(storeId);
  // Keluar dari room berdasarkan storeId
});
```

### disconnect

Event standar Socket.IO saat koneksi ditutup.

| Arah         | Payload | Deskripsi                                |
|--------------|---------|------------------------------------------|
| Client → Server | —    | Koneksi klien terputus (logout, timeout, atau error). Server akan membersihkan resource yang terkait. |

---

## Daftar Lengkap Event Socket

### 5.1 Message & Chat Events

Event yang berkaitan dengan pesan WhatsApp dan chat.

| Event Name        | Arah          | Payload                                                  | Deskripsi                                                    |
|-------------------|---------------|----------------------------------------------------------|--------------------------------------------------------------|
| `newMessage`      | Server → Client | `{ storeId: string, msg: object }`                     | Dikirim saat ada pesan baru masuk (dikirim/diterima). `msg` berisi objek pesan lengkap. |
| `chatRead`        | Server → Client | `{ storeId: string, contactId: string }`               | Dikirim saat status chat berubah menjadi *read* (dibaca).    |
| `chatCleared`     | Server → Client | `{ storeId: string, contactId: string }`               | Dikirim saat chat dihapus/dibersihkan untuk kontak tertentu. |
| `typingStatus`    | Server → Client | `{ storeId: string, contactId: string, isTyping: boolean }` | Dikirim saat status *typing* berubah (`true` = sedang mengetik, `false` = berhenti). |
| `messageRevoked`  | Server → Client | `{ storeId: string, waMessageId: string, contactId: string }` | Dikirim saat sebuah pesan ditarik (*revoked*) oleh pengirim. |

```typescript
// Contoh penerimaan event di frontend
socket.on('newMessage', (data: { storeId: string; msg: any }) => {
  console.log('Pesan baru:', data.msg);
});

socket.on('typingStatus', (data: { storeId: string; contactId: string; isTyping: boolean }) => {
  if (data.isTyping) {
    console.log('Kontak ' + data.contactId + ' sedang mengetik...');
  }
});
```

---

### 5.2 Label Events

Event yang berkaitan dengan perubahan label pada kontak.

| Event Name        | Arah          | Payload                                                  | Deskripsi                                                    |
|-------------------|---------------|----------------------------------------------------------|--------------------------------------------------------------|
|    | Server → Client |  | Dikirim saat label kontak diperbarui.  berisi daftar label terbaru. |



---

### 5.3 Contact Identity Events

Event yang berkaitan dengan perubahan identitas kontak.

| Event Name               | Arah          | Payload                                                  | Deskripsi                                                    |
|--------------------------|---------------|----------------------------------------------------------|--------------------------------------------------------------|
|  | Server → Client |  | Dikirim saat data identitas kontak diperbarui (nama, foto profil, dll). |



---

### 5.4 WA Connection Events

Event yang berkaitan dengan koneksi WhatsApp Web.

| Event Name         | Arah          | Payload                                                                                       | Deskripsi                                                                 |
|--------------------|---------------|-----------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| `qr`               | Server → Client | `{ storeId: string, qr: string }`                                                          | Dikirim saat QR Code tersedia untuk dipindai.                             |
| `temp_scan_ready`  | Server → Client | `{ storeId: string, qr: string, isTemp?: boolean, tempSessionId?: string, wa_id?: string, name?: string }` | Dikirim saat sesi sementara siap dipindai. Berisi QR dan metadata sesi. |
| `ready`            | Server → Client | `{ storeId: string }`                                                                       | Dikirim saat koneksi WhatsApp siap digunakan (terautentikasi).           |
| `disconnected`     | Server → Client | `{ storeId: string }`                                                                       | Dikirim saat koneksi WhatsApp terputus.                                  |
| `qrUpdate`         | Server → Client | `{ storeId: string, qr: string }`                                                          | Dikirim saat QR Code diperbarui (misal QR expired, generate ulang).      |

```typescript
// Contoh: Menampilkan QR Code di halaman pengaturan
socket.on('qr', (data: { storeId: string; qr: string }) => {
  showQRCode(data.qr);
});

socket.on('ready', (data: { storeId: string }) => {
  console.log('WhatsApp connected for store:', data.storeId);
  hideQRCode();
  showConnectedStatus();
});

socket.on('disconnected', (data: { storeId: string }) => {
  console.warn('WhatsApp disconnected for store:', data.storeId);
  showReconnectButton();
});
```

---

### 5.5 Store Events

Event yang berkaitan dengan status dan konfigurasi store.

| Event Name      | Arah          | Payload                        | Deskripsi                                                   |
|-----------------|---------------|--------------------------------|-------------------------------------------------------------|
| `statusUpdate`  | Server → Client | `{ storeId: string, status: any }` | Dikirim saat status store berubah (misal: aktif, nonaktif, maintenance). |
| `storeUpdated`  | Server → Client | `{ storeId: string }`         | Dikirim saat data konfigurasi store diperbarui.             |

```typescript
socket.on('statusUpdate', (data: { storeId: string; status: string }) => {
  console.log('Status store ' + data.storeId + ': ' + data.status);
});

socket.on('storeUpdated', (data: { storeId: string }) => {
  console.log('Store updated, refresh data:', data.storeId);
});
```

---

### 5.6 Follow-Up Events

Event yang berkaitan dengan follow-up / tindak lanjut kontak.

| Event Name         | Arah          | Payload                   | Deskripsi                                                    |
|--------------------|---------------|---------------------------|--------------------------------------------------------------|
| `followUpUpdated`  | Server → Client | `{ contactWaId: string }` | Dikirim saat data follow-up untuk suatu kontak diperbarui.  |

```typescript
socket.on('followUpUpdated', (data: { contactWaId: string }) => {
  console.log('Follow-up diperbarui untuk kontak:', data.contactWaId);
});
```

---

### 5.7 Media Events

Event yang berkaitan dengan pemrosesan media (gambar, video, dokumen, dll).

| Event Name             | Arah          | Payload                                    | Deskripsi                                                    |
|------------------------|---------------|--------------------------------------------|--------------------------------------------------------------|
| `mediaUpdated`         | Server → Client | `{ agentId: string }`                    | Dikirim saat status/data media diperbarui untuk suatu agent. |
| `mediaAnalysisReady`   | Server → Client | `{ agentId: string, assetId: string }`   | Dikirim saat hasil analisis media siap (misal: AI selesai memproses gambar). |

```typescript
socket.on('mediaAnalysisReady', (data: { agentId: string; assetId: string }) => {
  console.log('Analisis media siap untuk agent ' + data.agentId + ', asset ' + data.assetId);
});
```

---

### 5.8 Dashboard & System Events

Event yang berkaitan dengan dashboard dan monitoring sistem.

| Event Name         | Arah          | Payload                                             | Deskripsi                                                  |
|--------------------|---------------|-----------------------------------------------------|------------------------------------------------------------|
| `dashboardUpdate`  | Server → Client | *(tidak ada payload)*                              | Sinyal bahwa data dashboard perlu diperbarui (refresh data dari client). |
| `sysStats`         | Server → Client | `{ ram: number, cpu: number, uptime: number }`    | Statistik sistem secara periodik: RAM (%), CPU (%), dan *uptime* (detik). |
| `sysLog`           | Server → Client | `{ type: string, msg: string, time: number }`     | Log sistem real-time. `type` = level log (info, warn, error), `msg` = pesan, `time` = timestamp. |

```typescript
// Dashboard update -- trigger refresh dari client
socket.on('dashboardUpdate', () => {
  refreshDashboardData();
});

// System stats
socket.on('sysStats', (data: { ram: number; cpu: number; uptime: number }) => {
  updateSystemMonitor({
    ram: data.ram,
    cpu: data.cpu,
    uptime: formatUptime(data.uptime),
  });
});

// System logs
socket.on('sysLog', (data: { type: string; msg: string; time: number }) => {
  addLogEntry({
    level: data.type,
    message: data.msg,
    timestamp: new Date(data.time),
  });
});
```

---

## Legacy Re-exports (app.ts)

Untuk kompatibilitas dengan kode lama (*legacy*), beberapa event di-*re-export* melalui `app.ts` atau *entry point* utama server. Fungsi-fungsi ini merupakan *wrapper* yang langsung memanggil method pada instance socket service.

Berikut daftar re-export yang tersedia:

| Fungsi Re-export         | Event Tujuan        | Parameter Utama                     | Deskripsi                                                    |
|--------------------------|---------------------|-------------------------------------|--------------------------------------------------------------|
| `emitQR(storeId, qr)`    | `qr`                | `storeId: string`, `qr: string`    | Mengirim QR Code ke client untuk store tertentu.             |
| `emitReady(storeId)`     | `ready`             | `storeId: string`                  | Memberi tahu client bahwa koneksi WA siap.                   |
| `emitDisconnected(storeId)` | `disconnected`   | `storeId: string`                  | Memberi tahu client bahwa koneksi WA terputus.               |
| `emitNewMessage(storeId, msg)` | `newMessage` | `storeId: string`, `msg: object`   | Mengirim pesan baru ke client.                               |
| `emitDashboardUpdate()`  | `dashboardUpdate`   | *(tidak ada parameter)*             | Memberi sinyal ke client untuk memperbarui dashboard.        |

```typescript
// Contoh penggunaan legacy wrapper (app.ts)
import { emitQR, emitReady, emitDisconnected, emitNewMessage } from './app';

// Ketika QR code tersedia
emitQR('store_abc', 'base64_qr_data_here...');

// Ketika koneksi WA siap
emitReady('store_abc');

// Ketika koneksi WA terputus
emitDisconnected('store_abc');

// Ketika ada pesan baru
emitNewMessage('store_abc', { id: 'msg_001', content: 'Halo!' });
```

---

## Implementasi Frontend (socket.ts)

Implementasi Socket.IO pada sisi frontend dikelola dalam file `frontend/src/services/socket.ts`. Berikut adalah struktur dan perilaku utamanya.

### Inisialisasi

```typescript
// frontend/src/services/socket.ts
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

const socket: Socket = io(SOCKET_URL, {
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});
```

### Event Listeners Dasar

```typescript
// Koneksi terbuat
socket.on('connect', () => {
  console.log('Socket connected:', socket.id);
});

// Koneksi terputus
socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason);
});

// Error koneksi
socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error.message);
});
```

### Bergabung & Keluar Room

```typescript
// Bergabung ke room store (setelah login/auth)
export function joinStore(storeId: string): void {
  socket.emit('joinStore', { storeId });
}

// Keluar dari room store (saat logout atau pindah store)
export function leaveStore(storeId: string): void {
  socket.emit('leaveStore', { storeId });
}
```

### Manajemen Koneksi (Login / Logout)

```typescript
// Panggil saat login berhasil
export function connectSocket(storeId: string): void {
  if (!socket.connected) {
    socket.connect();
  }
  joinStore(storeId);
}

// Panggil saat logout
export function disconnectSocket(storeId: string): void {
  leaveStore(storeId);
  socket.disconnect();
}
```

### Contoh Penggunaan Lengkap di Komponen React

```typescript
import { useEffect } from 'react';
import { socket, joinStore, leaveStore } from '../services/socket';

function ChatComponent({ storeId }: { storeId: string }) {
  useEffect(() => {
    // Bergabung ke room store
    joinStore(storeId);

    // Daftarkan listener
    socket.on('newMessage', handleNewMessage);
    socket.on('typingStatus', handleTypingStatus);
    socket.on('chatRead', handleChatRead);

    // Cleanup
    return () => {
      leaveStore(storeId);
      socket.off('newMessage', handleNewMessage);
      socket.off('typingStatus', handleTypingStatus);
      socket.off('chatRead', handleChatRead);
    };
  }, [storeId]);

  function handleNewMessage(data) { /* ... */ }
  function handleTypingStatus(data) { /* ... */ }
  function handleChatRead(data) { /* ... */ }

  return <div>{/* Komponen chat */}</div>;
}
```

---

## Ringkasan Event

| No | Event Name              | Arah          | Room Required | Payload Utama                              |
|----|-------------------------|---------------|---------------|--------------------------------------------|
| 1  | `newMessage`            | Server → Client | Ya (storeId) | `{ storeId, msg }`                        |
| 2  | `chatRead`              | Server → Client | Ya (storeId) | `{ storeId, contactId }`                  |
| 3  | `chatCleared`           | Server → Client | Ya (storeId) | `{ storeId, contactId }`                  |
| 4  | `typingStatus`          | Server → Client | Ya (storeId) | `{ storeId, contactId, isTyping }`        |
| 5  | `messageRevoked`        | Server → Client | Ya (storeId) | `{ storeId, waMessageId, contactId }`     |
| 6  | `labelsUpdated`         | Server → Client | Ya (storeId) | `{ storeId, contactId, labels }`          |
| 7  | `contactIdentityUpdated`| Server → Client | Ya (storeId) | `{ storeId, contactId, identity }`        |
| 8  | `qr`                    | Server → Client | Ya (storeId) | `{ storeId, qr }`                         |
| 9  | `temp_scan_ready`       | Server → Client | Ya (storeId) | `{ storeId, qr, isTemp?, ... }`           |
| 10 | `ready`                 | Server → Client | Ya (storeId) | `{ storeId }`                             |
| 11 | `disconnected`          | Server → Client | Ya (storeId) | `{ storeId }`                             |
| 12 | `qrUpdate`              | Server → Client | Ya (storeId) | `{ storeId, qr }`                         |
| 13 | `statusUpdate`          | Server → Client | Ya (storeId) | `{ storeId, status }`                     |
| 14 | `storeUpdated`          | Server → Client | Ya (storeId) | `{ storeId }`                             |
| 15 | `followUpUpdated`       | Server → Client | —        | `{ contactWaId }`                         |
| 16 | `mediaUpdated`          | Server → Client | —        | `{ agentId }`                             |
| 17 | `mediaAnalysisReady`    | Server → Client | —        | `{ agentId, assetId }`                    |
| 18 | `dashboardUpdate`       | Server → Client | —        | *(tidak ada payload)*                     |
| 19 | `sysStats`              | Server → Client | —        | `{ ram, cpu, uptime }`                    |
| 20 | `sysLog`                | Server → Client | —        | `{ type, msg, time }`                     |
| 21 | `joinStore`             | Client → Server | —        | `{ storeId }`                             |
| 22 | `leaveStore`            | Client → Server | —        | `{ storeId }`                             |

> **Catatan:**  
> - Event dengan kolom **Room Required** = *Ya (storeId)* hanya akan diterima oleh klien yang sudah bergabung ke room store yang sesuai melalui event `joinStore`.  
> - Event tanpa room (`followUpUpdated`, `mediaUpdated`, `mediaAnalysisReady`, `dashboardUpdate`, `sysStats`, `sysLog`) dikirim ke semua klien yang terhubung.

---

*Dokumentasi ini dibuat berdasarkan implementasi aktual pada `backend/src/services/socket.service.ts` dan `frontend/src/services/socket.ts`.*