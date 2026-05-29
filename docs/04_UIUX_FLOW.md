# 04 — UI/UX Flow Document

> **Versi:** 1.0 | **Tanggal:** 2026-05-29

---

## 1. Sitemap & Navigation

```
CRM-AI Dashboard
├── /login                      # Login Page
├── / (Dashboard)               # Main Dashboard
│   ├── Overview Panel          # Stats, funnel, trend chart
│   ├── Store Selector          # Switch between WA numbers
│   └── Quick Actions           # QR scan, toggle bot, etc.
│
├── /chats                      # Live Chat
│   ├── Chat List (Left Panel)  # Contact list with filters
│   │   ├── Search Bar
│   │   ├── Filter: Store
│   │   ├── Filter: Status (All/AI/CS/Paused)
│   │   └── Chat Preview Cards
│   ├── Chat Detail (Center)    # Message view
│   │   ├── Message Bubbles     # AI vs CS vs Customer
│   │   ├── Media Display       # Inline images/videos
│   │   ├── Quick Reply Input
│   │   └── Send Media Button
│   └── Customer Info (Right)   # Customer profile panel
│       ├── Name, Phone, Labels
│       ├── AI Summary
│       ├── Order Status
│       └── Follow-Up History
│
├── /agents                     # Agent Management
│   ├── Agent List
│   ├── Agent Editor
│   │   ├── Name & Bot Name
│   │   ├── System Prompt Editor (Monaco)
│   │   ├── Product Knowledge Editor
│   │   └── Auto-Labels Config
│   └── Media Catalog per Agent
│       ├── Upload Media
│       ├── Media Cards (Image/Video)
│       └── Trigger Words & Labels
│
├── /analytics                  # Analytics Dashboard
│   ├── Summary Cards (KPIs)
│   ├── Funnel Visualization
│   ├── Trend Chart (30 days)
│   ├── Per-Store Breakdown
│   ├── Top Closing List
│   └── Date Range Filter
│
├── /followups                  # Follow-Up Management
│   ├── Pending Follow-Ups
│   ├── Sent Follow-Ups
│   ├── Follow-Up Stats
│   └── Cancel / Reschedule
│
├── /settings                   # Settings
│   ├── Account Settings
│   ├── Store Configuration
│   ├── WhatsApp Connection
│   └── Notification Preferences
│
└── /logout                     # Logout
```

---

## 2. Page Flow Diagrams

### 2.1 Login Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │  Login Page  │     │  Dashboard  │
│  Opens URL  │ ──→ │             │     │             │
│             │     │ ┌─────────┐ │     │  (redirect) │
│             │     │ │Username │ │     │             │
│             │     │ └─────────┘ │ ──→ │             │
│             │     │ ┌─────────┐ │     │             │
│             │     │ │Password │ │     │             │
│             │     │ └─────────┘ │     │             │
│             │     │ [Login Btn] │     │             │
│             │     │             │     │             │
│             │     │ Error msg ← │     │             │
│             │     │ if invalid  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 2.2 Live Chat Flow

```
┌───────────────────────────────────────────────────────────────┐
│                       LIVE CHAT VIEW                          │
├─────────────┬────────────────────────────┬────────────────────┤
│  Chat List  │      Chat Detail           │  Customer Panel    │
│             │                            │                    │
│ ┌─────────┐ │  ┌───────────────────────┐ │ ┌──────────────┐  │
│ │ Search  │ │  │ Header: Name + Status │ │ │ Profile      │  │
│ └─────────┘ │  └───────────────────────┘ │ │ Name: Andi   │  │
│ ┌─────────┐ │                            │ │ Phone: +62...│  │
│ │ Filter  │ │  ┌──────────────────────┐  │ │ Labels: [Hot]│  │
│ │ ○ All   │ │  │ 💬 Halo kak (cust) │  │ └──────────────┘  │
│ │ ● AI    │ │  │ 🤖 Hai kak! (AI)   │  │                    │
│ │ ○ CS    │ │  │ 💬 Harganya? (cust)│  │ ┌──────────────┐  │
│ └─────────┘ │  │ 🤖 37rb promo (AI) │  │ │ AI Summary   │  │
│             │  │ 👤 Saya bantu (CS)  │  │ │ Status:      │  │
│ ┌─────────┐ │  └──────────────────────┘  │ │ Negosiasi    │  │
│ │ Andi    │ │                            │ │ Produk:      │  │
│ │ Preview │ │  ┌──────────────────────┐  │ │ Label DTF    │  │
│ │ 2m ago  │ │  │ Input: Type message  │  │ │ Jumlah: 2pkt │  │
│ ├─────────┤ │  │ [📎 Media] [Send ▶] │  │ └──────────────┘  │
│ │ Budi    │ │  └──────────────────────┘  │                    │
│ │ Preview │ │                            │ ┌──────────────┐  │
│ │ 5m ago  │ │  ┌──────────────────────┐  │ │ Actions      │  │
│ ├─────────┤ │  │ ○ AI ON  ◉ AI OFF   │  │ │ [Pause AI]   │  │
│ │ ...     │ │  │ (Toggle per kontak)  │  │ │ [Cancel FU]  │  │
│ └─────────┘ │  └──────────────────────┘  │ │ [View Order] │  │
│             │                            │ └──────────────┘  │
└─────────────┴────────────────────────────┴────────────────────┘
```

### 2.3 Customer Message Journey

```
Customer sends WhatsApp message
        │
        ▼
┌───────────────┐
│ Is Bot Active │──── No ──→ Message logged only, CS sees in dashboard
│ for Store?    │
└───────┬───────┘
        │ Yes
        ▼
┌───────────────┐
│ Is Contact    │──── Yes ──→ Message logged, AI does NOT respond
│ Paused (CS)?  │             CS can reply from dashboard
└───────┬───────┘
        │ No
        ▼
┌───────────────┐
│ Is Customer   │──── Yes ──→ Response opt-out confirmation
│ Opted-Out?    │             No further outbound
└───────┬───────┘
        │ No
        ▼
┌───────────────┐
│ Debounce      │── Wait 3s ─→ Collect burst messages
│ Buffer        │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ AI Process    │──→ Generate response with context
│ (Orchestrator)│    (prompt + knowledge + tools)
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Send Response │──→ Via Channel Adapter (Cloud API or WWebJS)
│ + Log to DB   │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│ Update Summary│──→ Background: generate AI summary
│ + Schedule FU │    + schedule follow-up (if not closing)
└───────────────┘
```

---

## 3. Component States

### 3.1 Store Status Badge

| State | Color | Icon | Condition |
|-------|-------|------|-----------|
| Online | 🟢 Green | ✓ | Cloud API connected |
| QR Scan | 🟡 Yellow | QR | WWebJS awaiting scan |
| Connecting | 🟡 Yellow | ⟳ | Attempting connection |
| Offline | 🔴 Red | ✗ | Disconnected |
| Banned | ⚫ Black | ⚠ | Account suspended |

### 3.2 Message Bubble Types

| Sender | Style | Icon | Color |
|--------|-------|------|-------|
| Customer | Left-aligned, rounded | 💬 | Light gray bg |
| AI Bot | Right-aligned, rounded | 🤖 | Blue bg |
| CS Manual | Right-aligned, rounded | 👤 | Green bg |
| CS Dashboard | Right-aligned, rounded | 🖥️ | Teal bg |
| System | Center, small | ℹ️ | Gray italic |

### 3.3 Follow-Up Status

| Status | Badge Color | Icon |
|--------|-------------|------|
| Pending | 🟡 Yellow | ⏰ |
| Sent | 🟢 Green | ✓ |
| Replied | 🔵 Blue | ↩️ |
| Cancelled | 🔴 Red | ✗ |

---

## 4. Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Desktop | ≥ 1280px | 3-column (list + chat + panel) |
| Tablet | 768-1279px | 2-column (list + chat, panel as modal) |
| Mobile | < 768px | 1-column (tabbed navigation) |

---

## 5. Key Interaction Patterns

### 5.1 Human Takeover Protocol

```
CS clicks "Pause AI" for customer "Andi"
  → AI stops responding to Andi's messages
  → Badge changes to "CS Mode" (green)
  → CS types reply in dashboard chat input
  → Reply sent via Channel Adapter
  → After 30 min inactivity, AI auto-resumes (configurable)
  → OR CS clicks "Resume AI" manually
```

### 5.2 Opt-Out Handling

```
Customer sends "STOP" or "Berhenti"
  → System detects opt-out keyword
  → ConsentRegistry.optOut(customerId)
  → Send confirmation: "Terima kasih. Anda tidak akan menerima pesan lagi."
  → Cancel all pending follow-ups
  → Mark customer as opted-out in dashboard
  → Block all outbound to this customer
```

### 5.3 QR Code Scan (Legacy WWebJS)

```
Admin clicks "Connect WA" for store
  → Server generates QR code via WWebJS
  → QR displayed in modal dialog
  → Admin scans with phone
  → Success: Modal closes, status → Online
  → Failure/Timeout: Show retry button
```

---

## 6. Analytics Dashboard Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ┌──────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │Total │ │ Closing  │ │ AI Handle │ │  Date Range      │  │
│  │Leads │ │ Rate     │ │ Rate      │ │  [Start] [End]   │  │
│  │ 142  │ │  23%     │ │   85%     │ │  [Apply Filter]  │  │
│  └──────┘ └──────────┘ └───────────┘ └──────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Sales Funnel                          │ │
│  │  Opening ████████████████████████████████████ 50      │ │
│  │  Gali    ████████████████████████████ 38              │ │
│  │  Nego    ████████████████████ 26                      │ │
│  │  Rekap   ████████████████ 22                          │ │
│  │  Transfer██████████ 15                                │ │
│  │  Closing █████ 8                                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │         Leads vs Closing (30 Days Trend)               │ │
│  │   📈 Line chart with dual axis                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────────────┐ │
│  │  Per-Store Breakdown │  │  Top 10 Closing Terbaru     │ │
│  │  ┌────┬────┬────┐    │  │  1. Andi - Closing 2h ago   │ │
│  │  │Toko│Rate│ AI │    │  │  2. Budi - Closing 5h ago   │ │
│  │  ├────┼────┼────┤    │  │  3. ...                     │ │
│  │  │ A  │25% │90% │    │  └──────────────────────────────┘ │
│  │  │ B  │18% │78% │    │                                   │
│  │  └────┴────┴────┘    │                                   │
│  └──────────────────────┘                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Design System Tokens (Target)

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#2563EB` (Blue 600) | Primary actions, links |
| `--primary-dark` | `#1D4ED8` (Blue 700) | Hover states |
| `--success` | `#16A34A` (Green 600) | Online, closing, success |
| `--warning` | `#D97706` (Amber 600) | Pending, attention |
| `--danger` | `#DC2626` (Red 600) | Error, banned, critical |
| `--surface` | `#1E293B` (Slate 800) | Card/panel background |
| `--background` | `#0F172A` (Slate 900) | Page background |
| `--text-primary` | `#F8FAFC` (Slate 50) | Primary text |
| `--text-secondary` | `#94A3B8` (Slate 400) | Secondary text |
| `--border` | `#334155` (Slate 700) | Borders |

### Typography

| Token | Value |
|-------|-------|
| Font Family | Inter, -apple-system, sans-serif |
| Heading | 600 weight |
| Body | 400 weight |
| Small | 12px |
| Body | 14px |
| H3 | 18px |
| H2 | 24px |
| H1 | 32px |

---

## Acceptance Criteria Dokumen UI/UX

- [x] Sitemap lengkap dengan semua halaman
- [x] Flow diagram untuk setiap journey utama
- [x] Component states untuk semua status
- [x] Responsive breakpoints
- [x] Interaction patterns untuk fitur kritis
- [x] Analytics layout
- [x] Design system tokens
