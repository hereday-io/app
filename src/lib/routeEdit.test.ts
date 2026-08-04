import { describe, it, expect } from 'vitest';
import type { Coord, EventRoute } from '@/types/mapEditor';
import {
  waypointOffsets, deriveCounts, countsFor, segmentAt,
  applyVertexMove, applyVertexInsert, applyVertexDelete,
  moveAnchors, insertAnchors, deleteAnchors,
} from './routeEdit';

/** A route whose coords run along a straight diagonal, waypoints every `step`. */
function makeRoute(segments = 4, step = 10): EventRoute {
  const total = segments * step + 1;
  const routeCoords: Coord[] = Array.from({ length: total }, (_, i) => [-88 + i / 1000, 42 + i / 1000]);
  const waypoints: Coord[] = [];
  const segmentCoordCounts: number[] = [];
  for (let s = 0; s <= segments; s++) {
    waypoints.push(routeCoords[s * step]);
    segmentCoordCounts.push(s === 0 ? 1 : step);
  }
  return { id: 'r1', name: '5K', color: '#f00', visible: true, waypoints, routeCoords, segmentCoordCounts };
}

/** A resolved segment between two points, with `inner` coords in between. */
const seg = (a: Coord, b: Coord, inner = 3): Coord[] => [
  a,
  ...Array.from({ length: inner }, (_, i) => [
    a[0] + ((b[0] - a[0]) * (i + 1)) / (inner + 1),
    a[1] + ((b[1] - a[1]) * (i + 1)) / (inner + 1),
  ] as Coord),
  b,
];

/**
 * The contract every edit must preserve. A drift of one here doesn't throw at
 * runtime — it silently misaligns the *next* edit — so it is asserted after
 * every operation rather than spot-checked.
 */
function expectInvariants(r: EventRoute, label = '') {
  const counts = r.segmentCoordCounts!;
  expect(counts.length, `${label} counts length`).toBe(r.waypoints.length);
  expect(counts.reduce((a, b) => a + b, 0), `${label} counts sum`).toBe(r.routeCoords.length);
  expect(counts[0], `${label} counts[0]`).toBe(1);
  expect(counts.every((c) => c >= 1), `${label} all counts >= 1`).toBe(true);

  // Every waypoint must sit exactly on the coordinate its offset points at.
  const offs = waypointOffsets(counts);
  offs.forEach((o, i) => {
    expect(r.routeCoords[o], `${label} waypoint ${i} lands on its offset`).toEqual(r.waypoints[i]);
  });
}

describe('waypointOffsets', () => {
  it('maps each waypoint to its coordinate index', () => {
    expect(waypointOffsets([1, 10, 10])).toEqual([0, 10, 20]);
  });
});

describe('the test fixture itself is valid', () => {
  it('satisfies the counts contract', () => expectInvariants(makeRoute()));
});

describe('deriveCounts', () => {
  it('recovers counts for a route that never stored them', () => {
    const r = makeRoute(4, 10);
    expect(deriveCounts(r.waypoints, r.routeCoords)).toEqual(r.segmentCoordCounts);
  });

  it('always produces counts of at least 1, even with duplicate waypoints', () => {
    const coords: Coord[] = Array.from({ length: 5 }, (_, i) => [-88 + i / 1000, 42]);
    const counts = deriveCounts([coords[0], coords[0], coords[0], coords[4]], coords);
    expect(counts.every((c) => c >= 1)).toBe(true);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it('countsFor repairs a route whose stored counts are the wrong length', () => {
    const r = makeRoute();
    const broken = { ...r, segmentCoordCounts: [1, 2] };
    expect(countsFor(broken)).toEqual(r.segmentCoordCounts);
  });

  it('countsFor repairs counts that do not sum to routeCoords.length', () => {
    const r = makeRoute();
    const broken = { ...r, segmentCoordCounts: [1, 1, 1, 1, 1] };
    expect(countsFor(broken).reduce((a, b) => a + b, 0)).toBe(r.routeCoords.length);
  });
});

describe('segmentAt', () => {
  it('returns the waypoint index that ends the clicked segment', () => {
    const r = makeRoute(4, 10);
    expect(segmentAt(r, r.routeCoords[5])).toBe(1);
    expect(segmentAt(r, r.routeCoords[15])).toBe(2);
    expect(segmentAt(r, r.routeCoords[35])).toBe(4);
  });

  it('never returns 0, since that is not an insertable position', () => {
    const r = makeRoute();
    expect(segmentAt(r, r.routeCoords[0])).toBeGreaterThanOrEqual(1);
  });
});

describe('applyVertexMove', () => {
  it('moves an interior waypoint and preserves the contract', () => {
    const r = makeRoute();
    const target: Coord = [-87.5, 42.5];
    const a = moveAnchors(r, 2);
    const out = applyVertexMove(r, 2, target, seg(a.prev!, target), seg(target, a.next!));
    expectInvariants(out, 'interior move');
    expect(out.waypoints[2]).toEqual(target);
    expect(out.waypoints).toHaveLength(r.waypoints.length);
  });

  it('leaves geometry outside the two touched segments byte-for-byte identical', () => {
    const r = makeRoute();
    const target: Coord = [-87.5, 42.5];
    const a = moveAnchors(r, 2);
    const out = applyVertexMove(r, 2, target, seg(a.prev!, target), seg(target, a.next!));
    // Before waypoint 1 and after waypoint 3 must be untouched — this is what
    // keeps an imported GPX intact away from the edit.
    expect(out.routeCoords.slice(0, 11)).toEqual(r.routeCoords.slice(0, 11));
    const outOffs = waypointOffsets(out.segmentCoordCounts!);
    expect(out.routeCoords.slice(outOffs[3])).toEqual(r.routeCoords.slice(30));
  });

  it('moves the first waypoint', () => {
    const r = makeRoute();
    const target: Coord = [-88.5, 41.5];
    const a = moveAnchors(r, 0);
    expect(a.prev).toBeNull();
    const out = applyVertexMove(r, 0, target, null, seg(target, a.next!));
    expectInvariants(out, 'first move');
    expect(out.routeCoords[0]).toEqual(target);
  });

  it('moves the last waypoint', () => {
    const r = makeRoute();
    const last = r.waypoints.length - 1;
    const target: Coord = [-87.1, 42.9];
    const a = moveAnchors(r, last);
    expect(a.next).toBeNull();
    const out = applyVertexMove(r, last, target, seg(a.prev!, target), null);
    expectInvariants(out, 'last move');
    expect(out.routeCoords[out.routeCoords.length - 1]).toEqual(target);
  });

  it('handles a straight-line move when snapping is off (2-point segments)', () => {
    const r = makeRoute();
    const target: Coord = [-87.5, 42.5];
    const a = moveAnchors(r, 2);
    const out = applyVertexMove(r, 2, target, [a.prev!, target], [target, a.next!]);
    expectInvariants(out, 'unsnapped move');
    expect(out.segmentCoordCounts![2]).toBe(1);
  });

  it('is a no-op for an out-of-range index', () => {
    const r = makeRoute();
    expect(applyVertexMove(r, 99, [-88, 42], null, null)).toBe(r);
  });

  it('survives being applied repeatedly without drift', () => {
    let r = makeRoute(6, 8);
    for (let i = 1; i <= 5; i++) {
      const target: Coord = [-88 + i / 100, 42 + i / 100];
      const a = moveAnchors(r, i);
      r = applyVertexMove(r, i, target, seg(a.prev!, target, i), seg(target, a.next!, 6 - i));
      expectInvariants(r, `repeat move ${i}`);
    }
  });
});

describe('applyVertexInsert', () => {
  it('inserts a waypoint mid-segment and preserves the contract', () => {
    const r = makeRoute();
    const pos: Coord = [-87.9, 42.1];
    const a = insertAnchors(r, 2);
    const out = applyVertexInsert(r, 2, pos, seg(a.prev!, pos), seg(pos, a.next!));
    expectInvariants(out, 'insert');
    expect(out.waypoints).toHaveLength(r.waypoints.length + 1);
    expect(out.waypoints[2]).toEqual(pos);
    expect(out.waypoints[3]).toEqual(r.waypoints[2]);
  });

  it('refuses position 0, which would be an extend rather than an insert', () => {
    const r = makeRoute();
    expect(applyVertexInsert(r, 0, [-88, 42], null, null)).toBe(r);
  });

  it('inserting then deleting the same waypoint restores the original geometry', () => {
    const r = makeRoute();
    const pos: Coord = [-87.9, 42.1];
    const ia = insertAnchors(r, 2);
    const inserted = applyVertexInsert(r, 2, pos, seg(ia.prev!, pos), seg(pos, ia.next!));
    const da = deleteAnchors(inserted, 2);
    const back = applyVertexDelete(inserted, 2, seg(da.prev!, da.next!, 9));
    expectInvariants(back, 'round trip');
    expect(back.waypoints).toEqual(r.waypoints);
    expect(back.routeCoords).toHaveLength(r.routeCoords.length);
  });
});

describe('applyVertexDelete', () => {
  it('deletes an interior waypoint and rejoins its neighbours', () => {
    const r = makeRoute();
    const a = deleteAnchors(r, 2);
    const out = applyVertexDelete(r, 2, seg(a.prev!, a.next!, 5));
    expectInvariants(out, 'interior delete');
    expect(out.waypoints).toHaveLength(r.waypoints.length - 1);
    expect(out.waypoints).not.toContainEqual(r.waypoints[2]);
  });

  it('truncates from the front when deleting the first waypoint', () => {
    const r = makeRoute();
    const out = applyVertexDelete(r, 0, null);
    expectInvariants(out, 'front delete');
    expect(out.routeCoords[0]).toEqual(r.waypoints[1]);
  });

  it('truncates from the end when deleting the last waypoint', () => {
    const r = makeRoute();
    const last = r.waypoints.length - 1;
    const out = applyVertexDelete(r, last, null);
    expectInvariants(out, 'end delete');
    expect(out.routeCoords[out.routeCoords.length - 1]).toEqual(r.waypoints[last - 1]);
  });

  it('refuses to delete below two waypoints', () => {
    const r = makeRoute(1, 10);
    expect(r.waypoints).toHaveLength(2);
    expect(applyVertexDelete(r, 0, null)).toBe(r);
  });
});

describe('imported-route shape (decimated waypoints, uneven segments)', () => {
  /** Mirrors what trackToRoute produces: 25 waypoints over a long track. */
  function imported(n = 500, w = 25): EventRoute {
    const routeCoords: Coord[] = Array.from({ length: n }, (_, i) => [-88 - i / 5000, 42 + i / 5000]);
    const indices: number[] = [];
    for (let i = 0; i < w; i++) {
      const idx = Math.round((i * (n - 1)) / (w - 1));
      if (indices[indices.length - 1] !== idx) indices.push(idx);
    }
    return {
      id: 'imp', name: 'GPX', color: '#00f', visible: true,
      waypoints: indices.map((i) => routeCoords[i]),
      routeCoords,
      segmentCoordCounts: indices.map((idx, i) => (i === 0 ? 1 : idx - indices[i - 1])),
    };
  }

  it('the imported fixture satisfies the contract', () => expectInvariants(imported()));

  it('moving a middle vertex only rewrites its two neighbouring segments', () => {
    const r = imported();
    const before = r.routeCoords.length;
    const target: Coord = [-88.05, 42.05];
    const a = moveAnchors(r, 12);
    const out = applyVertexMove(r, 12, target, seg(a.prev!, target, 18), seg(target, a.next!, 18));
    expectInvariants(out, 'imported move');
    // Only ~2/24 of the track is rewritten; the rest is identical.
    const offs = waypointOffsets(out.segmentCoordCounts!);
    expect(out.routeCoords.slice(0, offs[11] + 1)).toEqual(r.routeCoords.slice(0, waypointOffsets(r.segmentCoordCounts!)[11] + 1));
    expect(before - out.routeCoords.length).toBeLessThan(before * 0.1);
  });

  it('deleting a vertex keeps the rest of the imported trace intact', () => {
    const r = imported();
    const a = deleteAnchors(r, 5);
    const out = applyVertexDelete(r, 5, seg(a.prev!, a.next!, 30));
    expectInvariants(out, 'imported delete');
    expect(out.waypoints).toHaveLength(r.waypoints.length - 1);
  });
});
