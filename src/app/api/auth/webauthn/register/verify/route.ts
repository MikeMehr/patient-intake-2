import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { verifyRegistration } from "@/lib/auth-webauthn";
import { consumeDbRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limiter = await consumeDbRateLimit({
      bucketKey: `webauthn-reg-verify:${session.userId}`,
      maxAttempts: 5,
      windowSeconds: 15 * 60,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfterSeconds: limiter.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { response, expectedChallenge, deviceName } = body;

    if (!response || !expectedChallenge) {
      return NextResponse.json({ error: "Response and challenge are required" }, { status: 400 });
    }

    const result = await verifyRegistration({
      userType: session.userType,
      userId: session.userId,
      response,
      expectedChallenge,
      deviceName: typeof deviceName === "string" ? deviceName.trim().slice(0, 100) : undefined,
    });

    if (!result.verified) {
      return NextResponse.json({ error: "Registration verification failed" }, { status: 400 });
    }

    return NextResponse.json({ success: true, credentialId: result.credentialId });
  } catch (error) {
    console.error("[webauthn/register/verify] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
