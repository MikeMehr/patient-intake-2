import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { getOrgAdminContext } from "./auth-helpers";
import type { UserSession } from "./auth";

/** Minimal session; individual tests override only what they exercise. */
function session(overrides: Partial<UserSession>): UserSession {
  return {
    userId: "user-1",
    userType: "provider",
    username: "user",
    firstName: "First",
    lastName: "Last",
    organizationId: "org-1",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

function grantRow(managesOrgBooking: boolean) {
  return { rows: [{ manages_org_booking: managesOrgBooking }] };
}

describe("getOrgAdminContext", () => {
  beforeEach(() => {
    // mockReset, not clearAllMocks: the tests that assert query is never called leave
    // their mockResolvedValueOnce value queued, and it would leak into the next test.
    queryMock.mockReset();
  });

  it("returns null for no session", async () => {
    expect(await getOrgAdminContext(null)).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("grants an org admin without touching the database", async () => {
    const result = await getOrgAdminContext(
      session({ userType: "org_admin", userId: "org-admin-1" })
    );

    expect(result).toEqual({ organizationId: "org-1", isOrgAdminAccount: true });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null for an org admin with no tenant (tenant boundary)", async () => {
    const result = await getOrgAdminContext(
      session({ userType: "org_admin", organizationId: null })
    );

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("grants a provider holding manages_org_booking", async () => {
    queryMock.mockResolvedValueOnce(grantRow(true));

    const result = await getOrgAdminContext(session({ userId: "provider-1" }));

    expect(result).toEqual({ organizationId: "org-1", isOrgAdminAccount: false });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("manages_org_booking"), [
      "provider-1",
      "org-1",
    ]);
  });

  it("returns null for a provider without the grant", async () => {
    queryMock.mockResolvedValueOnce(grantRow(false));

    expect(await getOrgAdminContext(session({ userId: "provider-1" }))).toBeNull();
  });

  it("never lets an assistant inherit their physician's grant", async () => {
    // provider_assistants log in as userType "provider" with linkedPhysicianId set.
    queryMock.mockResolvedValueOnce(grantRow(true));

    const result = await getOrgAdminContext(
      session({ userId: "assistant-1", linkedPhysicianId: "provider-1" })
    );

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null for a provider with no organization", async () => {
    const result = await getOrgAdminContext(session({ organizationId: null }));

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null when the provider no longer belongs to that organization", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    expect(await getOrgAdminContext(session({ userId: "provider-1" }))).toBeNull();
  });

  it("returns null for a super admin", async () => {
    const result = await getOrgAdminContext(
      session({ userType: "super_admin", organizationId: null })
    );

    expect(result).toBeNull();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the query yields nothing", async () => {
    // Several route tests mock query as a bare vi.fn() resolving undefined; an unguarded
    // .rows there would turn an expected 401 into a caught 500.
    queryMock.mockResolvedValueOnce(undefined);

    await expect(getOrgAdminContext(session({ userId: "provider-1" }))).resolves.toBeNull();
  });
});
