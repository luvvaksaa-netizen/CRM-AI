# Orders Sorting + Data Validation - Quick Start Guide

## 🚀 What Was Implemented?

Your Mengantar Orders management now has:
1. **Smart Sorting** - Orders automatically sorted by Status → Date → Store Name
2. **Address Validation** - Each order shows if the address is complete and valid
3. **Admin Audit** - New endpoint to check all addresses at once

---

## 📁 What Files Were Changed?

### Backend (3 files)
| File | Type | What Changed |
|------|------|--------------|
| `backend/src/services/mengantar-address.validator.ts` | NEW | Validation logic |
| `backend/src/controllers/mengantar.controller.ts` | UPDATED | Sorting + validation in getOrders(), new auditOrders() |
| `backend/src/routes/mengantar.routes.ts` | UPDATED | Added /audit route |

### Frontend (1 file)
| File | Type | What Changed |
|------|------|--------------|
| `frontend/src/pages/Orders.tsx` | UPDATED | Sorting info, validation badges, address column |

---

## 🎯 For End Users

### View Orders with Automatic Sorting
1. Go to Orders page
2. Orders appear sorted automatically by:
   - **First:** Status (Pending orders first)
   - **Then:** Date (newest first)
   - **Finally:** Store name (A-Z)

### Check Address Validity
Each order row shows an Address column with:
- ✅ **OK** - Address is complete and valid
- ❌ **Invalid** - Address is missing fields
  - Hover over ❌ to see what's missing

### See Invalid Count
Look for the warning at the top:
```
⚠️ X orders dengan address invalid
```
Shows how many orders have address issues.

---

## 🔧 For Developers

### Using the Validation Service

```typescript
import { validateMengantarAddress } from './services/mengantar-address.validator';

// Check if an address is valid
const result = validateMengantarAddress(order.pickup_address);

if (result.valid) {
  console.log('✅ Address is complete');
} else {
  console.log('❌ Issues found:', result.errors);
  // Example errors: ["PICKUP_ZIP must be exactly 5 digits", "PICKUP_CITY required"]
}
```

### Running the Audit

```bash
# Terminal (with admin token)
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/api/mengantar/audit
```

Response:
```json
{
  "success": true,
  "audit": {
    "totalOrders": 150,
    "validAddresses": 145,
    "invalidAddresses": 5,
    "errors": [
      {
        "orderId": "order-123",
        "errors": ["PICKUP_ZIP must be exactly 5 digits"]
      }
    ]
  }
}
```

---

## 📊 Sorting Algorithm Explained

```
Orders → Sort by Priority

Priority 1: Status
  pending (1)
  ↓ processing (2)
  ↓ picked (3)
  ↓ in_transit (4)
  ↓ delivered (5)

Priority 2: Within same status, sort by Date
  Newest first (using createdAt, updatedAt, or lastStatusChange)

Priority 3: Within same status+date, sort by Store Name
  Alphabetically (A → Z)
```

**Result:** Orders appear in the most logical order for business:
- Active/urgent orders first (pending status)
- Most recent orders first (within same status)
- Easy to scan by store (alphabetical within same status+date)

---

## ✅ Validation Fields Checked

Each address is validated for these 13 fields:

| Field | Type | Example |
|-------|------|---------|
| PICKUP_NAME | String | "Toko Utama" |
| PICKUP_PIC | String | "Budi" |
| PICKUP_PIC_PHONE | Phone | "081234567890" |
| PICKUP_ADDRESS | String | "Jl. Merdeka No. 123" |
| PICKUP_DISTRICT | String | "Kec. Pusat" |
| PICKUP_SUBDISTRICT | String | "Kel. Utama" |
| PICKUP_REGION | String | "Provinsi Jawa Timur" |
| PICKUP_CITY | String | "Kediri" |
| PICKUP_CITY_SI | String | "KEDIRI" |
| PICKUP_ZIP | 5 digits | "64112" |
| isJavaIsland | Boolean | true/false |

**Special Validations:**
- ZIP must be exactly 5 digits (not 4, not 6)
- Phone must be in valid phone format

---

## 🧪 Testing the Features

### Test 1: See the Sorting
1. Open Orders page
2. Look at top: `📊 Sorted by: Status → Date (newest) → Toko`
3. Verify pending orders appear first
4. Verify within same status, newest dates come first

### Test 2: See Address Validation
1. Look at table's "Address" column
2. Some orders show ✅ OK (green)
3. Some orders show ❌ Invalid (red)
4. Hover over ❌ to see the error message

### Test 3: Count Invalid Addresses
1. Look at the info line at top
2. If any invalid, you'll see: `⚠️ X orders dengan address invalid`
3. This count matches the number of ❌ badges

### Test 4: Admin Audit (Backend)
1. Open browser console or terminal
2. Curl the audit endpoint
3. See statistics of all orders' addresses
4. See list of invalid orders with error reasons

---

## 🔄 How It Works Behind the Scenes

### Backend Flow
```
1. API Request comes in: GET /api/mengantar/orders
   ↓
2. Fetch orders from Mengantar API
   ↓
3. Map to CRM contacts & stores
   ↓
4. Validate address for each order (NEW)
   ├─ Check all 13 fields
   ├─ Add _addressValidation to order
   ↓
5. Sort orders (NEW)
   ├─ Primary: status (1-5)
   ├─ Secondary: date (newest first)
   ├─ Tertiary: store name (A-Z)
   ↓
6. Return sorted + validated orders
```

### Frontend Flow
```
1. Receive orders with _addressValidation
   ↓
2. Count invalid addresses (NEW)
   ├─ Display warning if count > 0
   ↓
3. Display sorting info (NEW)
   ├─ Show "Sorted by: Status → Date → Toko"
   ↓
4. Render table rows
   ├─ For each order:
   │  ├─ Show existing columns (Resi, Penerima, etc)
   │  ├─ Show new Address column (NEW)
   │  │  └─ Show ✅ OK or ❌ Invalid badge
   │  └─ Show Status column as before
```

---

## 📝 Common Questions

**Q: Why is order X showing ❌ Invalid?**
A: Hover over the badge to see which field(s) are missing or invalid.

**Q: Can I still process orders with ❌ Invalid?**
A: Yes, the validation is informational. Orders can still be processed, but the address data should be corrected.

**Q: Why are my orders sorted differently than before?**
A: They're now using the new smart sort: Status → Date → Store. This ensures urgent orders appear first.

**Q: How often are addresses validated?**
A: Every time you load the Orders page. It's real-time.

**Q: Can I customize the sorting?**
A: Yes, edit `mengantar.controller.ts` line 125-131 to change priority.

**Q: Where is the audit endpoint?**
A: `GET /api/mengantar/audit` (admin only). Returns counts and details of invalid addresses.

---

## 🚀 Next Steps

1. **Test in Development**
   - Load Orders page
   - Verify sorting works
   - Check validation badges
   - Try audit endpoint

2. **Deploy to Production**
   - Deploy backend code
   - Deploy frontend code
   - No database migration needed
   - Monitor logs initially

3. **Monitor & Improve**
   - Check address validation badges for patterns
   - Use audit endpoint to identify systematic issues
   - Consider adding address correction workflow

---

## 📞 Need Help?

Check these files for more details:
- **Full Implementation Guide:** `IMPLEMENTATION_SUMMARY.md`
- **Test Cases:** `ORDERS_SORTING_VALIDATION_TEST.md`
- **Complete Checklist:** `IMPLEMENTATION_COMPLETE.txt`

---

**Status:** ✅ Ready to Use
**Version:** 1.0
**Last Updated:** 2026-06-25
