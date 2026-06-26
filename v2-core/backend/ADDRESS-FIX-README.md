# Mengantar Order Address Fix

Dokumentasi lengkap untuk memperbaiki format address yang salah pada existing orders di sistem Mengantar.

## 📋 Overview

Sistem ini dirancang untuk:
- **Mendeteksi** format address yang salah (string vs object, missing fields)
- **Memperbaiki** address orders menggunakan data store dari database
- **Validasi** address setelah fix menggunakan Mengantar format validator
- **Dry-run** capability untuk preview perubahan sebelum eksekusi
- **Comprehensive logging** untuk audit trail

## 🏗️ Arsitektur

```
mengantar-address-fixer.ts
  ├─ detectInvalidAddressFormat()    : Deteksi format salah
  ├─ fixOrderAddress()               : Fix single order
  ├─ batchFixOrders()                : Fix multiple orders
  ├─ getInvalidAddressesReport()     : Generate report
  └─ Private helpers                 : buildMengantarAddress(), updateOrderAtMengantar()

API Endpoints (mengantar.controller.ts)
  ├─ GET  /api/mengantar/fix-addresses/report  : Dapatkan laporan issues
  └─ POST /api/mengantar/fix-addresses          : Eksekusi fix (dryRun supported)

Script (fix-order-addresses.ts)
  ├─ Command: dry-run   : Preview changes
  ├─ Command: fix       : Apply actual fixes (with confirmation)
  └─ Command: report    : Generate report only
```

## 🔧 Installation & Setup

### 1. Files Created

```
backend/src/services/mengantar-address-fixer.ts  → Main service class
backend/src/scripts/fix-order-addresses.ts        → CLI script
backend/src/controllers/mengantar.controller.ts   → Updated with new endpoints
backend/src/routes/mengantar.routes.ts            → Updated with new routes
backend/test/services/mengantar-address-fixer.test.ts → Test suite
```

### 2. Add Scripts to package.json

```json
{
  "scripts": {
    "fix:addresses": "ts-node src/scripts/fix-order-addresses.ts dry-run",
    "fix:addresses:preview": "ts-node src/scripts/fix-order-addresses.ts report",
    "fix:addresses:real": "ts-node src/scripts/fix-order-addresses.ts fix"
  }
}
```

### 3. Environment Variables

Pastikan sudah terkonfigurasi di `.env`:

```env
MENGANTAR_API_KEY=your_api_key_here
MENGANTAR_ADDRESS_ID=your_address_id_here
MENGANTAR_COURIER=JT  # atau JNE, Sap, dll
```

## 📖 Usage

### Via CLI Script

#### 1. **Preview Changes (Dry Run)**
```bash
npm run fix:addresses
# atau
npm run fix:addresses:preview
```

Output:
```
=== 📋 DRY RUN - Preview Changes ===

📊 Summary:
  Total to process: 125
  Would succeed: 120
  Would fail: 5
  Success rate: 96.0%

❌ Sample Failures (first 5):
  - order-001: Store not found (wa_id: 628123456789)
  - order-002: Invalid address format after fix: PICKUP_ZIP must be exactly 5 digits

✅ Sample Successes (first 5):
  ✓ order-123
  ✓ order-124
  ✓ order-125
  ...
```

#### 2. **Generate Report**
```bash
npm run fix:addresses:preview
```

Output:
```
=== 📋 INVALID ADDRESSES REPORT ===

📊 Summary:
  Total invalid: 125

❌ Details (first 20):

  Order: order-001
  Reason: Address is string instead of object
  Current Address: "Jl. Main St 123"

  Order: order-002
  Reason: Missing fields: PICKUP_PIC_PHONE, PICKUP_DISTRICT
  Current Address: {"PICKUP_NAME":"Store",...}

  ... and 105 more invalid addresses
```

#### 3. **Apply Actual Fix (Requires Confirmation)**
```bash
npm run fix:addresses:real
```

Output:
```
=== ⚙️  ACTUAL FIX - Applying Changes ===

⚠️  Press ENTER to continue, or Ctrl+C to cancel...

✅ Fix Complete!

📊 Results:
  Total Processed: 125
  Successful: 120
  Failed: 5
  Success rate: 96.0%

❌ Failed orders:
  - order-001: Store not found (wa_id: 628123456789)
  - order-002: Invalid address format after fix: PICKUP_ZIP must be exactly 5 digits

✅ Fixed orders:
  ✓ order-123
  ✓ order-124
  ✓ order-125
  ... and 117 more
```

### Via API Endpoints

#### 1. **Get Report**
```http
GET /api/mengantar/fix-addresses/report
Authorization: Bearer {admin_token}
```

Response:
```json
{
  "success": true,
  "data": {
    "total": 125,
    "invalid": 125,
    "details": [
      {
        "orderId": "order-001",
        "reason": "Address is string instead of object",
        "address": "Jl. Main St 123"
      },
      {
        "orderId": "order-002",
        "reason": "Missing fields: PICKUP_DISTRICT",
        "address": {
          "PICKUP_NAME": "Store"
        }
      }
    ]
  },
  "message": "Found 125 orders with invalid address format"
}
```

#### 2. **Dry Run (Preview)**
```http
POST /api/mengantar/fix-addresses
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "dryRun": true
}
```

Response:
```json
{
  "success": true,
  "dryRun": true,
  "data": {
    "totalProcessed": 125,
    "successful": 120,
    "failed": 5,
    "dryRun": true,
    "executedAt": "2024-01-15T10:30:00.000Z",
    "results": [
      {
        "orderId": "order-123",
        "success": true
      },
      {
        "orderId": "order-001",
        "success": false,
        "error": "Store not found (wa_id: 628123456789)"
      }
    ]
  },
  "message": "[DRY RUN] Would fix 120/125 orders"
}
```

#### 3. **Apply Fix**
```http
POST /api/mengantar/fix-addresses
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "dryRun": false
}
```

Response:
```json
{
  "success": true,
  "dryRun": false,
  "data": {
    "totalProcessed": 125,
    "successful": 120,
    "failed": 5,
    "dryRun": false,
    "executedAt": "2024-01-15T10:35:00.000Z",
    "results": [
      {
        "orderId": "order-123",
        "success": true
      }
    ]
  },
  "message": "Fixed 120/125 orders successfully"
}
```

## 🔍 How It Works

### Address Detection Logic

An address is considered **INVALID** if:

1. **Type is string** instead of object
   ```typescript
   // Invalid
   pickup_address: "Jl. Main St 123"
   
   // Valid
   pickup_address: { PICKUP_NAME: "Store", ... }
   ```

2. **Missing entirely**
   ```typescript
   // Invalid - no pickup_address or PICKUP_ADDRESS field
   order = { id: "123", ... }
   ```

3. **Object exists but missing required fields**
   ```typescript
   // Invalid - missing PICKUP_PIC_PHONE, PICKUP_DISTRICT
   pickup_address: {
     PICKUP_NAME: "Store",
     PICKUP_ADDRESS: "Jl. Main St"
   }
   ```

### Fix Process

1. **Extract store info** dari database berdasarkan `wa_id` order
2. **Build proper address** menggunakan template Mengantar
3. **Validate** hasil fix terhadap format validator
4. **Update at Mengantar API** (if mengantar_id tersedia)
5. **Log hasil** untuk audit trail

### Address Template

Setiap order yang di-fix akan menggunakan struktur ini:

```typescript
MengantarAddress = {
  PICKUP_NAME: store.store_name || store.name,
  PICKUP_PIC: store.pickup_pic || "Admin",
  PICKUP_PIC_PHONE: store.phone (digits only),
  PICKUP_ADDRESS: store.address,
  PICKUP_DISTRICT: store.district,
  PICKUP_SUBDISTRICT: store.subdistrict,
  PICKUP_REGION: store.region,
  PICKUP_CITY: store.city,
  PICKUP_CITY_SI: store.city_si || store.city,
  PICKUP_ZIP: store.zip,
  PICKUP_AUTOFILL: store.autofill_id,
  PICKUP_DESTINATION_CODE: store.destination_code,
  PICKUP_FULL_AUTOFILL: "${region}, ${city}, ${district}, ${subdistrict}",
  isJavaIsland: boolean (if region is in Java)
}
```

## ⚠️ Error Handling

### Common Errors

| Error | Cause | Solusi |
|-------|-------|--------|
| `Store not found (wa_id: ...)` | Store tidak terdaftar di database | Register store di database dulu |
| `Store WA ID not found in order` | Order tidak memiliki mapping store | Pastikan order memiliki `crm_mapped_contact.store_wa_id` |
| `Invalid address format after fix: PICKUP_ZIP must be exactly 5 digits` | Store data incomplete/invalid | Lengkapi data store di database |
| `MENGANTAR_API_KEY not configured` | API key tidak set di env | Setup `MENGANTAR_API_KEY` di `.env` |
| `Failed to update order at Mengantar: ...` | Mengantar API error (non-fatal) | Local fix tetap berhasil, API update gagal |

### Dry-Run Best Practices

Selalu lakukan dry-run dulu sebelum fix aktual:

```bash
# Step 1: Preview
npm run fix:addresses

# Step 2: Check failed orders
npm run fix:addresses:preview

# Step 3: Resolve issues atau adjust Store data

# Step 4: Apply fix
npm run fix:addresses:real
```

## 🧪 Testing

### Run Tests

```bash
npm test src/services/mengantar-address-fixer.test.ts
```

### Test Coverage

Test suite mencakup:

```
✓ detectInvalidAddressFormat()
  ✓ Detect string address as invalid
  ✓ Detect missing address as invalid
  ✓ Detect object with missing required fields as invalid
  ✓ Accept valid address format
  ✓ Use PICKUP_ADDRESS fallback
  ✓ Handle edge cases (null, empty object, number, array)

✓ fixOrderAddress()
  ✓ Fail when store WA ID not found
  ✓ Handle dryRun mode correctly

✓ batchFixOrders()
  ✓ Return correct structure
  ✓ Respect dryRun flag

✓ getInvalidAddressesReport()
  ✓ Return report structure
  ✓ Include error reasons

✓ Integration scenarios
  ✓ Handle mixed valid and invalid orders
  ✓ Maintain order integrity during processing
```

## 📊 Monitoring & Logs

### Log Levels

Setiap operasi mencatat ke console dengan prefix:

```
[MengantarAddressFixer] - Info level
[ERROR] - Error level
[DRY RUN] - Dry run indicator
[FIX] - Actual fix indicator
```

### Example Logs

```
🔌 Connecting to database...
✅ Database connected

[MengantarAddressFixer] Starting batch fix (dryRun: true)...
[MengantarAddressFixer] Found 125 orders needing fix

[DRY RUN] Would fix order: order-123
[ERROR] Failed to fix order order-001: Store not found (wa_id: 628123456789)
[DRY RUN] Would fix order: order-124

[MengantarAddressFixer] Batch fix complete: 120 successful, 5 failed
```

## 🚀 Production Deployment

### Pre-Deployment Checklist

- [ ] Run dry-run in staging environment
- [ ] Verify no critical failures
- [ ] Backup database
- [ ] Review failed orders list
- [ ] Prepare rollback plan
- [ ] Notify stakeholders
- [ ] Execute on production (off-peak hours recommended)

### Rollback Strategy

Jika ada issue setelah fix:

```bash
# Option 1: Fix spesific failed orders
POST /api/mengantar/fix-addresses/report
# Identify specific order IDs

# Option 2: Contact Mengantar support untuk restore dari backup
# Orders yang di-fix via API mungkin bisa di-revert

# Option 3: Restore database dari backup pre-fix
```

## 📝 Notes

- Dry-run tidak mengubah data, hanya preview
- Proses batch satu per satu untuk error isolation
- Jika Mengantar API unavailable, local fix tetap berhasil
- Failed orders di-log untuk investigation manual
- Semua changes di-timestamp untuk audit trail

## 🆘 Troubleshooting

### Script tidak jalan

```bash
# Check Node version
node --version

# Check TypeScript compilation
npx tsc --noEmit

# Run dengan verbose logging
DEBUG=* npm run fix:addresses
```

### Database connection error

```bash
# Verify DATABASE_URL in .env
echo $DATABASE_URL

# Test connection
npx sequelize-cli db:authenticate
```

### Address fix gagal untuk semua orders

```bash
# Verify Mengantar config
curl -X GET http://localhost:3000/api/mengantar/config \
  -H "Authorization: Bearer {token}"

# Check store data completeness
SELECT * FROM Stores WHERE address IS NULL OR city IS NULL LIMIT 5;
```

## 📞 Support

Untuk issues atau questions:
1. Check logs di `backend/logs/`
2. Run report untuk identify pattern
3. Verify Store data completeness
4. Contact Mengantar API support jika API errors
