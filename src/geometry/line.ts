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
  // parallel
  if (Math.abs(rny1) < EPSILON) {
    return;
  }
  const [rdx, rdy] = vec2.rotate(vec2.create(), [dx, dy], [0, 0], -a);
  return rdy/rny1;
}

export function lineDistance([p1, p2]: Line, p: ReadonlyVec2): number {
  const [px1, py1] = p1;
  const [px2, py2] = p2;
  const a = Math.atan2(py2 - py1, px2 - px1);
  const rp2 = vec2.rotate(vec2.create(), p2, p1, -a);
  const [rpx2] = rp2;
  const [rpx, rpy] = vec2.rotate(vec2.create(), p, p1, -a);
  if (rpx > px1 && rpx < rpx2) {
    return Math.abs(rpy - py1);
  } else {
    return Math.min(...[p1, rp2].map(([x, y]) => {
      const dx = rpx - x;
      const dy = rpy - y;
      return Math.sqrt(dx * dx + dy * dy);
    }));
  }
}