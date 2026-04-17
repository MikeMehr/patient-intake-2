import https from "node:https";
import { signOAuth1Request, parseFormEncoded } from "./oauth1";
import { assertSafeOutboundUrl } from "@/lib/outbound-url";

// ---------------------------------------------------------------------------
// SSL-tolerant fetch for Oscar EMR
// Oscar instances commonly use self-signed or expired TLS certificates.
// We use a dedicated node:https.Agent that disables cert verification only
// for Oscar API calls — all other server-side fetch calls are unaffected.
// node:https is a true Node.js built-in and is never webpack-bundled.
// ---------------------------------------------------------------------------
const _oscarTlsAgent = new https.Agent({ rejectUnauthorized: false });

const OSCAR_FETCH_TIMEOUT_MS = 20_000; // 20 s — avoids infinite hangs when Oscar is unreachable

export async function oscarFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const u = new URL(url);

    // Build headers — include Content-Length when a body is present so that
    // Oscar (Tomcat) doesn't reject the request due to chunked encoding.
    const outHeaders: Record<string, string> = {
      ...(options.headers as Record<string, string> | undefined),
    };
    const bodyStr =
      options.body != null
        ? typeof options.body === "string"
          ? options.body
          : Buffer.isBuffer(options.body)
            ? (options.body as Buffer).toString("utf-8")
            : undefined
        : undefined;
    if (bodyStr != null) {
      outHeaders["Content-Length"] = Buffer.byteLength(bodyStr, "utf-8").toString();
    }

    const reqOptions: https.RequestOptions = {
      hostname: u.hostname,
      port: u.port || "443",
      path: u.pathname + u.search,
      method: (options.method || "GET").toUpperCase(),
      headers: outHeaders,
      agent: _oscarTlsAgent,
      timeout: OSCAR_FETCH_TIMEOUT_MS,
    };

    console.log(`[oscarFetch] ${reqOptions.method} ${url} (timeout ${OSCAR_FETCH_TIMEOUT_MS}ms)`);

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const bodyBuf = Buffer.concat(chunks);
        console.log(`[oscarFetch] ${reqOptions.method} ${url} → ${res.statusCode} (${bodyBuf.length} bytes)`);
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
          else headers.set(k, v);
        }
        resolve(
          new Response(bodyBuf, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage ?? "",
            headers,
          }),
        );
      });
      res.on("error", (err) => {
        console.error(`[oscarFetch] response error for ${url}:`, err.message);
        reject(err);
      });
    });

    // timeout event fires when the socket is idle for too long — destroy to trigger "error"
    req.on("timeout", () => {
      console.error(`[oscarFetch] TIMEOUT after ${OSCAR_FETCH_TIMEOUT_MS}ms: ${url}`);
      req.destroy(new Error(`Oscar request timed out after ${OSCAR_FETCH_TIMEOUT_MS}ms: ${url}`));
    });

    req.on("error", (err) => {
      console.error(`[oscarFetch] request error for ${url}:`, err.message);
      reject(err);
    });

    if (bodyStr != null) {
      req.write(bodyStr);
    }
    req.end();
  });
}

export type OscarOAuthEndpoints = {
  initiateUrl: string; // /ws/oauth/initiate
  authorizeUrl: string; // /ws/oauth/authorize
  tokenUrl: string; // /ws/oauth/token
};

export function getOscarOAuthEndpoints(oscarBaseUrl: string): OscarOAuthEndpoints {
  const base = assertSafeOutboundUrl(oscarBaseUrl, { label: "OSCAR base URL" }).toString().replace(/\/+$/, "");
  return {
    initiateUrl: `${base}/ws/oauth/initiate`,
    authorizeUrl: `${base}/ws/oauth/authorize`,
    tokenUrl: `${base}/ws/oauth/token`,
  };
}

export function getOscarRestBase(oscarBaseUrl: string): string {
  // OSCAR's original /ws/rs endpoint is registered with the public URL in CXF's endpoint
  // registry (e.g. https://oscar.example.com/oscar/ws/rs).  OAuth 1.0a signature
  // verification uses this URL, so Health Assist must sign requests with the same base.
  //
  // The /ws/services endpoint we added in spring_ws.xml is registered with Tomcat's
  // internal address (http://localhost:8080), causing an HMAC-SHA1 signature mismatch
  // and an "Access Denied" 500 error from OSCAR's OAuthRequestFilter.  Using /ws/rs
  // avoids this mismatch because its base URL in CXF matches what we sign against.
  const base = assertSafeOutboundUrl(oscarBaseUrl, { label: "OSCAR base URL" }).toString().replace(/\/+$/, "");
  return `${base}/ws/rs`;
}

export async function oscarInitiate(args: {
  oscarBaseUrl: string;
  clientKey: string;
  clientSecret: string;
  callbackUrl: string;
}): Promise<{ requestToken: string; requestTokenSecret: string }> {
  const endpoints = getOscarOAuthEndpoints(args.oscarBaseUrl);
  const signed = signOAuth1Request({
    method: "POST",
    url: endpoints.initiateUrl,
    consumerKey: args.clientKey,
    consumerSecret: args.clientSecret,
    oauthParams: {
      oauth_callback: args.callbackUrl,
    },
  });

  const doRequest = async (mode: "header" | "query" | "body") => {
    const url = new URL(signed.signedUrl);
    const headers: Record<string, string> = {};
    let body: string | undefined = undefined;
    if (mode === "header") {
      headers.Authorization = signed.authorizationHeader;
    } else if (mode === "query") {
      // Some OSCAR deployments don't parse the OAuth Authorization header.
      // OAuth params can also be supplied via the query string.
      for (const [k, v] of Object.entries(signed.oauthParams)) {
        url.searchParams.set(k, v);
      }
    } else {
      // Some OSCAR deployments only accept OAuth params in a form-encoded body.
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(signed.oauthParams).toString();
    }
    const res = await oscarFetch(url.toString(), { method: "POST", headers, body });
    const text = await res.text();
    return { res, text };
  };

  let attempt = await doRequest("header");
  if (!attempt.res.ok && attempt.res.status === 400) {
    attempt = await doRequest("query");
  }
  if (!attempt.res.ok && attempt.res.status === 400) {
    attempt = await doRequest("body");
  }
  if (!attempt.res.ok) {
    const wwwAuth = attempt.res.headers.get("www-authenticate") || "";
    const hint = wwwAuth ? ` www-authenticate=${wwwAuth.slice(0, 200)}` : "";
    throw new Error(
      `OSCAR initiate failed (${attempt.res.status}): ${attempt.text.slice(0, 500)}${hint}`.trim(),
    );
  }

  const parsed = parseFormEncoded(attempt.text);
  const requestToken = parsed.oauth_token;
  const requestTokenSecret = parsed.oauth_token_secret;
  if (!requestToken || !requestTokenSecret) {
    throw new Error("OSCAR initiate returned missing oauth_token/oauth_token_secret");
  }
  return { requestToken, requestTokenSecret };
}

export function oscarAuthorizeUrl(args: { oscarBaseUrl: string; requestToken: string }): string {
  const endpoints = getOscarOAuthEndpoints(args.oscarBaseUrl);
  const url = new URL(endpoints.authorizeUrl);
  url.searchParams.set("oauth_token", args.requestToken);
  return url.toString();
}

export async function oscarExchangeAccessToken(args: {
  oscarBaseUrl: string;
  clientKey: string;
  clientSecret: string;
  requestToken: string;
  requestTokenSecret: string;
  verifier: string;
}): Promise<{ accessToken: string; tokenSecret: string }> {
  const endpoints = getOscarOAuthEndpoints(args.oscarBaseUrl);
  const signed = signOAuth1Request({
    method: "POST",
    url: endpoints.tokenUrl,
    consumerKey: args.clientKey,
    consumerSecret: args.clientSecret,
    token: args.requestToken,
    tokenSecret: args.requestTokenSecret,
    oauthParams: {
      oauth_verifier: args.verifier,
    },
  });

  const doRequest = async (mode: "header" | "query" | "body") => {
    const url = new URL(signed.signedUrl);
    const headers: Record<string, string> = {};
    let body: string | undefined = undefined;
    if (mode === "header") {
      headers.Authorization = signed.authorizationHeader;
    } else {
      if (mode === "query") {
        for (const [k, v] of Object.entries(signed.oauthParams)) {
          url.searchParams.set(k, v);
        }
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(signed.oauthParams).toString();
      }
    }
    const res = await oscarFetch(url.toString(), { method: "POST", headers, body });
    const text = await res.text();
    return { res, text };
  };

  let attempt = await doRequest("header");
  if (!attempt.res.ok && attempt.res.status === 400) {
    attempt = await doRequest("query");
  }
  if (!attempt.res.ok && attempt.res.status === 400) {
    attempt = await doRequest("body");
  }
  if (!attempt.res.ok) {
    const wwwAuth = attempt.res.headers.get("www-authenticate") || "";
    const hint = wwwAuth ? ` www-authenticate=${wwwAuth.slice(0, 200)}` : "";
    throw new Error(
      `OSCAR token exchange failed (${attempt.res.status}): ${attempt.text.slice(0, 500)}${hint}`.trim(),
    );
  }

  const parsed = parseFormEncoded(attempt.text);
  const accessToken = parsed.oauth_token;
  const tokenSecret = parsed.oauth_token_secret;
  if (!accessToken || !tokenSecret) {
    throw new Error("OSCAR token exchange returned missing oauth_token/oauth_token_secret");
  }
  return { accessToken, tokenSecret };
}

export async function oscarSignedFetch(args: {
  method: "GET" | "POST";
  url: string;
  clientKey: string;
  clientSecret: string;
  accessToken: string;
  tokenSecret: string;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Response> {
  assertSafeOutboundUrl(args.url, { label: "OSCAR request URL" });
  const signed = signOAuth1Request({
    method: args.method,
    url: args.url,
    consumerKey: args.clientKey,
    consumerSecret: args.clientSecret,
    token: args.accessToken,
    tokenSecret: args.tokenSecret,
    queryParams: args.query,
  });

  const doRequest = async (mode: "header" | "query") => {
    const url = new URL(signed.signedUrl);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(args.headers || {}),
    };
    if (mode === "header") {
      headers.Authorization = signed.authorizationHeader;
    } else {
      // Some OSCAR deployments don't parse the OAuth Authorization header for RS endpoints.
      for (const [k, v] of Object.entries(signed.oauthParams)) {
        url.searchParams.set(k, v);
      }
    }
    return oscarFetch(url.toString(), {
      method: args.method,
      headers,
      body: args.body,
    });
  };

  // Try standards-compliant Authorization header first, then query-string fallback.
  const res1 = await doRequest("header");
  if (res1.ok) return res1;
  if (res1.status === 401) {
    const res2 = await doRequest("query");
    return res2;
  }
  return res1;
}

