import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { EPSILON, NORMAL_X, NORMAL_Z } from "./constants";

// normal, point
export type Plane = readonly [ReadonlyVec3, ReadonlyVec3];

export function toPlane(nx: number, ny: number, nz: number, d: number): Plane {
  const normal = vec3.normalize(vec3.create(), [nx, ny, nz]);
  const position = vec3.scale(vec3.create(), normal, d);
  return [
    normal,
    position,
  ];
}

/**
 * returns translation and rotation matrices in that order, these matrices convert 
 * plane coordinates to world coordinates
 */
export function planeToTransforms([normal, offset]: Plane): [ReadonlyMat4, ReadonlyMat4] {
  const cosRadians = vec3.dot(NORMAL_Z, normal);
  const axis = Math.abs(cosRadians) < 1 - EPSILON 
      ? vec3.normalize(
        vec3.create(),
        vec3.cross(vec3.create(), NORMAL_Z, normal),
      ) 
      : NORMAL_X;
  const rotate = mat4.rotate(
    mat4.create(), 
    mat4.identity(mat4.create()),
    Math.acos(cosRadians),
    axis,
  );
  const translate = mat4.translate(
    mat4.create(),
    mat4.identity(mat4.create()),
    offset,
  );
  return [translate, rotate];
}
