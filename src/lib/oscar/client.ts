import { signOAuth1Request, parseFormEncoded } from "./oauth1";

export type OscarOAuthEndpoints = {
  initiateUrl: string; // /ws/oauth/initiate
  authorizeUrl: string; // /ws/oauth/authorize
  tokenUrl: string; // /ws/oauth/token
};

export function getOscarOAuthEndpoints(oscarBaseUrl: string): OscarOAuthEndpoints {
  const base = oscarBaseUrl.replace(/\/+$/, "");
  return {
    initiateUrl: `${base}/ws/oauth/initiate`,
    authorizeUrl: `${base}/ws/oauth/authorize`,
    tokenUrl: `${base}/ws/oauth/token`,
  };
}

export function getOscarRestBase(oscarBaseUrl: string): string {
  // OSCAR documentation/examples typically use /ws/services for REST resources.
  // Some deployments expose WADL under /ws/rs, but require OAuth on /ws/services.
  return `${oscarBaseUrl.replace(/\/+$/, "")}/ws/services`;
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
    const res = await fetch(url.toString(), { method: "POST", headers, body });
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
    const res = await fetch(url.toString(), { method: "POST", headers, body });
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
    return fetch(url.toString(), {
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

