import { vec3 } from "gl-matrix";
import { FeatureFactory } from "./material";
import { DEPTH_RANGE } from "../constants";

export function craterFeature(maxDepth: number): FeatureFactory {
  return function(r: number, z: number) {
    return function(v: Uint8ClampedArray, dx: number, dy: number) {
      const dzsq = r * r - dx * dx - dy * dy;
      if (dzsq > 0) {
        const existingDepth = v[2];
        const depth = Math.sqrt(dzsq);
        const depthValue = z - depth / (DEPTH_RANGE * 2);
        if (depthValue < existingDepth) {
          const [nx, ny] = vec3.normalize(vec3.create(), [-dx, -dy, -depth]);
          return [
            (nx + 1) * 127 | 0,
            (ny + 1) * 127 | 0,
            depthValue | 0,
            Math.abs(v[3] - Math.pow(Math.min(1, depth/maxDepth), 2) * 127 - 127) + 127 | 0
          ];
        }
      }
    };
  };
}