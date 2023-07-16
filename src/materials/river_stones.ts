import { vec3 } from "gl-matrix";
import { Material, imageDataMaterial } from "./material";

export function riverStonesFactory(
  minRadius: number,
  dRadius: number,
  maxDepth: number,
  quantity: number,
): Material {
  return imageDataMaterial(function(imageData: ImageData) {
    const z = imageData.data[2];

    for (let i=0; i<quantity; i++) {
      const r = minRadius + dRadius * Math.random();
      const stoneDepth = maxDepth * r / (minRadius + dRadius);
      const d = r * 2;
      const x = Math.random() * imageData.width;
      const y = Math.random() * imageData.height;
      //const z = imageData.data[(y * imageData.width + x) * 4 + 2 | 0];
      const c = Math.random() * 127;
      for (let px = x | 0; px < x + d; px++) {
        for (let py = y | 0; py < y + d; py++) {
          const dx = px - x - r;
          const dy = py - y - r;
          const dzsq = r * r - dx * dx - dy * dy;
          if (dzsq > 0) {
            let index = ((py % imageData.height) * imageData.width
              + (px % imageData.width)) * 4;
            const existingDepth = imageData.data[index + 2];
            const dz = Math.sqrt(dzsq);
            const depth = Math.min(stoneDepth, dz);
            // TODO we lose too much precion here and the range of the depth is too wide (-.5 -> .5)
            // we can fix this in the shader
            const depthValue = z - depth/2;
            if (depthValue < existingDepth) {
              const [nx, ny] = dz < stoneDepth ? vec3.normalize(vec3.create(), [dx, dy, dz]) : [0, 0];
              imageData.data.set([
                (nx + 1) * 127 | 0,
                (ny + 1) * 127 | 0,
                depthValue | 0,
                127 + c | 0
              ], index);  
            }
          }
        }
      }
    }
  });
}