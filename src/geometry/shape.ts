import { ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { Plane, planeToTransforms } from "./plane";
import { Subtraction } from "./subtraction";

export type Shape = Subtraction<readonly Plane[]>;

export function shapeContainsPoint(shape: Shape, point: ReadonlyVec3): boolean {
  return shape.value.every(plane => {
    const transforms = planeToTransforms(plane);
    const transform = mat4.multiply(mat4.create(), ...transforms);
    const inverse = mat4.invert(mat4.create(), transform);
    const p = vec3.transformMat4(vec3.create(), point, inverse);
    return p[2] < 0;
  }) && !shape.subtractions.some(shape => shapeContainsPoint(shape, point));
}
