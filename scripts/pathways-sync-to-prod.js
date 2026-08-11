#!/usr/bin/env node
/**
 * Monthly production refresh of bc_specialist_directory from PathwaysBC.
 *
 * Prod's Postgres is Azure-firewalled from a laptop, so this doesn't touch a database directly —
 * it fetches + parses PathwaysBC's export locally (fetch/parse logic in scripts/pathways-fetch.js,
 * shared with pathways-sync.js) using the session saved by pathways-login.js, then POSTs the
 * parsed rows to /api/cron/pathways-directory-sync, which does the DB write through the app's own
 * already-working connection.
 *
 * Meant to run unattended from a scheduled job (see infrastructure/pathways-sync.plist) — on
 * failure it texts BOOKING_ISSUE_ALERT_PHONE via Twilio (same alert number the mail-alert cron
 * already uses) rather than failing silently, since a stale directory is easy to not notice.
 * The most likely failure mode is the saved PathwaysBC session expiring, which needs a human to
 * run `npm run pathways:login` again — no amount of retrying fixes that on its own.
 *
 * Usage: node scripts/pathways-sync-to-prod.js
 *   Reads CRON_SECRET, TWILIO_*, BOOKING_ISSUE_ALERT_PHONE, PATHWAYS_SESSION_STATE_PATH,
 *   PATHWAYS_PROD_SYNC_URL from the environment, falling back to .env.local in the repo root
 *   (loaded manually — no dotenv dependency in this repo) for anything not already set, so a
 *   launchd job only needs PATH/WorkingDirectory, not secrets duplicated into a plist.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { parsePathwaysGlobalData, fetchPathwaysGlobalData } = require("./pathways-fetch");

const DEFAULT_PROD_SYNC_URL = "https://physician.health-assist.org/api/cron/pathways-directory-sync";

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function postJson(urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
        timeout: 60_000,
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => (responseBody += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: responseBody }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request to production timed out")));
    req.write(data);
    req.end();
  });
}

async function sendFailureAlert(message) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, BOOKING_ISSUE_ALERT_PHONE } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !BOOKING_ISSUE_ALERT_PHONE) {
    console.error("Twilio not configured — cannot send failure SMS. Alert text was:", message);
    return;
  }
  try {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const body = new URLSearchParams({
      To: BOOKING_ISSUE_ALERT_PHONE,
      From: TWILIO_PHONE_NUMBER,
      Body: message.slice(0, 300),
    }).toString();
    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.twilio.com",
          path: `/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 20_000,
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Twilio request timed out")));
      req.write(body);
      req.end();
    });
    console.log(`Failure SMS sent to ${BOOKING_ISSUE_ALERT_PHONE}.`);
  } catch (err) {
    console.error("Failed to send failure SMS:", err instanceof Error ? err.message : err);
  }
}

async function main() {
  loadEnvLocal();

  const sessionStatePath = process.env.PATHWAYS_SESSION_STATE_PATH || path.join(__dirname, "..", "pathways-session.json");
  const syncUrl = process.env.PATHWAYS_PROD_SYNC_URL || DEFAULT_PROD_SYNC_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    throw new Error("CRON_SECRET is not set (checked environment and .env.local).");
  }

  console.log(`Fetching PathwaysBC global data using session ${sessionStatePath} ...`);
  const raw = await fetchPathwaysGlobalData(sessionStatePath);

  console.log("Parsing specialists ...");
  const rows = parsePathwaysGlobalData(raw);
  console.log(`Parsed ${rows.length} specialists.`);

  console.log(`POSTing to ${syncUrl} ...`);
  const res = await postJson(syncUrl, { "x-cron-secret": cronSecret }, { rows });

  if (res.status !== 200) {
    throw new Error(`Production sync endpoint returned HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  console.log(`Done: ${res.body}`);
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("pathways-sync-to-prod failed:", message);
  await sendFailureAlert(`PathwaysBC monthly sync failed: ${message}`.slice(0, 280));
  process.exit(1);
});
