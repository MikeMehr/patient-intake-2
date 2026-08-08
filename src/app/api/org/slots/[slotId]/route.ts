/**
 * PATCH  /api/org/slots/[slotId] — Toggle slot status (OPEN ↔ BLOCKED)
 * DELETE /api/org/slots/[slotId] — Delete OPEN or BLOCKED slot
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { getOrgAdminContext } from "@/lib/auth-helpers";
import { updateSlotStatus, deleteSlot } from "@/lib/booking-store";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      status = 401;
      return NextResponse.json({ error: "Unauthorized" }, { status });
    }

    const { slotId } = await params;
    const body = await request.json();
    const { slotStatus } = body as { slotStatus?: string };

    if (slotStatus !== "OPEN" && slotStatus !== "BLOCKED") {
      status = 400;
      return NextResponse.json({ error: "slotStatus must be OPEN or BLOCKED" }, { status });
    }

    const updated = await updateSlotStatus(slotId, orgContext.organizationId, slotStatus);
    if (!updated) {
      status = 404;
      return NextResponse.json({ error: "Slot not found or cannot be modified" }, { status });
    }

    logRequestMeta(`/api/org/slots/${slotId}`, requestId, status, Date.now() - started);
    return NextResponse.json({ success: true });
  } catch {
    logRequestMeta(`/api/org/slots/[slotId]`, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slotId: string }> },
) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();

  try {
    const session = await getCurrentSession();
    const orgContext = await getOrgAdminContext(session);
    if (!orgContext) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slotId } = await params;
    const deleted = await deleteSlot(slotId, orgContext.organizationId);

    if (!deleted) {
      return NextResponse.json({ error: "Slot not found or cannot be deleted" }, { status: 404 });
    }

    logRequestMeta(`/api/org/slots/${slotId}`, requestId, 200, Date.now() - started);
    return NextResponse.json({ success: true });
  } catch {
    logRequestMeta(`/api/org/slots/[slotId]`, requestId, 500, Date.now() - started);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
