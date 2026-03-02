import { describe, expect, it } from "vitest";
import { assertSafeOperationLocation, assertSafeOutboundUrl } from "@/lib/outbound-url";

describe("outbound-url safety", () => {
  it("allows a normal https outbound URL", () => {
    const url = assertSafeOutboundUrl("https://api.example.com/path?q=1");
    expect(url.hostname).toBe("api.example.com");
  });

  it("blocks localhost and metadata destinations", () => {
    expect(() => assertSafeOutboundUrl("https://localhost/test")).toThrow(/blocked host/i);
    expect(() => assertSafeOutboundUrl("https://169.254.169.254/latest/meta-data")).toThrow(
      /blocked host/i,
    );
  });

  it("blocks non-https outbound URLs", () => {
    expect(() => assertSafeOutboundUrl("http://example.com")).toThrow(/must use https/i);
  });

  it("requires operation-location to match configured endpoint origin", () => {
    expect(() =>
      assertSafeOperationLocation(
        "https://westus.api.cognitive.microsoft.com/operations/abc",
        "https://eastus.api.cognitive.microsoft.com",
      ),
    ).toThrow(/does not match configured endpoint/i);
  });
});
