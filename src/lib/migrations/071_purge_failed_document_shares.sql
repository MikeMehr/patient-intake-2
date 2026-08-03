-- One-off cleanup after the blob-CORS outage of 2026-08-02/03.
--
-- POST /api/org/documents/shares inserts the share and all its file rows BEFORE any byte
-- moves, so every attempt that died on the CORS preflight left a document_shares row with no
-- blobs behind it. Those rows are harmless in themselves (never emailed, and the download
-- route reports them as "pending"), but they show as amber "Incomplete" on the dashboard with
-- no delete UI, and each one burns a slot in the 30-per-600s create rate limit — enough
-- retries and the clinician gets a confusing "Too many shares created" stacked on top of the
-- original failure.
--
-- Why the window is bounded on BOTH sides, rather than just "incomplete and old":
--
--   Upper bound — migrations re-run on EVERY startup (see src/lib/run-migrations.ts), so an
--   open-ended NOW() - INTERVAL predicate would quietly keep reaping legitimately abandoned
--   shares forever. A fixed literal makes this genuinely one-off: after the first run it
--   matches nothing, which also satisfies the idempotency rule migrations here must follow.
--   02:00Z is just before the CORS rule was corrected, so no post-fix share can be caught.
--
--   Lower bound — uploads worked fine from the previous domain. The storage account still
--   holds three share blobs from 2026-07-28, and document_share_files is ON DELETE CASCADE,
--   so deleting a parent row destroys the only record of its blob paths — stranding PHI in
--   the container with nothing pointing at it. Verified against the live account: zero blobs
--   under any */shares/* path were created on or after 2026-07-29, so every row in this
--   window provably has nothing in storage. Anything older is left alone deliberately.
--
-- The uploaded_confirmed_at check is a third, independent guard: it skips any share where a
-- file was ever confirmed to have landed, whatever the dates say.
--
-- Older abandoned shares (pre-2026-07-29) are intentionally NOT touched here. They need the
-- blob-aware sweep — delete each blob, then the row — which belongs in a scheduled cleanup
-- route, not in a migration that cannot talk to Azure.

DELETE FROM document_shares ds
WHERE ds.completed_at IS NULL
  AND ds.revoked_at IS NULL
  AND ds.created_at >= TIMESTAMPTZ '2026-07-29 00:00:00+00'
  AND ds.created_at <  TIMESTAMPTZ '2026-08-03 02:00:00+00'
  AND NOT EXISTS (
    SELECT 1
    FROM document_share_files f
    WHERE f.share_id = ds.id
      AND f.uploaded_confirmed_at IS NOT NULL
  );
