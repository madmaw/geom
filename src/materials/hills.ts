import { vec3 } from "gl-matrix";
import { FeatureFactory } from "./material";
import { DEPTH_RANGE } from "../constants";

export function hillFeature(scale: number): FeatureFactory {
  return function(maxr: number, z: number) {
    const maxDepth = scale * maxr;
    return function(dx: number, dy: number, c: number, existingDepth: number) {
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < maxr) {
        const a = r * Math.PI/maxr;
        
        const depth = (Math.cos(a) + 1) * maxDepth/2;
        const depthValue = z + depth / (DEPTH_RANGE * 2);
        // TODO XOR
        if (depthValue > existingDepth && scale > 0 || depthValue < existingDepth && scale < 0) {
          const az = Math.atan2(dy, dx);
          const ay = Math.atan(-Math.sin(a) * scale) + Math.PI/2; 

          const [nx, ny] = vec3.normalize(
            vec3.create(),
            vec3.rotateZ(
              vec3.create(),
              vec3.rotateY(
                vec3.create(),
                [1, 0, 0],
                [0, 0, 0],
                ay,
              ),
              [0, 0, 0],
              az,
            ));
          return [
            (nx + 1) * 127 | 0,
            (ny + 1) * 127 | 0,
            depthValue | 0,
            z + depth * 2 / DEPTH_RANGE | 0
          ];
        }
      }
    };
  };
}