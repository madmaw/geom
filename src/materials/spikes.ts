import { vec3 } from "gl-matrix";
import { Material, imageDataMaterial } from "./material";
import { DEPTH_RANGE } from "../constants";

export function spikesFactory(
  minRadius: number,
  dRadius: number,
  minDepth: number,
  dDepth: number,
  quantity: number,
): Material {
  const maxDepth = minDepth + dDepth;
  return imageDataMaterial(function (imageData: ImageData) {
    const z = imageData.data[2];
    for (let i=0; i<quantity; i++) {
      const r = minRadius + dRadius * Math.random();
      const d = minDepth + dDepth * Math.random();
      const x = Math.random() * imageData.width;
      const y = Math.random() * imageData.height;
      const axy = Math.atan2(d, r);
      const cosaxy = Math.cos(axy);
      const sinaxy = Math.sin(axy);
      for (let px = x | 0; px < x + r * 2; px++) {
        for (let py = y | 0; py < y + r * 2; py++) {
          const dx = px - x - r;
          const dy = py - y - r;
          const dxysq = dx * dx + dy * dy;
          if (dxysq < r * r) {
            let index = ((py % imageData.height) * imageData.width
              + (px % imageData.width)) * 4;
            const existingDepth = imageData.data[index + 2];
            const depth = (1 - Math.sqrt(dxysq)/r) * d;
            const depthValue = z + depth / (DEPTH_RANGE * 2);
            if (depthValue > existingDepth) {
              const az = Math.atan2(dy, dx);
              const [nx, ny] = vec3.normalize(
                vec3.create(), 
                [
                    Math.cos(az) * sinaxy,
                    Math.sin(az) * sinaxy,
                    cosaxy,
                ],
              );

              imageData.data.set([
                (nx + 1) * 127 | 0,
                (ny + 1) * 127 | 0,
                depthValue | 0,
                127 + depth * 127/maxDepth | 0
              ], index);
            }
          }
        }
      }
    }
  });
}