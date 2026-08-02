import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("security regressions", () => {
  it("keeps command-execution primitives out of server code", () => {
    const serverFiles = [
      "src/lib/auth.ts",
      "src/lib/oscar/client.ts",
      "src/app/api/lab-requisitions/generate/route.ts",
      "src/app/api/physician/transcription/generate/route.ts",
    ];
    for (const file of serverFiles) {
      const content = read(file);
      expect(content).not.toMatch(/child_process|exec\(|spawn\(|fork\(/);
    }
  });

  it("avoids unsafe HTML sinks in key UI and eForm files", () => {
    const files = [
      "src/app/physician/view/page.tsx",
      "public/eforms/1.1LabRequisition/LabDecisionSupport4_Feb2019.js",
    ];
    for (const file of files) {
      const content = read(file);
      expect(content).not.toMatch(/innerHTML\s*\+?=/);
    }
  });

  it("uses function callbacks instead of string timers in lab eForm", () => {
    const html = read("public/eforms/1.1LabRequisition/1.1LabRequisition.html");
    expect(html).not.toContain("setTimeout('document.FormName.submit()', 2000);");
    expect(html).not.toContain("setTimeout('StartClock12()', 1000);");
  });

  it("does not set a Cross-Origin-Opener-Policy header", () => {
    // COOP severs window.opener, which is the channel the OSCAR eChart
    // "Transcribe" popup uses to hand the finished SOAP note back into the
    // encounter note. Adding COOP would silently break that feature — the
    // popup would work right up to "Send to OSCAR note" and then fail with
    // "no opener". If COOP is ever genuinely needed, the OSCAR integration
    // must move to a different transport first.
    // See docs/oscar/echart-transcribe-install.md.
    for (const file of ["src/proxy.ts", "next.config.ts"]) {
      const content = read(file);
      expect(content).not.toMatch(/Cross-Origin-Opener-Policy/i);
    }
  });

  it("never posts the SOAP note to a wildcard target origin", () => {
    // The postMessage payload carries PHI, so the target origin must always be
    // the server-resolved allow-listed OSCAR origin, never "*".
    const hook = read("src/components/physician/useOscarLaunch.ts");
    expect(hook).not.toMatch(/postMessage\([^)]*,\s*["']\*["']/);
  });

  it("keeps the OSCAR-side script's origin check intact", () => {
    // Without this check any page could inject text into a patient chart.
    const script = read("public/oscar/echart-transcribe.js");
    expect(script).toMatch(/event\.origin\s*!==\s*APP_ORIGIN/);

    // Passing the noopener flag to window.open would break the return channel
    // (see docs/oscar/echart-transcribe-install.md). Comments are stripped
    // first because the script explains this hazard in prose.
    const code = script
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/noopener/);
  });

  it("does not introduce XML parser dependencies in server routes", () => {
    const files = [
      "src/app/api/speech/tts/route.ts",
      "src/app/api/speech/stt/route.ts",
      "src/lib/invitation-pdf-summary.ts",
    ];
    for (const file of files) {
      const content = read(file);
      expect(content).not.toMatch(/xml2js|fast-xml-parser|DOMParser|parseFromString/);
    }
  });
});
