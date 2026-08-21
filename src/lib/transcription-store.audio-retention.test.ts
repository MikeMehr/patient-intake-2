import { beforeEach, describe, expect, it, vi } from "vitest";

const clientQueryMock = vi.hoisted(() => vi.fn());
const deleteAudioBlobMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  getClient: async () => ({
    query: (...args: unknown[]) => clientQueryMock(...args),
    release: () => {},
  }),
}));

vi.mock("@/lib/azure-blob-audio", () => ({
  deleteAudioBlob: (...args: unknown[]) => deleteAudioBlobMock(...args),
}));

/** Find the query whose SQL matches, returning [sql, params]. */
function findQuery(pattern: RegExp): [string, unknown[]] {
  const call = clientQueryMock.mock.calls.find(
    (c) => typeof c[0] === "string" && pattern.test(c[0] as string),
  );
  if (!call) throw new Error(`No query matched ${pattern}`);
  return [call[0] as string, (call[1] as unknown[]) ?? []];
}

describe("audio retention in cleanupExpiredPhiRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AUDIO_RETENTION_DAYS;
    delete process.env.AUDIO_RETENTION_POLICY_START;
    delete process.env.PHI_RETENTION_HOURS;
    delete process.env.RETENTION_YEARS;
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it("purges audio at 90 days by default", async () => {
    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    const [, params] = findQuery(/UPDATE soap_note_versions\s+SET audio_blob_path = NULL/);
    expect(params[0]).toBe(90 * 24);
  });

  it("honours AUDIO_RETENTION_DAYS", async () => {
    process.env.AUDIO_RETENTION_DAYS = "30";
    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    const [, params] = findQuery(/UPDATE soap_note_versions\s+SET audio_blob_path = NULL/);
    expect(params[0]).toBe(30 * 24);
  });

  it("is not retroactive: skips pre-policy audio while it is still a draft", async () => {
    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    const [sql, params] = findQuery(/UPDATE soap_note_versions\s+SET audio_blob_path = NULL/);
    expect(sql).toMatch(/created_at >= \$2::timestamptz/);
    // ...but pre-policy audio on a finalized note is still caught, since
    // finalizing used to delete the recording outright.
    expect(sql).toMatch(/OR lifecycle_state = 'FINALIZED_FOR_EXPORT'/);
    expect(params[1]).toBe("2026-08-21T18:00:00Z");
  });

  it("honours AUDIO_RETENTION_POLICY_START", async () => {
    process.env.AUDIO_RETENTION_POLICY_START = "2027-01-01T00:00:00Z";
    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    const [, params] = findQuery(/UPDATE soap_note_versions\s+SET audio_blob_path = NULL/);
    expect(params[1]).toBe("2027-01-01T00:00:00Z");
  });

  it("deletes the blobs it unlinked, once each", async () => {
    clientQueryMock.mockImplementation((sql: string) => {
      if (/SELECT id, audio_blob_path/.test(sql)) {
        return Promise.resolve({
          rowCount: 2,
          rows: [
            { id: "soap-1", audio_blob_path: "a.wav" },
            { id: "soap-2", audio_blob_path: "b.wav" },
          ],
        });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    // Both collection queries return the same rows here; each blob dies once.
    expect(deleteAudioBlobMock).toHaveBeenCalledTimes(2);
    expect(deleteAudioBlobMock.mock.calls.map((c) => c[0]).sort()).toEqual(["a.wav", "b.wav"]);
  });

  it("collects audio from rows that are deleted outright, so no blob is orphaned", async () => {
    const { cleanupExpiredPhiRecords } = await import("./transcription-store");
    await cleanupExpiredPhiRecords();

    const [sql, params] = findQuery(/SELECT id, audio_blob_path[\s\S]*finalized_for_export_at < NOW\(\)/);
    expect(sql).toMatch(/lifecycle_state = 'DRAFT'/);
    expect(sql).toMatch(/finalized_for_export_at < NOW\(\)/);
    expect(params).toEqual([26280, 7 * 365 * 24]);
  });
});
