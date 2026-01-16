import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";

// Protect this endpoint with a shared secret provided via header
const HEADER_NAME = "x-cron-secret";

export async function POST(request: NextRequest) {
  const secret = request.headers.get(HEADER_NAME);
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Delete invitations older than 4 hours based on sent_at (fallback to created_at)
    const result = await query(
      `DELETE FROM patient_invitations
       WHERE COALESCE(sent_at, created_at, NOW()) < NOW() - INTERVAL '4 hours'
       RETURNING id`,
    );

    return NextResponse.json({ deleted: result.rowCount });
  } catch (error) {
    console.error("[invitations/cleanup] Error deleting old invitations", error);
    return NextResponse.json({ error: "Failed to cleanup invitations" }, { status: 500 });
  }
}

