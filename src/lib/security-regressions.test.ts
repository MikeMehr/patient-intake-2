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
