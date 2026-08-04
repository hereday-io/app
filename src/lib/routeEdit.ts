import type { Coord, EventRoute } from '@/types/mapEditor';

/**
 * Geometry for editing an existing route: move a waypoint, insert one between
 * two others, delete one.
 *
 * All of it is pure. The caller resolves the replacement segments (via
 * getSnappedRoute, or straight lines when snap-to-roads is off) and hands them
 * in; these functions only splice.
 *
 * ## The counts contract
 *
 * `segmentCoordCounts` is the index that makes local edits possible — without
 * it there's no way to know which slice of `routeCoords` belongs to which
 * waypoint, and the only safe edit would be re-snapping the entire route.
 *
 *   counts[0]    always 1 — a placeholder for the first coordinate
 *   counts[i>=1] how many coordinates the segment waypoint[i-1] -> waypoint[i]
 *                contributed, excluding its shared start point
 *
 * so `sum(counts) === routeCoords.length`, and waypoint i sits at
 * `routeCoords[sum(counts[0..i]) - 1]`.
 *
 * Every function here preserves that invariant. `routeEdit.test.ts` asserts it
 * after each operation, because a drift of one silently mangles later edits
 * rather than throwing.
 */

/** Index into routeCoords where each waypoint sits. */
export function waypointOffsets(counts: number[]): number[] {
  const out: number[] = [];
  let acc = -1;
  for (const c of counts) {
    acc += c;
    out.push(acc);
  }
  return out;
}

const sq = (a: Coord, b: Coord) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/**
 * Recover a counts array by matching each waypoint to its nearest coordinate.
 *
 * Needed for routes drawn before `segmentCoordCounts` existed, and as a
 * self-heal if the array ever drifts out of sync with `waypoints`. The scan is
 * monotonic, so a route that doubles back can't match a later waypoint to an
 * earlier coordinate.
 */
export function deriveCounts(waypoints: Coord[], routeCoords: Coord[]): number[] {
  const n = waypoints.length;
  const L = routeCoords.length;
  if (n === 0 || L === 0) return [];
  if (n === 1) return [L];

  const idx: number[] = [0];
  let from = 0;
  for (let w = 1; w < n; w++) {
    // Reserve one coordinate for each waypoint still to be placed, so the
    // indices stay strictly increasing and every count lands >= 1.
    const hi = L - 1 - (n - 1 - w);
    let best = Math.min(from + 1, hi);
    let bestD = Infinity;
    for (let i = best; i <= hi; i++) {
      const d = sq(routeCoords[i], waypoints[w]);
      if (d < bestD) { bestD = d; best = i; }
    }
    idx.push(best);
    from = best;
  }

  return idx.map((v, i) => (i === 0 ? 1 : v - idx[i - 1]));
}

/** The route's counts, repaired if absent or the wrong length. */
export function countsFor(route: EventRoute): number[] {
  const c = route.segmentCoordCounts;
  if (c && c.length === route.waypoints.length
    && c.reduce((a, b) => a + b, 0) === route.routeCoords.length) {
    return c;
  }
  return deriveCounts(route.waypoints, route.routeCoords);
}

/**
 * Which segment a map coordinate falls on, as the index of the waypoint that
 * *ends* it. A return of `j` means "between waypoint j-1 and j", which is also
 * the array position a new waypoint should be inserted at.
 */
export function segmentAt(route: EventRoute, coord: Coord): number {
  const offs = waypointOffsets(countsFor(route));
  let best = 0;
  let bestD = Infinity;
  route.routeCoords.forEach((c, i) => {
    const d = sq(c, coord);
    if (d < bestD) { bestD = d; best = i; }
  });
  for (let j = 1; j < offs.length; j++) if (best <= offs[j]) return j;
  return Math.max(1, offs.length - 1);
}

/** What the caller must snap before calling the matching apply function. */
export interface EditAnchors {
  /** Segment start, or null when editing the first waypoint. */
  prev: Coord | null;
  /** Segment end, or null when editing the last waypoint. */
  next: Coord | null;
}

export function moveAnchors(route: EventRoute, index: number): EditAnchors {
  return {
    prev: index > 0 ? route.waypoints[index - 1] : null,
    next: index < route.waypoints.length - 1 ? route.waypoints[index + 1] : null,
  };
}

export function insertAnchors(route: EventRoute, at: number): EditAnchors {
  return { prev: route.waypoints[at - 1] ?? null, next: route.waypoints[at] ?? null };
}

export function deleteAnchors(route: EventRoute, index: number): EditAnchors {
  return {
    prev: index > 0 ? route.waypoints[index - 1] : null,
    next: index < route.waypoints.length - 1 ? route.waypoints[index + 1] : null,
  };
}

/** Drop a segment's shared first coordinate. */
const tailOf = (seg: Coord[]) => (seg.length > 1 ? seg.slice(1) : seg);

/**
 * Move waypoint `index` to `newPos`.
 *
 * `before` is the resolved path prev -> newPos (both ends included), `after`
 * the path newPos -> next. Pass null for whichever doesn't exist at an endpoint.
 * Everything outside those two segments is left byte-for-byte alone — which is
 * what keeps an imported GPX intact away from the edit.
 */
export function applyVertexMove(
  route: EventRoute,
  index: number,
  newPos: Coord,
  before: Coord[] | null,
  after: Coord[] | null,
): EventRoute {
  const counts = [...countsFor(route)];
  const offs = waypointOffsets(counts);
  const last = route.waypoints.length - 1;
  if (index < 0 || index > last) return route;

  const head = index === 0 ? [] : route.routeCoords.slice(0, offs[index - 1] + 1);
  const tail = index === last ? [] : route.routeCoords.slice(offs[index + 1] + 1);

  const mid = index === 0 ? [newPos] : tailOf(before ?? [newPos, newPos]);
  const post = index === last ? [] : tailOf(after ?? [newPos, route.waypoints[index + 1]]);

  if (index > 0) counts[index] = mid.length;
  if (index < last) counts[index + 1] = post.length;

  const waypoints = [...route.waypoints];
  waypoints[index] = newPos;

  return {
    ...route,
    waypoints,
    routeCoords: [...head, ...mid, ...post, ...tail],
    segmentCoordCounts: counts,
  };
}

/**
 * Insert `pos` as a new waypoint at array position `at`, splitting the segment
 * that currently ends at `at`. Only meaningful for 1 <= at <= last.
 */
export function applyVertexInsert(
  route: EventRoute,
  at: number,
  pos: Coord,
  before: Coord[] | null,
  after: Coord[] | null,
): EventRoute {
  const last = route.waypoints.length - 1;
  if (at < 1 || at > last) return route;

  const counts = countsFor(route);
  const offs = waypointOffsets(counts);

  const head = route.routeCoords.slice(0, offs[at - 1] + 1);
  const tail = route.routeCoords.slice(offs[at] + 1);
  const mid = tailOf(before ?? [route.waypoints[at - 1], pos]);
  const post = tailOf(after ?? [pos, route.waypoints[at]]);

  const waypoints = [...route.waypoints];
  waypoints.splice(at, 0, pos);

  const nextCounts = [...counts];
  nextCounts.splice(at, 1, mid.length, post.length);

  return {
    ...route,
    waypoints,
    routeCoords: [...head, ...mid, ...post, ...tail],
    segmentCoordCounts: nextCounts,
  };
}

/**
 * Delete waypoint `index`, rejoining its neighbours via `joined`
 * (the resolved path prev -> next).
 *
 * Deleting an endpoint truncates instead: there's nothing to rejoin, so the
 * route simply ends at the new last waypoint.
 */
export function applyVertexDelete(
  route: EventRoute,
  index: number,
  joined: Coord[] | null,
): EventRoute {
  const last = route.waypoints.length - 1;
  // Below three waypoints there's no line left to speak of; let the caller's
  // clear/delete-route paths handle that rather than producing a degenerate route.
  if (route.waypoints.length <= 2 || index < 0 || index > last) return route;

  const counts = countsFor(route);
  const offs = waypointOffsets(counts);
  const waypoints = route.waypoints.filter((_, i) => i !== index);

  if (index === 0) {
    // New first coordinate is the old second waypoint; counts[0] returns to 1.
    return {
      ...route,
      waypoints,
      routeCoords: route.routeCoords.slice(offs[1]),
      segmentCoordCounts: [1, ...counts.slice(2)],
    };
  }

  if (index === last) {
    return {
      ...route,
      waypoints,
      routeCoords: route.routeCoords.slice(0, offs[last - 1] + 1),
      segmentCoordCounts: counts.slice(0, last),
    };
  }

  const head = route.routeCoords.slice(0, offs[index - 1] + 1);
  const tail = route.routeCoords.slice(offs[index + 1] + 1);
  const mid = tailOf(joined ?? [route.waypoints[index - 1], route.waypoints[index + 1]]);

  const nextCounts = [...counts];
  nextCounts.splice(index, 2, mid.length);

  return {
    ...route,
    waypoints,
    routeCoords: [...head, ...mid, ...tail],
    segmentCoordCounts: nextCounts,
  };
}
