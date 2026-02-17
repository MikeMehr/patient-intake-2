import { createHmac, randomBytes } from "crypto";

function encodeRfc3986(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function normalizeBaseUrl(url: URL): string {
  // OAuth base string uses scheme/host/path only (no query, no fragment)
  const port = url.port && !["80", "443"].includes(url.port) ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}${url.pathname}`;
}

function buildNormalizedParamString(params: Array<[string, string]>): string {
  const encoded = params.map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const);
  encoded.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  return encoded.map(([k, v]) => `${k}=${v}`).join("&");
}

export function buildOAuth1Header(params: Record<string, string>): string {
  const parts = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=\"${encodeRfc3986(v)}\"`);
  return `OAuth ${parts.join(", ")}`;
}

export function signOAuth1Request(args: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  // Additional OAuth params beyond standard ones, e.g. oauth_callback, oauth_verifier
  oauthParams?: Record<string, string>;
  // Query params (included in signature base string)
  queryParams?: Record<string, string | undefined>;
  // Body params (included in signature base string for x-www-form-urlencoded POST)
  bodyParams?: Record<string, string | undefined>;
}): { authorizationHeader: string; signedUrl: string; oauthParams: Record<string, string> } {
  const url = new URL(args.url);

  // Apply query params to URL
  if (args.queryParams) {
    for (const [k, v] of Object.entries(args.queryParams)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, v);
    }
  }

  const oauth: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...args.oauthParams,
  };
  if (args.token) {
    oauth.oauth_token = args.token;
  }

  // Collect signature params: oauth params + query params
  const signatureParams: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(oauth)) signatureParams.push([k, v]);
  url.searchParams.forEach((value, key) => {
    signatureParams.push([key, value]);
  });
  if (args.bodyParams) {
    for (const [k, v] of Object.entries(args.bodyParams)) {
      if (v == null || v === "") continue;
      signatureParams.push([k, v]);
    }
  }

  const baseString = [
    args.method.toUpperCase(),
    encodeRfc3986(normalizeBaseUrl(url)),
    encodeRfc3986(buildNormalizedParamString(signatureParams)),
  ].join("&");

  const signingKey = `${encodeRfc3986(args.consumerSecret)}&${encodeRfc3986(args.tokenSecret || "")}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");
  oauth.oauth_signature = signature;

  return {
    authorizationHeader: buildOAuth1Header(oauth),
    signedUrl: url.toString(),
    oauthParams: oauth,
  };
}

export function parseFormEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split("&")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    if (!k) continue;
    out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}

