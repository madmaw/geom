import { ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { Plane, planeToTransforms } from "./plane";
import { EPSILON } from "./constants";

export type ConvexShape = readonly Plane[];

export type Shape = readonly [ConvexShape, readonly ConvexShape[]];

export function convexShapeContainPoint(
  shape: ConvexShape,
  point: ReadonlyVec3,
): boolean {
  return !shape.some(plane => {
    const transforms = planeToTransforms(plane);
    const transform = mat4.multiply(mat4.create(), ...transforms);
    const inverse = mat4.invert(mat4.create(), transform);
    const p = vec3.transformMat4(vec3.create(), point, inverse);
    return p[2] > -EPSILON;
  });
}
