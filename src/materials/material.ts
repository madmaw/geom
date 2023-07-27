import { ReadonlyVec2, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { MATERIAL_TEXTURE_DIMENSION, THREE_WAY_NORMALS } from "../constants";
import { lineIntersectsPoints } from "../geometry/line";

export type Material = (ctx: CanvasRenderingContext2D, ctx2: CanvasRenderingContext2D) => void;

export type ImageDataMaterial = (imageData: ImageData) => void;

export function imageDataMaterial(f: ImageDataMaterial): Material {
  return function(ctx: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    f(imageData);
    ctx.putImageData(imageData, 0, 0);
  };
}

// [nx, ny, d, feature color]
type Feature = (
  v: Uint8ClampedArray,
  dx: number,
  dy: number,
) => [number, number, number, number];
export type FeatureFactory = (r: number, z: number) => Feature;

// [surface color]
type Surface = (
  v: Uint8ClampedArray,
  dx: number,
  dy: number,
) => [number];
export type SurfaceFactory = (r: number) => Surface;

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

export function evenDistributionFactory(d: number): Distribution {
  let x = 0;
  let y = 0;
  return function () {
    const ox = x;
    const oy = y;
    x += d;
    if (x > MATERIAL_TEXTURE_DIMENSION - d) {
      x = 0;
      y += d;
    }
    return [
      ox, 
      oy,
      1,
      ];
  };
}

export function featureMaterial(
  f: FeatureFactory | SurfaceFactory,
  baseDimension: number,
  quantity: number,
  distribution: Distribution,
): Material {
  return function(ctx: CanvasRenderingContext2D, ctx2: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);
    const imageData2 = ctx2.getImageData(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);
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
          const ox = dx - r + .5;
          const oy = dy - r + .5;
          const w = feature(v, ox, oy);
          if (w) {
            if (w.length > 1) {
              imageData.data.set(w, index);
              imageData2.data.set(
                [
                  ox + 127.5 | 0,
                  oy + 127.5 | 0,
                  r | 0,
                ],
                index,
              );

            } else {
              imageData2.data.set(w, index + 3);
            }
          }  
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    ctx2.putImageData(imageData2, 0, 0);
  };
};