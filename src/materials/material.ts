export type Material = (ctx: CanvasRenderingContext2D) => void;

export type ImageDataMaterial = (imageData: ImageData) => void;

export function imageDataMaterial(f: ImageDataMaterial): Material {
  return function(ctx: CanvasRenderingContext2D) {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    f(imageData);
    ctx.putImageData(imageData, 0, 0);
  };
}