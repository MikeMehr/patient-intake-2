import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getAuthUserByTypeAndId } from "@/lib/auth-helpers";
import { verifyAuthentication } from "@/lib/auth-webauthn";
import { consumeDbRateLimit, clearDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";

export async function POST(request: NextRequest) {
  try {
    const ip = getRequestIp(request.headers);
    const bucketKey = `webauthn-login-verify:${ip}`;
    const limiter = await consumeDbRateLimit({
      bucketKey,
      maxAttempts: 10,
      windowSeconds: 15 * 60,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfterSeconds: limiter.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { response, expectedChallenge } = body;

    if (!response || !expectedChallenge) {
      return NextResponse.json({ error: "Response and challenge are required" }, { status: 400 });
    }

    const result = await verifyAuthentication({ response, expectedChallenge });

    if (!result.verified || !result.user) {
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    const user = await getAuthUserByTypeAndId(result.user.userType, result.user.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Create session — same pattern as MFA verify route
    if (result.user.userType === "super_admin") {
      await createSession(user.id, "super_admin", user.username, user.first_name, user.last_name);
    } else if (result.user.userType === "org_admin") {
      await createSession(
        user.id, "org_admin", user.username, user.first_name, user.last_name,
        (user as any).organization_id,
      );
    } else {
      await createSession(
        user.id, "provider", user.username, user.first_name, user.last_name,
        (user as any).organization_id ?? null,
        (user as any).clinic_name,
        (user as any).clinic_address ?? null,
      );
    }

    await clearDbRateLimit(bucketKey);

    const resp: any = {
      success: true,
      userType: result.user.userType,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    };
    if (result.user.userType === "org_admin") {
      resp.organizationId = (user as any).organization_id;
    } else if (result.user.userType === "provider") {
      resp.organizationId = (user as any).organization_id ?? null;
      resp.clinicName = (user as any).clinic_name;
      resp.clinicAddress = (user as any).clinic_address ?? null;
      resp.uniqueSlug = (user as any).unique_slug;
    }

    return NextResponse.json(resp);
  } catch (error) {
    console.error("[webauthn/login/verify] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
