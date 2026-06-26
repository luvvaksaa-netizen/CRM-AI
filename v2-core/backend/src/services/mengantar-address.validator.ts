/**
 * @file mengantar-address.validator.ts
 * @description Address validation and mapping for Mengantar shipments
 *
 * Provides:
 * - Mengantar address format validation
 * - CRM address to Mengantar address mapping
 * - Order address audit functionality
 */

/**
 * Mengantar address interface defining the required fields
 */
export interface MengantarAddress {
  PICKUP_NAME: string;
  PICKUP_PIC: string;
  PICKUP_PIC_PHONE: string;
  PICKUP_ADDRESS: string;
  PICKUP_DISTRICT: string;
  PICKUP_SUBDISTRICT: string;
  PICKUP_REGION: string;
  PICKUP_CITY: string;
  PICKUP_CITY_SI: string;
  PICKUP_ZIP: string;
  PICKUP_AUTOFILL: string;
  PICKUP_DESTINATION_CODE: string;
  PICKUP_FULL_AUTOFILL: string;
  isJavaIsland: boolean;
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Audit result interface
 */
export interface AuditResult {
  totalOrders: number;
  validAddresses: number;
  invalidAddresses: number;
  errors: Array<{
    orderId: string;
    errors: string[];
  }>;
}

/**
 * Validate Mengantar address format
 * Checks required fields and format constraints
 *
 * @param addr - Address object to validate
 * @returns Validation result with boolean valid flag and error messages
 */
export function validateMengantarAddress(
  addr: any,
): ValidationResult {
  const errors: string[] = [];

  if (!addr) {
    errors.push("Address object is required");
    return { valid: false, errors };
  }

  // Required string fields
  if (!addr.PICKUP_NAME?.trim()) {
    errors.push("PICKUP_NAME required");
  }

  if (!addr.PICKUP_PIC?.trim()) {
    errors.push("PICKUP_PIC required");
  }

  if (!addr.PICKUP_PIC_PHONE?.trim()) {
    errors.push("PICKUP_PIC_PHONE required");
  } else if (!/^[\d+\-\s()]+$/.test(addr.PICKUP_PIC_PHONE)) {
    errors.push("PICKUP_PIC_PHONE must be valid phone format");
  }

  if (!addr.PICKUP_ADDRESS?.trim()) {
    errors.push("PICKUP_ADDRESS required");
  }

  if (!addr.PICKUP_DISTRICT?.trim()) {
    errors.push("PICKUP_DISTRICT required");
  }

  if (!addr.PICKUP_SUBDISTRICT?.trim()) {
    errors.push("PICKUP_SUBDISTRICT required");
  }

  if (!addr.PICKUP_REGION?.trim()) {
    errors.push("PICKUP_REGION required");
  }

  if (!addr.PICKUP_CITY?.trim()) {
    errors.push("PICKUP_CITY required");
  }

  if (!addr.PICKUP_CITY_SI?.trim()) {
    errors.push("PICKUP_CITY_SI required");
  }

  if (!addr.PICKUP_ZIP?.trim()) {
    errors.push("PICKUP_ZIP required");
  } else if (!/^\d{5}$/.test(addr.PICKUP_ZIP.toString().trim())) {
    errors.push("PICKUP_ZIP must be exactly 5 digits");
  }

  if (
    typeof addr.isJavaIsland !== "boolean" &&
    addr.isJavaIsland !== "true" &&
    addr.isJavaIsland !== "false"
  ) {
    errors.push("isJavaIsland must be boolean");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Map CRM order to Mengantar address format
 * Converts order data to proper Mengantar address object
 *
 * @param order - Order object from CRM
 * @param pickupAddress - Optional pre-formatted pickup address
 * @returns Mengantar address object or null if mapping fails
 */
export function mapCRMAddressToMengantar(
  order: any,
  pickupAddress?: any,
): MengantarAddress | null {
  try {
    // Use provided pickupAddress or extract from order
    const addr = pickupAddress || order.pickup_address || order.PICKUP_ADDRESS;

    if (!addr) {
      return null;
    }

    // Create mapped address object
    const mapped: any = {
      PICKUP_NAME: addr.PICKUP_NAME || order.store_name || "",
      PICKUP_PIC: addr.PICKUP_PIC || order.contact_name || "",
      PICKUP_PIC_PHONE: addr.PICKUP_PIC_PHONE || order.phone || "",
      PICKUP_ADDRESS: addr.PICKUP_ADDRESS || order.address || "",
      PICKUP_DISTRICT: addr.PICKUP_DISTRICT || "",
      PICKUP_SUBDISTRICT: addr.PICKUP_SUBDISTRICT || "",
      PICKUP_REGION: addr.PICKUP_REGION || "",
      PICKUP_CITY: addr.PICKUP_CITY || "",
      PICKUP_CITY_SI: addr.PICKUP_CITY_SI || "",
      PICKUP_ZIP: addr.PICKUP_ZIP || "",
      PICKUP_AUTOFILL: addr.PICKUP_AUTOFILL || "",
      PICKUP_DESTINATION_CODE: addr.PICKUP_DESTINATION_CODE || "",
      PICKUP_FULL_AUTOFILL: addr.PICKUP_FULL_AUTOFILL || "",
      isJavaIsland: Boolean(addr.isJavaIsland),
    };

    return mapped as MengantarAddress;
  } catch (error) {
    console.error("[mapCRMAddressToMengantar] Error:", error);
    return null;
  }
}

/**
 * Validate address field completeness
 * Lightweight check for basic presence of address data
 *
 * @param addr - Address object to check
 * @returns Validation result
 */
export function validateAddressCompleteness(addr: any): ValidationResult {
  const errors: string[] = [];

  const requiredFields = [
    "PICKUP_NAME",
    "PICKUP_ADDRESS",
    "PICKUP_CITY",
    "PICKUP_ZIP",
  ];

  for (const field of requiredFields) {
    if (!addr?.[field]) {
      errors.push(`${field} is missing`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Audit order addresses (stub for backend integration)
 * This would be called to check all existing orders in the system
 *
 * @returns Promise with audit results
 */
export async function auditOrderAddresses(): Promise<AuditResult> {
  try {
    // This function would integrate with the database to fetch all orders
    // For now, returning a template structure that can be implemented
    // when integrated with actual Order model

    return {
      totalOrders: 0,
      validAddresses: 0,
      invalidAddresses: 0,
      errors: [],
    };
  } catch (error) {
    console.error("[auditOrderAddresses] Error:", error);
    return {
      totalOrders: 0,
      validAddresses: 0,
      invalidAddresses: 0,
      errors: [],
    };
  }
}

/**
 * Batch validate addresses
 * Validates multiple addresses and returns results per address
 *
 * @param addresses - Array of addresses to validate
 * @returns Array of validation results with indices
 */
export function batchValidateAddresses(
  addresses: any[],
): Array<{ index: number; validation: ValidationResult }> {
  return addresses.map((addr, index) => ({
    index,
    validation: validateMengantarAddress(addr),
  }));
}

/**
 * Get validation summary
 * Counts valid vs invalid addresses from batch validation results
 *
 * @param results - Batch validation results
 * @returns Summary with counts
 */
export function getValidationSummary(
  results: Array<{ index: number; validation: ValidationResult }>,
): { valid: number; invalid: number; total: number } {
  const valid = results.filter((r) => r.validation.valid).length;
  const invalid = results.length - valid;

  return {
    valid,
    invalid,
    total: results.length,
  };
}
