import { ReadonlyVec2, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { EPSILON } from "./constants";

// normalized direction, point
export type Line = readonly [ReadonlyVec2, ReadonlyVec2];

export function toLine(p1: ReadonlyVec3, p2: ReadonlyVec3): Line {
  const delta = vec2.normalize(
    vec2.create(),
    vec2.subtract(
      vec2.create(),
      p2 as ReadonlyVec2,
      p1 as ReadonlyVec2,
    ),
  );
    return [delta, p1 as ReadonlyVec2];
}

export function lineIntersectsPoints(p1: ReadonlyVec3, p2: ReadonlyVec3, line1: Line): number | false {
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
  return intersection1 > 0
    && intersection2 > 0
    && intersection2 < vec3.length(delta)
    && intersection1;
}

export function lineDeltaAndLength(p1: ReadonlyVec3, p2: ReadonlyVec3, line: Line): [number | undefined, number, ReadonlyVec3] {
  const delta = vec3.subtract(vec3.create(), p2, p1);
  const length = vec3.length(delta);
  const direction = vec3.normalize(vec3.create(), delta);
  const edge: Line = [
    direction as ReadonlyVec2,
    p1 as ReadonlyVec2,
  ];
  const nextIntersectionD = lineIntersection(edge, line);
  return [nextIntersectionD, length, direction];
}

export function  lineIntersection(
  [n1, [px1, py1]]: Line,
  [[nx2, ny2], [px2, py2]]: Line,
): number | undefined {
  const dx = px2 - px1;
  const dy = py2 - py1;
  const a = Math.atan2(ny2, nx2);
  const [rnx1, rny1] = vec2.rotate(vec2.create(), n1, [0, 0], -a);
  // parallel
  if (Math.abs(rny1) < EPSILON) {
    return;
  }
  const [rdx, rdy] = vec2.rotate(vec2.create(), [dx, dy], [0, 0], -a);
  return rdy/rny1;
}

export function closestLinePointVector([p1, p2]: Line, p: ReadonlyVec2): ReadonlyVec2 {
  const [px1, py1] = p1;
  const [px2, py2] = p2;
  const a = Math.atan2(py2 - py1, px2 - px1);
  const rp2 = vec2.rotate(vec2.create(), p2, p1, -a);
  const [rpx2, rpy2] = rp2;
  const [rpx, rpy] = vec2.rotate(vec2.create(), p, p1, -a);
  let cx: number;
  let cy: number;
  if (rpx < px1) {
    cx = px1;
    cy = py1;
  } else if (rpx > rpx2 ) {
    cx = rpx2;
    cy = rpy2;
  } else {
    cx = rpx;
    cy = py1;
  }
  return vec2.rotate(vec2.create(), [rpx - cx, rpy - cy], [0, 0], a);
}