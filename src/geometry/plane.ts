import { ReadonlyVec3, vec3 } from "gl-matrix";

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

