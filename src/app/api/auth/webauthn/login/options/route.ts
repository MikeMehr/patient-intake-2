import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOpts } from "@/lib/auth-webauthn";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";

export async function POST(request: NextRequest) {
  try {
    const ip = getRequestIp(request.headers);
    const limiter = await consumeDbRateLimit({
      bucketKey: `webauthn-login-opts:${ip}`,
      maxAttempts: 10,
      windowSeconds: 15 * 60,
    });
    if (!limiter.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfterSeconds: limiter.retryAfterSeconds },
        { status: 429 },
      );
    }

    const { options } = await generateAuthenticationOpts({ ipAddress: ip });

    return NextResponse.json({ options });
  } catch (error) {
    console.error("[webauthn/login/options] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
