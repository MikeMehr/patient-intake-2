import { query } from "@/lib/db";

export type DbRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function consumeDbRateLimit(params: {
  bucketKey: string;
  maxAttempts: number;
  windowSeconds: number;
}): Promise<DbRateLimitResult> {
  const { bucketKey, maxAttempts, windowSeconds } = params;
  const result = await query<{ attempt_count: number; expires_at: Date }>(
    `INSERT INTO invitation_rate_limits (bucket_key, attempt_count, window_start, expires_at)
     VALUES ($1, 1, NOW(), NOW() + ($2 * INTERVAL '1 second'))
     ON CONFLICT (bucket_key)
     DO UPDATE SET
       attempt_count = CASE
         WHEN invitation_rate_limits.expires_at <= NOW() THEN 1
         ELSE invitation_rate_limits.attempt_count + 1
       END,
       window_start = CASE
         WHEN invitation_rate_limits.expires_at <= NOW() THEN NOW()
         ELSE invitation_rate_limits.window_start
       END,
       expires_at = CASE
         WHEN invitation_rate_limits.expires_at <= NOW()
           THEN NOW() + ($2 * INTERVAL '1 second')
         ELSE invitation_rate_limits.expires_at
       END
     RETURNING attempt_count, expires_at`,
    [bucketKey, windowSeconds],
  );

  const row = result.rows[0];
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000),
  );
  return {
    allowed: row.attempt_count <= maxAttempts,
    retryAfterSeconds,
  };
}

export async function clearDbRateLimit(bucketKey: string): Promise<void> {
  await query(`DELETE FROM invitation_rate_limits WHERE bucket_key = $1`, [bucketKey]);
}
