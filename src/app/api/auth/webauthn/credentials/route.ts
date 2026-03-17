import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { listUserPasskeys, deletePasskey } from "@/lib/auth-webauthn";

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const credentials = await listUserPasskeys({
      userType: session.userType,
      userId: session.userId,
    });

    return NextResponse.json({ credentials });
  } catch (error) {
    console.error("[webauthn/credentials] GET error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { credentialId } = body;

    if (!credentialId || typeof credentialId !== "string") {
      return NextResponse.json({ error: "credentialId is required" }, { status: 400 });
    }

    const deleted = await deletePasskey({
      userType: session.userType,
      userId: session.userId,
      credentialDbId: credentialId,
    });

    if (!deleted) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[webauthn/credentials] DELETE error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
