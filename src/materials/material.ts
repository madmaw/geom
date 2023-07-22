import { ReadonlyVec2 } from "gl-matrix";
import { MATERIAL_TEXTURE_DIMENSION } from "../constants";

export type Material = (ctx: CanvasRenderingContext2D) => void;

export type ImageDataMaterial = (imageData: ImageData) => void;

export function imageDataMaterial(f: ImageDataMaterial): Material {
  return function(ctx: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    f(imageData);
    ctx.putImageData(imageData, 0, 0);
  };
}

type Feature = (
  v: Uint8ClampedArray,
  dx: number,
  dy: number,
) => ArrayLike<number>;
export type FeatureFactory = (r: number, z: number) => Feature;

// x, y, scale
type Distribution = () => readonly [number, number, number];

export function randomDistributionFactory(
  scaleRandomness: number,
  pow: number,
): Distribution {
  return function(): [number, number, number] {
    return [
      Math.random() * MATERIAL_TEXTURE_DIMENSION,
      Math.random() * MATERIAL_TEXTURE_DIMENSION,
      (1 - scaleRandomness) + scaleRandomness * Math.pow(Math.random(), pow),
    ];
  }
}

// x, y, scale, steps
type Cluster = readonly [number, number, number, number];

export function clusteredDistributionFactory(
  minDistance: number, 
  dDistance: number, 
  minChildren: number,
  dChildren: number,
  scaleRandomness: number,
  steps: number,
): Distribution {
  const clusters: Cluster[] = [];
  return function() {
    if (!clusters.length) {
      clusters.push([
        Math.random() * MATERIAL_TEXTURE_DIMENSION,
        Math.random() * MATERIAL_TEXTURE_DIMENSION,
        (1 - scaleRandomness) + Math.random() * scaleRandomness,
        steps,
      ]);
    }
    const cluster = clusters.shift();
    const [x, y, scale, step] = cluster;
    // add in more
    if (step) {
      clusters.push(...new Array(minChildren + Math.random() * dChildren | 0).fill(0).map<[number, number, number, number]>(() => {
        const a = Math.random() * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const d = minDistance + Math.random() * dDistance;
        return [
          x + cos * d,
          y + sin * d,
          scale * ((1 - scaleRandomness) + scaleRandomness * Math.random()),
          step - 1,
        ];
      }));  
    }
    return cluster as any;
  }
}

export function featureMaterial(
  f: FeatureFactory,
  baseDimension: number,
  quantity: number,
  distribution: Distribution,
): Material {
  return function(ctx: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);
    const z = imageData.data[2];

    for(let i=0; i<quantity; i++) {
      const [x, y, scale] = distribution();
      const dimension = baseDimension * scale;
      const r = dimension/2;
      const feature = f(r, z);
      for (let dx = 0; dx < dimension; dx++) {
        const px = x + dx + MATERIAL_TEXTURE_DIMENSION | 0;
        for (let dy = 0; dy < dimension; dy++) {
          const py = y + dy + MATERIAL_TEXTURE_DIMENSION | 0;
          let index = ((py % MATERIAL_TEXTURE_DIMENSION) * MATERIAL_TEXTURE_DIMENSION
            + (px % MATERIAL_TEXTURE_DIMENSION)) * 4;
          const v = imageData.data.slice(index, index + 4);
          const w = feature(v, dx - r, dy - r) || v;
          imageData.data.set(w, index);
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };
};