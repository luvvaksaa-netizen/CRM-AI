/**
 * @file fix-order-addresses.ts
 * @description Script untuk memperbaiki format address yang salah pada existing orders
 *
 * Usage:
 *   npm run fix:addresses          - Dry run (preview)
 *   npm run fix:addresses:real     - Actual fix (requires confirmation)
 *   npm run fix:addresses:report   - Generate report only
 */

import { MengantarAddressFixer } from "../services/mengantar-address-fixer";
import { sequelize } from "../config/database";

const fixer = new MengantarAddressFixer();

async function confirmAction(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("\n⚠️  Press ENTER to continue, or Ctrl+C to cancel...\n");
    process.stdin.once("data", () => {
      resolve(true);
    });
    setTimeout(() => {
      resolve(false);
    }, 30000); // 30 second timeout
  });
}

async function runDryRun(): Promise<void> {
  console.log("\n=== 📋 DRY RUN - Preview Changes ===\n");

  const result = await fixer.batchFixOrders(true);

  console.log("\n📊 Summary:");
  console.log(`  Total to process: ${result.totalProcessed}`);
  console.log(`  Would succeed: ${result.successful}`);
  console.log(`  Would fail: ${result.failed}`);
  console.log(`  Success rate: ${((result.successful / result.totalProcessed) * 100).toFixed(1)}%`);

  if (result.failed > 0) {
    console.log("\n❌ Sample Failures (first 5):");
    result.results
      .filter((r) => !r.success)
      .slice(0, 5)
      .forEach((r) => {
        console.log(`  - ${r.orderId}: ${r.error}`);
      });
  }

  if (result.successful > 0) {
    console.log("\n✅ Sample Successes (first 5):");
    result.results
      .filter((r) => r.success)
      .slice(0, 5)
      .forEach((r) => {
        console.log(`  ✓ ${r.orderId}`);
      });
  }

  if (result.totalProcessed === 0) {
    console.log("\n✨ No orders need fixing!");
  }
}

async function runActualFix(): Promise<void> {
  console.log("\n=== ⚙️  ACTUAL FIX - Applying Changes ===\n");

  const confirmed = await confirmAction();
  if (!confirmed) {
    console.log("\n❌ Cancelled by user");
    return;
  }

  const result = await fixer.batchFixOrders(false);

  console.log("\n✅ Fix Complete!");
  console.log(`\n📊 Results:`);
  console.log(`  Total Processed: ${result.totalProcessed}`);
  console.log(`  Successful: ${result.successful}`);
  console.log(`  Failed: ${result.failed}`);
  console.log(`  Success rate: ${((result.successful / result.totalProcessed) * 100).toFixed(1)}%`);

  if (result.failed > 0) {
    console.log("\n❌ Failed orders:");
    result.results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`  - ${r.orderId}: ${r.error}`);
      });
  }

  if (result.successful > 0) {
    console.log("\n✅ Fixed orders:");
    result.results
      .filter((r) => r.success)
      .slice(0, 10)
      .forEach((r) => {
        console.log(`  ✓ ${r.orderId}`);
      });

    if (result.successful > 10) {
      console.log(`  ... and ${result.successful - 10} more`);
    }
  }
}

async function runReport(): Promise<void> {
  console.log("\n=== 📋 INVALID ADDRESSES REPORT ===\n");

  const report = await fixer.getInvalidAddressesReport();

  console.log(`📊 Summary:`);
  console.log(`  Total invalid: ${report.invalid}`);

  if (report.details.length === 0) {
    console.log("\n✨ No invalid addresses found!");
    return;
  }

  console.log(`\n❌ Details (first 20):`);
  report.details.slice(0, 20).forEach((detail) => {
    console.log(`\n  Order: ${detail.orderId}`);
    console.log(`  Reason: ${detail.reason}`);
    console.log(
      `  Current Address: ${JSON.stringify(detail.address).substring(0, 80)}...`,
    );
  });

  if (report.details.length > 20) {
    console.log(
      `\n  ... and ${report.details.length - 20} more invalid addresses`,
    );
  }
}

async function main(): Promise<void> {
  try {
    // Initialize database connection
    console.log("🔌 Connecting to database...");
    await sequelize.authenticate();
    console.log("✅ Database connected\n");

    const command = process.argv[2] || "dry-run";

    switch (command.toLowerCase()) {
      case "dry-run":
      case "preview":
        await runDryRun();
        break;

      case "fix":
      case "real":
      case "actual":
        await runActualFix();
        break;

      case "report":
        await runReport();
        break;

      default:
        console.log(`\n❌ Unknown command: ${command}`);
        console.log("\nAvailable commands:");
        console.log("  dry-run     - Preview changes (default)");
        console.log("  fix         - Apply actual fixes");
        console.log("  report      - Generate report of invalid addresses");
        process.exit(1);
    }

    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
