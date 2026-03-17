import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { generateRegistrationOpts } from "@/lib/auth-webauthn";
import { consumeDbRateLimit } from "@/lib/rate-limit";

export async function POST(_request: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limiter = await consumeDbRateLimit({
      bucketKey: `webauthn-reg-opts:${session.userId}`,
      maxAttempts: 5,
      windowSeconds: 15 * 60,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfterSeconds: limiter.retryAfterSeconds },
        { status: 429 },
      );
    }

    const displayName = `${session.firstName} ${session.lastName}`.trim();
    const { options } = await generateRegistrationOpts({
      userType: session.userType,
      userId: session.userId,
      username: session.username,
      displayName: displayName || session.username,
    });

    return NextResponse.json({ options });
  } catch (error) {
    console.error("[webauthn/register/options] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
