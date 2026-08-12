#!/usr/bin/env node
/**
 * Fills bc_specialist_contact_cache for every queued specialist that still lacks the office
 * phone + address OSCAR demands before it will create a specialist record.
 *
 * Runs locally against the session saved by scripts/pathways-login.js rather than in a browser
 * tab: this fetches one PathwaysBC profile page PER specialist, and a bulk pre-load is thousands
 * of them — far too many to babysit in a tab, and a tab that reloads or times out loses the run.
 *
 * Deliberately polite and resumable:
 *   - one page at a time with a delay between (never parallel — see DELAY_MS)
 *   - progress is durable after every batch, because the server owns the state; re-running only
 *     picks up whoever is still missing contact info
 *   - stops early rather than hammering PathwaysBC if it starts failing repeatedly
 *
 * Usage: node scripts/pathways-contact-backfill.js [--limit N] [--delay MS] [--ids 43,2472,...]
 *   --ids re-fetches those PathwaysBC ids even though they already have cached contact info.
 *   Needed to repair records saved by an earlier, buggier parse: the normal candidate list only
 *   contains specialists with NO contact info, so a wrong-but-present row is invisible to it.
 *
 *   Reads CRON_SECRET, PATHWAYS_SESSION_STATE_PATH, PATHWAYS_PROD_BASE from env/.env.local.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { chromium } = require("playwright-core");
const { resolveLocalBrowserExecutablePath } = require("./pathways-fetch");

const DEFAULT_BASE = "https://physician.health-assist.org";
/** Gap between profile fetches. PathwaysBC is a free service for BC physicians, not an API. */
const DEFAULT_DELAY_MS = 700;
/** Push results to the server this often, so a crash costs at most this many scrapes. */
const FLUSH_EVERY = 25;
/** Bail out if this many consecutive pages fail — almost always an expired session. */
const MAX_CONSECUTIVE_FAILURES = 8;

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (k && process.env[k] === undefined) process.env[k] = t.slice(eq + 1).trim();
  }
}

function request(method, urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: Object.assign({}, headers, data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        timeout: 60_000,
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode, body: out }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  loadEnvLocal();

  const args = process.argv.slice(2);
  const argVal = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? Number(args[i + 1]) : fallback;
  };
  const limit = argVal("--limit", Infinity);
  const delayMs = argVal("--delay", DEFAULT_DELAY_MS);

  const base = process.env.PATHWAYS_PROD_BASE || DEFAULT_BASE;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET is not set (checked environment and .env.local).");

  const sessionStatePath = process.env.PATHWAYS_SESSION_STATE_PATH || path.join(__dirname, "..", "pathways-session.json");
  if (!fs.existsSync(sessionStatePath)) {
    throw new Error(`No PathwaysBC session at ${sessionStatePath}. Run 'npm run pathways:login' first.`);
  }

  const idsFlag = args.indexOf("--ids");
  let candidates;
  if (idsFlag !== -1 && args[idsFlag + 1]) {
    candidates = args[idsFlag + 1].split(",").map((s) => ({ pathwaysId: Number(s.trim()) })).filter((c) => c.pathwaysId);
    console.log(`Re-fetching ${candidates.length} specific PathwaysBC profile(s) to overwrite existing contact info.`);
  } else {
    console.log("Fetching the list of specialists still missing contact info…");
    const listRes = await request("GET", `${base}/api/cron/oscar-contact-backfill-candidates`, { "x-cron-secret": cronSecret });
    if (listRes.status !== 200) throw new Error(`Candidates endpoint returned HTTP ${listRes.status}: ${listRes.body.slice(0, 200)}`);
    candidates = JSON.parse(listRes.body).candidates || [];
  }
  if (candidates.length > limit) candidates = candidates.slice(0, limit);

  if (candidates.length === 0) {
    console.log("Nothing to do — every queued specialist already has contact info.");
    return;
  }
  const estMin = Math.ceil((candidates.length * delayMs) / 60000);
  console.log(`${candidates.length} to fetch, ~${delayMs}ms apart (roughly ${estMin} min). Ctrl-C is safe — progress is saved as it goes.`);

  const executablePath = resolveLocalBrowserExecutablePath();
  if (!executablePath) throw new Error("No local Chrome/Chromium/Edge found. Set CHROMIUM_EXECUTABLE_PATH.");

  const browser = await chromium.launch({ executablePath, headless: true });
  const stats = { ok: 0, noContact: 0, failed: 0, saved: 0 };
  let pending = [];
  let consecutiveFailures = 0;

  async function flush() {
    if (pending.length === 0) return;
    const res = await request("POST", `${base}/api/cron/oscar-contact-backfill`, { "x-cron-secret": cronSecret }, { results: pending });
    if (res.status !== 200) {
      console.error(`  ! Failed to save a batch of ${pending.length}: HTTP ${res.status} ${res.body.slice(0, 160)}`);
    } else {
      stats.saved += JSON.parse(res.body).updated || 0;
    }
    pending = [];
  }

  try {
    const context = await browser.newContext({ storageState: sessionStatePath });
    const page = await context.newPage();

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      try {
        await page.goto(`https://pathwaysbc.ca/specialists/${c.pathwaysId}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const text = await page.evaluate(() => {
          const el = document.querySelector(".span7half");
          return el ? el.innerText : document.body.innerText;
        });

        // Parse server-side (POST below) so there's one parser implementation, not a copy here.
        // A page with neither phone nor postal code isn't worth sending — the endpoint would
        // reject it anyway, and this keeps the batch payloads small.
        if (!/\d{3}[-.\s]?\d{3}[-.\s]\d{4}/.test(text)) {
          stats.noContact++;
        } else {
          pending.push({ pathwaysId: c.pathwaysId, pageText: text });
          stats.ok++;
        }
        consecutiveFailures = 0;
      } catch (err) {
        stats.failed++;
        consecutiveFailures++;
        console.error(`  ! ${c.pathwaysId}: ${err.message}`);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`\nStopping after ${consecutiveFailures} failures in a row — the PathwaysBC session has probably expired.`);
          console.error("Run 'npm run pathways:login' again, then re-run this; it resumes where it left off.");
          break;
        }
      }

      if (pending.length >= FLUSH_EVERY) await flush();
      if ((i + 1) % 50 === 0 || i === candidates.length - 1) {
        console.log(`  ${i + 1}/${candidates.length} — ${stats.ok} with contact info, ${stats.noContact} without, ${stats.failed} errors`);
      }
      if (i < candidates.length - 1) await sleep(delayMs);
    }
  } finally {
    await flush();
    await browser.close();
  }

  console.log(`\nDone. Saved ${stats.saved}. ${stats.noContact} had no usable contact info on PathwaysBC; ${stats.failed} errored.`);
}

main().catch((err) => {
  console.error("pathways-contact-backfill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
