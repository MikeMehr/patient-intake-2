/**
 * GET  /api/booking/manage/[token] — Retrieve appointment details
 * POST /api/booking/manage/[token]/cancel is in the adjacent cancel route
 */

import { NextRequest, NextResponse } from "next/server";
import { hashManageToken } from "@/lib/booking-token";
import { getAppointmentByToken } from "@/lib/booking-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const tokenHash = hashManageToken(token);
  const appointment = await getAppointmentByToken(tokenHash);

  if (!appointment) {
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  // Don't expose health card number via manage link
  return NextResponse.json({
    appointment: {
      ...appointment,
      healthCardNumber: undefined,
    },
  });
}
