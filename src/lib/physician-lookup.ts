import { query } from "./db";
import { logDebug } from "./secure-logger";

export interface PhysicianContact {
  id: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Fetch physician's phone number from database
 * @param physicianId - The physician's ID
 * @returns Phone number if available, null otherwise
 */
export async function getPhysicianPhone(
  physicianId: string
): Promise<string | null> {
  try {
    const result = await query(
      `SELECT phone FROM physicians WHERE id = $1 LIMIT 1`,
      [physicianId]
    );

    if (result.rowCount === 0) {
      logDebug("[physician-lookup] Physician not found", {
        physicianId,
      });
      return null;
    }

    const phone = (result.rows[0] as any)?.phone;
    return phone && typeof phone === "string" && phone.trim() ? phone.trim() : null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[physician-lookup] Failed to fetch physician phone", {
      physicianId,
      error: errorMessage,
    });
    return null;
  }
}

/**
 * Fetch physician's contact information
 * @param physicianId - The physician's ID
 * @returns Physician contact object
 */
export async function getPhysicianContact(
  physicianId: string
): Promise<PhysicianContact | null> {
  try {
    const result = await query(
      `SELECT id, phone, first_name, last_name FROM physicians WHERE id = $1 LIMIT 1`,
      [physicianId]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const row = result.rows[0] as any;
    return {
      id: row.id,
      phone: row.phone || null,
      firstName: row.first_name || null,
      lastName: row.last_name || null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDebug("[physician-lookup] Failed to fetch physician contact", {
      physicianId,
      error: errorMessage,
    });
    return null;
  }
}
