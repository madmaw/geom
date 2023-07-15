export function createFlatMaterialFactory(depth: number, color: number) {
  const fillStyle = `rgba(127,127,${depth},${color})`;
  return function(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  };
}