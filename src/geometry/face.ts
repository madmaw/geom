import { ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, vec3 } from "gl-matrix";
import { Line, lineIntersection } from "./line";
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
    const delta = vec3.subtract(vec3.create(), p2, p1);
    const direction = vec3.normalize(vec3.create(), delta);
    const line2: Line = [direction as ReadonlyVec2, p1 as ReadonlyVec2];
    const intersection1 = lineIntersection(
      line1,
      line2,
    );
    const intersection2 = lineIntersection(
      line2,
      line1,
    );
    if (intersection1 > 0
      && intersection2 > 0
      && intersection2 < vec3.length(delta)
    ) {
      count++;
    };
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