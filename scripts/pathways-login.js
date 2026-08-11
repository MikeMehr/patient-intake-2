#!/usr/bin/env node
/**
 * One-time (or occasional) manual login to PathwaysBC.
 *
 * Opens a real, visible Chrome window pointed at pathwaysbc.ca. Log in by hand — including
 * whatever verification step PathwaysBC asks for — then press Enter in this terminal. The
 * resulting cookies/local storage are saved to a session-state file that scripts/pathways-sync.js
 * reuses headlessly, so the PathwaysBC password itself is never stored or scripted anywhere.
 *
 * Re-run this whenever pathways-sync.js starts failing to find the global-data response — that
 * almost always means the saved session expired and PathwaysBC bounced to a login page instead.
 *
 * Usage: node scripts/pathways-login.js [output-path]
 *   (defaults to PATHWAYS_SESSION_STATE_PATH, or ./pathways-session.json)
 */

const fs = require("fs");
const readline = require("readline");
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

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const outPath = process.argv[2] || process.env.PATHWAYS_SESSION_STATE_PATH || "./pathways-session.json";

  const executablePath = resolveLocalBrowserExecutablePath();
  if (!executablePath) {
    console.error(
      "No local Chrome/Chromium/Edge install found. Set CHROMIUM_EXECUTABLE_PATH to a browser binary and retry.",
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath, headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://pathwaysbc.ca/", { waitUntil: "domcontentloaded" });

  console.log("\nA browser window has opened to PathwaysBC.");
  console.log("Log in by hand (including any verification step), then come back here.\n");
  await waitForEnter("Press Enter once you're logged in and can see the PathwaysBC homepage... ");

  await context.storageState({ path: outPath });
  console.log(`\nSaved PathwaysBC session to ${outPath}`);
  console.log("scripts/pathways-sync.js will reuse it until PathwaysBC's session expires.\n");

  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("pathways-login failed:", err);
  process.exit(1);
});
