// Mobile POI Scout — offline buffer.
//
// Last-resort stash for scout POI submissions that failed with a network
// error. We do not pretend to be a full offline-first sync engine — this
// is a single-queue write-and-retry, nothing more. The IndexedDB glue
// lives in scoutQueueDb.ts; this module decides what to retry and what
// to give up on.

import { submitScoutedPoi } from '@/lib/scoutApi';
import { addPending, deletePending, readAllPending, type PendingPoi } from '@/lib/scoutQueueDb';
import { EdgeFunctionError, userFacingError, type FriendlyError } from '@/lib/userFacingError';

/** Stash a POI that failed to submit so it can be retried later. */
export async function saveScoutPending(
  token: string,
  poi: PendingPoi['poi'],
): Promise<void> {
  await addPending(token, poi);
}

/** A queued pin the server refused. It has been taken out of the queue. */
export interface RejectedPin {
  title: string;
  status: number | null;
  error: FriendlyError;
}

export interface FlushResult {
  flushed: number;
  rejected: RejectedPin[];
}

/**
 * Whether a failed submit might succeed later. No answer from the server
 * (offline, DNS, relay), a 5xx, 408 or 429 means "not now". Any other
 * answer (dead or revoked link, validation error) will say the same
 * thing next time, so the item would block the queue forever.
 * Anything that isn't an EdgeFunctionError is unexpected, so we keep the
 * item rather than lose it.
 */
export function isRetryableSubmitError(err: unknown): boolean {
  if (!(err instanceof EdgeFunctionError)) return true;
  if (err.status === null) return true;
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

// One flush per token at a time, so a mount, an `online` event and a
// fresh submit landing together can't send the same queued pin twice.
const inFlight = new Set<string>();

/**
 * Attempt to flush every pending POI for a given token, oldest first.
 * Items that succeed are removed. Items the server refuses for good are
 * removed too and returned in `rejected`, so the caller can tell the
 * scout which pins didn't make it. The first retryable failure stops the
 * flush; that item and everything behind it stay queued for the next run.
 * A call made while another flush for the same token is running returns
 * an empty result; the running one reports.
 */
export async function flushScoutPending(token: string): Promise<FlushResult> {
  const result: FlushResult = { flushed: 0, rejected: [] };
  if (!navigator.onLine || inFlight.has(token)) return result;
  inFlight.add(token);
  try {
    const pending = await readAllPending(token);
    for (const entry of pending) {
      try {
        await submitScoutedPoi({ token: entry.token, poi: entry.poi });
      } catch (err) {
        if (isRetryableSubmitError(err)) {
          // Assume the network (or the server) is still bad and try again
          // on the next trigger.
          console.warn('[scoutStorage] flush item failed, will retry later', err);
          break;
        }
        if (entry.id != null) await deletePending(entry.id);
        result.rejected.push({
          title: entry.poi.title,
          status: err instanceof EdgeFunctionError ? err.status : null,
          error: userFacingError(err, {
            action: `save “${entry.poi.title}”`,
            logLabel: 'scoutStorage queued pin rejected',
          }),
        });
        continue;
      }
      if (entry.id != null) await deletePending(entry.id);
      result.flushed += 1;
    }
  } catch (err) {
    console.warn('[scoutStorage] flush failed', err);
  } finally {
    inFlight.delete(token);
  }
  return result;
}

/** Count pending items for a token, for UI badges. */
export async function countScoutPending(token: string): Promise<number> {
  try {
    const items = await readAllPending(token);
    return items.length;
  } catch {
    return 0;
  }
}

function listTitles(titles: string[]): string {
  const quoted = titles.map((t) => `“${t}”`);
  if (quoted.length === 1) return quoted[0];
  if (quoted.length <= 3) return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
  return `${quoted.slice(0, 2).join(', ')} and ${quoted.length - 2} more`;
}

export interface FlushToast {
  title: string;
  description?: string;
  variant?: 'destructive';
}

/**
 * The one toast to show after a flush (the app shows one toast at a
 * time), or null when nothing changed. Refused pins win over uploads and
 * are named one by one. A dead or revoked link gets the §3A copy (ask the
 * organizer for a fresh link); any other refusal asks the scout to drop
 * the pin again.
 */
export function flushResultToast(result: FlushResult, stillQueued: number): FlushToast | null {
  const { flushed, rejected } = result;
  if (rejected.length === 0) {
    if (flushed === 0) return null;
    return {
      title: flushed === 1 ? 'Uploaded 1 offline pin' : `Uploaded ${flushed} offline pins`,
      description: stillQueued > 0 ? `${stillQueued} still waiting for a better signal.` : undefined,
    };
  }

  const names = listTitles(rejected.map((r) => r.title));
  const one = rejected.length === 1;
  const uploaded =
    flushed === 0 ? '' : flushed === 1 ? ' Your other offline pin uploaded.' : ` ${flushed} other offline pins uploaded.`;

  const link = rejected.find((r) => r.error.kind === 'link');
  if (link) {
    return {
      title: link.error.title,
      description: `${names} ${one ? "wasn't" : "weren't"} saved. ${link.error.description}${uploaded}`,
      variant: 'destructive',
    };
  }

  return {
    title: one ? `Couldn't save “${rejected[0].title}”` : `Couldn't save ${rejected.length} pins`,
    description:
      (one
        ? "It was stored offline but wasn't accepted when it synced. Drop the pin again."
        : `${names} were stored offline but weren't accepted when they synced. Drop them again.`) + uploaded,
    variant: 'destructive',
  };
}
