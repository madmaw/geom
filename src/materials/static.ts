import { Material } from "./material";

export function staticFactory(
  proxied: Material,
  dimension: number,
  range: number,
  quantity: number,
): Material {
  return function(imageData: ImageData) {
    proxied(imageData);
    for (let i=0; i<quantity; i++) {
      const x = imageData.width * Math.random() | 0;
      const y = imageData.height * Math.random() | 0;
      const delta = Math.random() * range * 2 - range;
      for (let px = x | 0; px < x + dimension; px++) {
        for (let py = y | 0; py < y + dimension; py++) {
          let index = ((py % imageData.height) * imageData.width
            + (px % imageData.width)) * 4 + 3;
          const d = imageData.data[index];
          imageData.data[index] = Math.max(127, Math.min(255, d - delta)) | 0;
        }
      }
    }
  };
}
