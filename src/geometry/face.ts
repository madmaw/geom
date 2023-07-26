import { ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, vec3 } from "gl-matrix";
import { Line, lineIntersection, lineIntersectsPoints } from "./line";
import { EPSILON } from "./constants";

export type Face = {
  readonly toWorldCoordinates: ReadonlyMat4,
  readonly rotateToWorldCoordinates: ReadonlyMat4,
  readonly polygons: readonly ConvexPolygon[],
};

// the expectation is that z is always 0
export type ConvexPolygon = readonly ReadonlyVec3[];

export function convexPolygonContainsPoint(
  polygon: ConvexPolygon,
  point: ReadonlyVec3,
): number {
  const line1: Line = [[0, 1], point as ReadonlyVec2];
  const count = polygon.reduce((count, p1, i) => {
    const p2 = polygon[(i + 1)%polygon.length];
    if (lineIntersectsPoints(p1, p2, line1)) {
      count++;
    }
    return count;
  }, 0);
  return count % 2;
}

export function dedupePolygon(polygon: ConvexPolygon) {
  return polygon.filter((p1, i) => {
    const p2 = polygon[(i + 1)%polygon.length];
    const length = vec3.length(vec3.subtract(vec3.create(), p1, p2));
    return length > EPSILON;
  });
}