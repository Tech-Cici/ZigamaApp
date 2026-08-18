import { Logger } from '@nestjs/common';

/**
 * Retry policy for write transactions.
 *
 * Two different things land here and both are safe to replay:
 *
 *   - genuine contention (serialization failure, deadlock, our own
 *     `lock_timeout` firing);
 *   - the connection being dropped underneath us, which a pooled connection to
 *     a resource-constrained Postgres does under load.
 *
 * Replaying is safe in both cases *because the transaction never committed*.
 * Only wrap work that is entirely inside one transaction — a retry re-runs all
 * of it.
 */

const DEFAULT_MAX_ATTEMPTS = 5;

const logger = new Logger('DbRetry');

/**
 *   40001  serialization failure
 *   40P01  deadlock detected
 *   55P03  lock_not_available (`lock_timeout` fired)
 *   08006 / 08P01  connection failure / protocol violation
 *   P2034  Prisma's wrapper for a write conflict
 */
export function isRetryableDbError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };

  if (candidate?.code === 'P2034') return true;
  if (
    candidate?.code === '40001' ||
    candidate?.code === '40P01' ||
    candidate?.code === '55P03' ||
    candidate?.code === '08006' ||
    candidate?.code === '08P01'
  ) {
    return true;
  }

  return /could not serialize|deadlock detected|lock timeout|canceling statement due to lock timeout|connection terminated|connection closed|server has closed the connection|ECONNRESET/i.test(
    candidate?.message ?? '',
  );
}

export async function withDbRetry<T>(
  label: string,
  work: () => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableDbError(error)) throw error;

      logger.warn(`${label}: transient database error, retry ${attempt}`);
      // Jittered backoff so replayed transactions do not line up and collide
      // with each other again.
      await sleep(50 * attempt + Math.floor(Math.random() * 50));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
