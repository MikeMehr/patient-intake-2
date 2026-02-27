import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getAuthUserByTypeAndId } from "@/lib/auth-helpers";
import { consumeVerifiedMfaChallenge, verifyMfaChallenge } from "@/lib/auth-mfa";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";

const MFA_VERIFY_MAX_ATTEMPTS = 10;
const MFA_VERIFY_WINDOW_SECONDS = 15 * 60;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      challengeToken?: string;
      otpCode?: string;
    };
    const challengeToken = (body.challengeToken || "").trim();
    const otpCode = (body.otpCode || "").trim();
    if (!challengeToken || !otpCode) {
      return NextResponse.json(
        { error: "Challenge token and code are required" },
        { status: 400 },
      );
    }

    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `auth-login-mfa-verify:${ip}:${challengeToken.slice(0, 16)}`,
      maxAttempts: MFA_VERIFY_MAX_ATTEMPTS,
      windowSeconds: MFA_VERIFY_WINDOW_SECONDS,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        {
          error: "Too many verification attempts. Please try again later.",
          retryAfterSeconds: limiter.retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    const verification = await verifyMfaChallenge({
      challengeToken,
      otpCode,
      purpose: "login",
    });
    if (!verification.ok) {
      return NextResponse.json(
        { error: "Invalid or expired verification code" },
        { status: 400 },
      );
    }

    const consumed = await consumeVerifiedMfaChallenge({
      challengeToken,
      purpose: "login",
    });
    if (!consumed.ok || !consumed.user) {
      return NextResponse.json(
        { error: "Verification could not be completed" },
        { status: 400 },
      );
    }

    const user = await getAuthUserByTypeAndId(consumed.user.userType, consumed.user.userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (consumed.user.userType === "super_admin") {
      await createSession(
        user.id,
        "super_admin",
        user.username,
        user.first_name,
        user.last_name,
      );
    } else if (consumed.user.userType === "org_admin") {
      await createSession(
        user.id,
        "org_admin",
        user.username,
        user.first_name,
        user.last_name,
        (user as any).organization_id,
      );
    } else {
      await createSession(
        user.id,
        "provider",
        user.username,
        user.first_name,
        user.last_name,
        (user as any).organization_id ?? null,
        (user as any).clinic_name,
        (user as any).clinic_address ?? null,
      );
    }

    const response: any = {
      success: true,
      userType: consumed.user.userType,
      user: {
        id: user.id,
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
      },
    };
    if (consumed.user.userType === "org_admin") {
      response.organizationId = (user as any).organization_id;
    } else if (consumed.user.userType === "provider") {
      response.organizationId = (user as any).organization_id ?? null;
      response.clinicName = (user as any).clinic_name;
      response.clinicAddress = (user as any).clinic_address ?? null;
      response.uniqueSlug = (user as any).unique_slug;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[auth/login/mfa/verify] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
