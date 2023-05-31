import { ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, vec3 } from "gl-matrix";
import { Subtraction } from "./subtraction";
import { Line, lineIntersection } from "./line";

export type Face = {
  readonly transform: ReadonlyMat4,
  readonly polygon: Subtraction<ConvexPolygon>,
  readonly lines: readonly Line[],
};

// the expectation is that z is always 0
export type ConvexPolygon = readonly ReadonlyVec3[];

export function faceContainsPoint(
  face: Subtraction<ConvexPolygon>,
  point: ReadonlyVec3,
): boolean {
  return convexPolygonContainsPoint(face.value, point) && !face.subtractions.some(
    face => faceContainsPoint(face, point)
  );
}

function convexPolygonContainsPoint(
  polygon: ConvexPolygon,
  point: ReadonlyVec3,
): number {
  const line: Line = [[0, 1], point as ReadonlyVec2];
  const count = polygon.reduce((count, p1, i) => {
    const p2 = polygon[(i + 1)%polygon.length];
    const delta = vec3.subtract(vec3.create(), p2, p1);
    const direction = vec3.normalize(vec3.create(), delta);
    if (lineIntersection(line, [direction as ReadonlyVec2, p1 as ReadonlyVec2]) > 0) {
      count++;
    };
    return count;
  }, 0);
  return count % 2;
}
