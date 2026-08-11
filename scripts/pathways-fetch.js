/**
 * Shared PathwaysBC fetch + parse logic, used by both scripts/pathways-sync.js (writes to a
 * local DATABASE_URL) and scripts/pathways-sync-to-prod.js (POSTs to the production cron
 * endpoint, since prod's DB is Azure-firewalled from a laptop). Kept as one module so the two
 * callers can't drift from each other the way scripts/*.js already drift from src/lib/pathways —
 * see that file's header for why this can't just import the TS module graph directly.
 */

const fs = require("fs");
const { chromium } = require("playwright-core");

function resolveLocalBrowserExecutablePath() {
  const envPath = process.env.CHROMIUM_EXECUTABLE_PATH && process.env.CHROMIUM_EXECUTABLE_PATH.trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- wait-time bucket text -> approximate day count, for ORDER BY. Keep in sync with
// parseWaitTimeRank in src/lib/pathways/parse.ts. ---

const UNIT_TO_DAYS = {
  day: 1,
  days: 1,
  week: 7,
  weeks: 7,
  month: 30,
  months: 30,
  year: 365,
  years: 365,
};

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

function toNumber(token) {
  if (WORD_NUMBERS[token] !== undefined) return WORD_NUMBERS[token];
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function parseWaitTimeRank(waitTime) {
  if (!waitTime) return null;
  const text = waitTime.toLowerCase().trim();

  const within = text.match(/^within\s+([a-z0-9]+)\s+(day|days|week|weeks|month|months|year|years)$/);
  if (within) {
    const n = toNumber(within[1]);
    const unit = UNIT_TO_DAYS[within[2]];
    if (n !== null) return Math.round((n * unit) / 2);
  }

  const range = text.match(/([a-z0-9]+)\s*-\s*([a-z0-9]+)\s*(day|days|week|weeks|month|months|year|years)/);
  if (range) {
    const lo = toNumber(range[1]);
    const hi = toNumber(range[2]);
    const unit = UNIT_TO_DAYS[range[3]];
    if (lo !== null && hi !== null) return Math.round(((lo + hi) / 2) * unit);
  }

  const single = text.match(/([a-z0-9]+)\+?\s*(day|days|week|weeks|month|months|year|years)/);
  if (single) {
    const n = toNumber(single[1]);
    const unit = UNIT_TO_DAYS[single[2]];
    if (n !== null) return n * unit;
  }

  return null;
}

function lookupName(collection, id) {
  if (!collection || id === undefined || id === null) return null;
  const entry = collection[String(id)];
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && "name" in entry) {
    return typeof entry.name === "string" ? entry.name : null;
  }
  return null;
}

function parsePathwaysGlobalData(raw) {
  if (!raw || typeof raw !== "object" || !raw.specialists) {
    throw new Error("parsePathwaysGlobalData: missing 'specialists' collection");
  }
  const cities = raw.cities || {};
  const specializations = raw.specializations || {};

  const out = [];
  for (const entry of Object.values(raw.specialists)) {
    if (!entry || typeof entry !== "object") continue;
    if (!entry.id || !entry.name || !entry.lastName) continue;
    if (entry.hidden) continue;

    const specialization = lookupName(specializations, entry.specializationIds && entry.specializationIds[0]) || "Unspecified";
    const city = lookupName(cities, entry.cityIds && entry.cityIds[0]);
    const waitTime = entry.waittime || null;

    out.push({
      pathwaysId: entry.id,
      name: entry.name,
      lastName: entry.lastName,
      honorific: entry.honorific || null,
      specialization,
      city,
      billingNumber: entry.billingNumber || null,
      waitTime,
      waitTimeRank: parseWaitTimeRank(waitTime),
      acceptsReferralsViaFax: Boolean(entry.acceptsReferralsViaFax),
      acceptsReferralsViaPhone: Boolean(entry.acceptsReferralsViaPhone),
      acceptsReferralsViaProvincialPlatform: Boolean(entry.acceptsReferralsViaProvincialPlatform),
      isPracticing: entry.isPracticing !== false,
      referralIconKey: entry.referralIconKey || null,
    });
  }
  return out;
}

// --- transport: headless fetch of the global data export ---

async function fetchPathwaysGlobalData(sessionStatePath) {
  if (!fs.existsSync(sessionStatePath)) {
    throw new Error(
      `No PathwaysBC session found at ${sessionStatePath}. Run 'node scripts/pathways-login.js' first.`,
    );
  }

  const executablePath = resolveLocalBrowserExecutablePath();
  if (!executablePath) {
    throw new Error(
      "No local Chrome/Chromium/Edge install found. Set CHROMIUM_EXECUTABLE_PATH to a browser binary and retry.",
    );
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ storageState: sessionStatePath });
    const page = await context.newPage();

    const responsePromise = page
      .waitForResponse((res) => res.url().includes("global_data.json"), { timeout: 30_000 })
      .catch(() => null);

    await page.goto("https://pathwaysbc.ca/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    const response = await responsePromise;

    if (!response) {
      throw new Error(
        "Never saw the global-data response — PathwaysBC likely bounced to a login page because " +
          "the saved session expired. Re-run 'node scripts/pathways-login.js'.",
      );
    }

    return await response.json();
  } finally {
    await browser.close();
  }
}

module.exports = {
  resolveLocalBrowserExecutablePath,
  parseWaitTimeRank,
  parsePathwaysGlobalData,
  fetchPathwaysGlobalData,
};
