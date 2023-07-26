import { FeatureFactory, SurfaceFactory } from "./material";

export function staticFactory(
  range: number,
): SurfaceFactory {
  return function() {
    const delta = Math.random() * range * 2 - range;
    return function(v: Uint8ClampedArray) {
      const c = v[3];
      return [Math.max(127, Math.min(255, c + delta)) | 0];
    };
  };
}
