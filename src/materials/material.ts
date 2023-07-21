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

export function featureMaterial(
  f: FeatureFactory,
  minDimension: number,
  dDimension: number,
  quantity: number,
): Material {
  return function(ctx: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    const z = imageData.data[2];

    for(let i=0; i<quantity; i++) {
      const dimension = minDimension + dDimension * Math.pow(Math.random(), 2);
      const r = dimension/2;
      const x = imageData.width * Math.random();
      const y = imageData.height * Math.random();
      const feature = f(r, z);
      for (let dx = 0; dx < dimension; dx++) {
        const px = x + dx | 0;
        for (let dy = 0; dy < dimension; dy++) {
          const py = y + dy | 0;
          let index = ((py % imageData.height) * imageData.width
            + (px % imageData.width)) * 4;
          const v = imageData.data.slice(index, index + 4);
          const w = feature(v, dx - r, dy - r) || v;
          imageData.data.set(w, index);
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };
};