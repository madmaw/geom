import { ReadonlyVec2, vec2 } from "gl-matrix";
import { EPSILON } from "./constants";

// normalized direction, point
export type Line = readonly [ReadonlyVec2, ReadonlyVec2];

export function lineIntersection(
  [n1, [px1, py1]]: Line,
  [[nx2, ny2], [px2, py2]]: Line,
): number | undefined {
  const dx = px2 - px1;
  const dy = py2 - py1;
  const a = Math.atan2(ny2, nx2);
  const [rnx1, rny1] = vec2.rotate(vec2.create(), n1, [0, 0], -a);
  // not parallel
  if (Math.abs(rny1) < EPSILON) {
    return;
  }
  const [rdx, rdy] = vec2.rotate(vec2.create(), [dx, dy], [0, 0], -a);
  return rdy/rny1;
}