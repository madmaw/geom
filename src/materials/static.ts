import { FeatureFactory } from "./material";

export function staticFactory(
  range: number,
): FeatureFactory {
  return function() {
    const delta = Math.random() * range * 2 - range;
    return function(v: Uint8ClampedArray) {
      const c = v[3];
      v[3] = Math.max(127, Math.min(255, c + delta)) | 0;
      return v;
    };
  };
}
