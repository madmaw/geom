import { vec3 } from "gl-matrix";
import { Material, imageDataMaterial } from "./material";
import { DEPTH_RANGE } from "../constants";

export function cratersFactory(minDepth: number, maxDepth: number, quantity: number): Material {
  return imageDataMaterial(function (imageData: ImageData) {
    const z = imageData.data[2];
    for (let i=0; i<quantity; i++) {
      const r = minDepth + (maxDepth - minDepth) * Math.pow(Math.random(), 2);
      const d = r * 2;
      const x = Math.random() * imageData.width;
      const y = Math.random() * imageData.height;
      for (let px = x | 0; px < x + d; px++) {
        for (let py = y | 0; py < y + d; py++) {
          const dx = px - x - r;
          const dy = py - y - r;
          const dzsq = r * r - dx * dx - dy * dy;
          if (dzsq > 0) {
            let index = ((py % imageData.height) * imageData.width
              + (px % imageData.width)) * 4;
            const existingDepth = imageData.data[index + 2];
            const depth = Math.sqrt(dzsq);
            const depthValue = z - depth / (DEPTH_RANGE * 2);
            if (depthValue < existingDepth) {
              const [nx, ny] = vec3.normalize(vec3.create(), [-dx, -dy, -depth]);

              imageData.data.set([
                (nx + 1) * 127 | 0,
                (ny + 1) * 127 | 0,
                depthValue | 0,
                255 - Math.pow(depth/maxDepth, 2) * 127 | 0
              ], index);
            }
          }
        }
      }
    }
  });
}