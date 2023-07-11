import { vec3 } from "gl-matrix";
import { Material } from "./material";

export function riverStonesFactory(maxDepth: number, quantity: number): Material {
  return function(imageData: ImageData) {
    for (let i=0; i<quantity; i++) {
      const d = Math.random() * maxDepth + maxDepth;
      const r = d/2;
      const x = Math.random() * imageData.width;
      const y = Math.random() * imageData.height;
      const c = Math.random() * 128;
      const maxZ = maxDepth / (1.3 + Math.random());
      for (let px = x | 0; px < (x + d + 1 | 0); px++) {
        for (let py = y | 0; py < (y + d + 1 | 0); py++) {
          const dx = px - x - r;
          const dy = py - y - r;
          const dzsq = r * r - dx * dx - dy * dy;
          if (dzsq > 0) {
            let index = ((py % imageData.height) * imageData.width
              + (px % imageData.width)) * 4;
            const existingDepth = imageData.data[index + 2];
            const dz = Math.sqrt(dzsq);
            const depth = Math.min(maxZ, dz);
            const depthValue = 127 - depth;
            if (depthValue < existingDepth) {
              const [nx, ny] = dz < maxZ ? vec3.normalize(vec3.create(), [dx, dy, dz]) : [0, 0];
              imageData.data.set([
                (nx + 1) * 127 | 0,
                (ny + 1) * 127 | 0,
                depthValue | 0,
                255 - c | 0
              ], index);  
            }
          }
        }
      }
    }
  };
}