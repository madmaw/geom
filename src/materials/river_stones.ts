import { vec3 } from "gl-matrix";
import { FeatureFactory } from "./material";
import { DEPTH_RANGE } from "../constants";

export function riverStonesFactory(
  depthScale: number,
): FeatureFactory {
  return function(r: number, z: number) {
    const c = Math.random() * 127;
    return function(v: Uint8ClampedArray, dx: number, dy: number) {
      const stoneDepth = r * depthScale;
      const dzsq = r * r - dx * dx - dy * dy;
      if (dzsq > 0) {
        const existingDepth = v[2];
        const dz = Math.sqrt(dzsq);
        const depth = Math.min(stoneDepth, dz);
        const depthValue = z + depth / (DEPTH_RANGE * 2);
        if (depthValue > existingDepth) {
          const [nx, ny] = dz < stoneDepth ? vec3.normalize(vec3.create(), [dx, dy, dz]) : [0, 0];
          return [
            (nx + 1) * 127 | 0,
            (ny + 1) * 127 | 0,
            depthValue | 0,
            127 + c | 0
          ];  
        }
      }
    };
  };
}