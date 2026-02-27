import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getAuthUserByTypeAndId } from "@/lib/auth-helpers";
import { consumeBackupCodeForChallenge } from "@/lib/auth-mfa";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";

const MFA_RECOVERY_MAX_ATTEMPTS = 10;
const MFA_RECOVERY_WINDOW_SECONDS = 15 * 60;

async function createLoginSuccessResponse(userType: "provider" | "org_admin" | "super_admin", userId: string) {
  const user = await getAuthUserByTypeAndId(userType, userId);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (userType === "super_admin") {
    await createSession(user.id, "super_admin", user.username, user.first_name, user.last_name);
  } else if (userType === "org_admin") {
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
    userType,
    user: {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    },
  };
  if (userType === "org_admin") {
    response.organizationId = (user as any).organization_id;
  } else if (userType === "provider") {
    response.organizationId = (user as any).organization_id ?? null;
    response.clinicName = (user as any).clinic_name;
    response.clinicAddress = (user as any).clinic_address ?? null;
    response.uniqueSlug = (user as any).unique_slug;
  }
  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      challengeToken?: string;
      backupCode?: string;
    };
    const challengeToken = (body.challengeToken || "").trim();
    const backupCode = (body.backupCode || "").trim();
    if (!challengeToken || !backupCode) {
      return NextResponse.json(
        { error: "Challenge token and backup code are required" },
        { status: 400 },
      );
    }

    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `auth-login-mfa-recovery:${ip}:${challengeToken.slice(0, 16)}`,
      maxAttempts: MFA_RECOVERY_MAX_ATTEMPTS,
      windowSeconds: MFA_RECOVERY_WINDOW_SECONDS,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        {
          error: "Too many recovery attempts. Please try again later.",
          retryAfterSeconds: limiter.retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    const recovery = await consumeBackupCodeForChallenge({
      challengeToken,
      backupCode,
      purpose: "login",
    });
    if (!recovery.ok || !recovery.user) {
      if (recovery.reason === "codes_required") {
        return NextResponse.json(
          { error: "Backup codes were reset by an administrator. Generate a new set before using recovery codes." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "Invalid or expired backup recovery code" },
        { status: 400 },
      );
    }

    return createLoginSuccessResponse(recovery.user.userType, recovery.user.userId);
  } catch (error) {
    console.error("[auth/login/mfa/recovery] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
