import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOpts } from "@/lib/auth-webauthn";
import { consumeDbRateLimit } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/invitation-security";
import { query } from "@/lib/db";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

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

    // Optional: if the user has already typed their username, look up their registered
    // credential IDs so Chrome is told exactly which passkey(s) to present, preventing
    // the browser from auto-selecting an unregistered credential.
    let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> | undefined;

    const body = await request.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : null;

    if (username) {
      const credResult = await query<{ credential_id: string; transports: string[] | null }>(
        `SELECT wc.credential_id, wc.transports
         FROM webauthn_credentials wc
           JOIN physicians p ON wc.user_type = 'provider' AND wc.user_id = p.id
         WHERE LOWER(p.username) = $1
         UNION ALL
         SELECT wc.credential_id, wc.transports
         FROM webauthn_credentials wc
           JOIN organization_users ou ON wc.user_type = 'org_admin' AND wc.user_id = ou.id
         WHERE LOWER(ou.username) = $1
         UNION ALL
         SELECT wc.credential_id, wc.transports
         FROM webauthn_credentials wc
           JOIN super_admin_users sa ON wc.user_type = 'super_admin' AND wc.user_id = sa.id
         WHERE LOWER(sa.username) = $1`,
        [username],
      );

      if (credResult.rows.length > 0) {
        allowCredentials = credResult.rows.map((row) => ({
          id: row.credential_id,
          transports: (row.transports || []) as AuthenticatorTransportFuture[],
        }));
      }
      // If no rows found: fall through to discoverable credential flow (don't reveal user existence)
    }

    const { options } = await generateAuthenticationOpts({ ipAddress: ip, allowCredentials });

    return NextResponse.json({ options });
  } catch (error) {
    console.error("[webauthn/login/options] Error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
