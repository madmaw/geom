import { ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { Plane, planeToTransforms } from "./plane";
import { Subtraction } from "./subtraction";
import { EPSILON } from "./constants";

export type Shape = Subtraction<readonly Plane[]>;

export function shapesContainPoint(
  shapes: readonly Shape[],
  point: ReadonlyVec3,
  includeSubtractions: boolean
): boolean {
  return shapes.some(shape => {
    const subtracted = shapesContainPoint(shape.subtractions, point, includeSubtractions);
    const contained = !shape.value.some(plane => {
      const transforms = planeToTransforms(plane);
      const transform = mat4.multiply(mat4.create(), ...transforms);
      const inverse = mat4.invert(mat4.create(), transform);
      const p = vec3.transformMat4(vec3.create(), point, inverse);
      return p[2] > -EPSILON;
    });
    return includeSubtractions
      ? subtracted || contained
      : contained && !subtracted;
  });
}
