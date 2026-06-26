# Quick Start: Address Fix

## 30-Second Overview

Fix orders with incorrect address formats (string vs object) using store data from database.

## Common Tasks

### 👀 See what needs fixing
```bash
npm run fix:addresses:preview
```

### 🔍 Preview changes
```bash
npm run fix:addresses
```

### ⚙️ Apply fixes
```bash
npm run fix:addresses:real
```

## API Usage

### Get report of invalid addresses
```bash
curl -X GET http://localhost:3000/api/mengantar/fix-addresses/report \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Dry run (preview)
```bash
curl -X POST http://localhost:3000/api/mengantar/fix-addresses \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### Apply fixes
```bash
curl -X POST http://localhost:3000/api/mengantar/fix-addresses \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

## What Gets Fixed?

**Invalid addresses** → **Valid addresses**

```
❌ String address          ✅ Object with 14 fields
❌ Missing address         ✅ From store database
❌ Incomplete object       ✅ Proper format
❌ Wrong fields            ✅ Mengantar standard
```

## Common Issues

| Problem | Solution |
|---------|----------|
| "Store not found" | Register store in database first |
| "Invalid address after fix" | Complete store data (address, city, zip) |
| No orders to fix | All addresses already valid |
| API error | Check MENGANTAR_API_KEY in .env |

## Safety Features

✅ **Dry-run** - Preview without changes  
✅ **Confirmation** - Must press ENTER to apply  
✅ **Error isolation** - Process one by one  
✅ **Detailed logging** - Track everything  
✅ **Validation** - Check after fix  

## Process Flow

```
1. Preview (dry-run)
   ↓ See what will change
2. Review report
   ↓ Check for errors
3. Fix store data if needed
   ↓ Complete missing fields
4. Apply fixes
   ↓ Confirm with ENTER
5. Done!
```

## Full Documentation

See `ADDRESS-FIX-README.md` for complete guide

- Installation & setup
- Detailed API docs
- Error handling
- Testing
- Production deployment
- Troubleshooting

## Test It

```bash
# Run tests
npm test src/services/mengantar-address-fixer.test.ts

# Expected: All tests pass
```

## Examples

### Before & After

**Before (❌ Invalid)**
```json
{
  "id": "order-123",
  "pickup_address": "Jl. Main St 123"  // String!
}
```

**After (✅ Valid)**
```json
{
  "id": "order-123",
  "pickup_address": {
    "PICKUP_NAME": "Store Name",
    "PICKUP_PIC": "Admin",
    "PICKUP_PIC_PHONE": "6281234567890",
    "PICKUP_ADDRESS": "Jl. Main St 123",
    "PICKUP_DISTRICT": "Kec. Downtown",
    "PICKUP_SUBDISTRICT": "Kel. Main",
    "PICKUP_REGION": "JAWA TIMUR",
    "PICKUP_CITY": "Surabaya",
    "PICKUP_CITY_SI": "SUB",
    "PICKUP_ZIP": "60123",
    "PICKUP_AUTOFILL": "auto-id",
    "PICKUP_DESTINATION_CODE": "dest-123",
    "PICKUP_FULL_AUTOFILL": "JAWA TIMUR, Surabaya, Kec. Downtown, Kel. Main",
    "isJavaIsland": true
  }
}
```

### Sample Output

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
```

## Tips

1. **Always dry-run first** - See what will happen
2. **Check failed orders** - Fix store data if needed
3. **Run report** - Identify patterns in failures
4. **Off-peak hours** - Recommended for production
5. **Backup database** - Before applying fixes

## Performance

- **1-10 orders** - Seconds
- **10-100 orders** - Minutes
- **100+ orders** - Tens of minutes

Processing is sequential for proper error tracking.

## Need Help?

1. Check error message - Usually tells you what's wrong
2. Run report - Get list of all issues
3. See full docs - `ADDRESS-FIX-README.md`
4. Run tests - Verify system works
5. Check store data - Ensure completeness

---

**Questions?** Check `ADDRESS-FIX-README.md` or create an issue.
