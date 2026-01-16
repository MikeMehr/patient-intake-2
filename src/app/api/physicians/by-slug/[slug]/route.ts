/**
 * GET /api/physicians/by-slug/[slug]
 * Get physician information by unique slug
 */

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const result = await query<{
      id: string;
      first_name: string;
      last_name: string;
      clinic_name: string;
    }>(
      `SELECT id, first_name, last_name, clinic_name
       FROM physicians
       WHERE unique_slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Physician not found" },
        { status: 404 }
      );
    }

    const physician = result.rows[0];

    return NextResponse.json({
      physician: {
        id: physician.id,
        firstName: physician.first_name,
        lastName: physician.last_name,
        clinicName: physician.clinic_name,
      },
    });
  } catch (error) {
    console.error("[physicians/by-slug] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

