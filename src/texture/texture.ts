import { Face } from "../geometry/face";

export const TEXTURE_SCALE = 30;
const BUFFER = 10;

export function createTexture(
  ctx: CanvasRenderingContext2D,
  faces: Face[],
): readonly (readonly [number, number])[] {
  let x = 0;
  let y = 0;
  let maxHeight = 0;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  return faces.map(face => {
    const {
      polygons,
      transform,
    } = face;
    ctx.fillStyle = `rgb(${Math.random() * 255 | 0}, ${Math.random() * 255 | 0}, ${Math.random() * 255 | 0})`;
    const points = polygons.flat(1);
    const [[minX, minY], [maxX, maxY]] = points.reduce<[[number, number, number], [number, number, number]]>(([min, max], point) => {
      const newMin = min.map((v, i) => Math.min(v, point[i])) as [number, number, number];
      const newMax = max.map((v, i) => Math.max(v, point[i])) as [number, number, number];
      return [newMin, newMax];
    }, [[...points[0]] as [number, number, number], [...points[0] as [number, number, number]]]);

    const width = (maxX - minX) * TEXTURE_SCALE + BUFFER * 2;
    const height = (maxY - minY) * TEXTURE_SCALE + BUFFER * 2;
    
    if (x + width > ctx.canvas.width) {
      x = 0;
      y += maxHeight;
      maxHeight = 0;
    }
    const ox = x;
    x += width;
    maxHeight = Math.max(height, maxHeight);
    ctx.fillRect(ox, y, width, height);
    polygons.forEach(polygon => {
      ctx.beginPath();
      polygon.forEach(([px, py], i) => {
        if (i) {
          ctx.lineTo(ox + (px - minX) * TEXTURE_SCALE + BUFFER, y + (py - minY) * TEXTURE_SCALE + BUFFER);
        } else {
          ctx.moveTo(ox + (px - minX) * TEXTURE_SCALE + BUFFER, y + (py - minY) * TEXTURE_SCALE + BUFFER);
        }
      });
      ctx.closePath();
      ctx.stroke();
    });
    
    return [
      ox + BUFFER - minX * TEXTURE_SCALE,
      y + BUFFER - minY * TEXTURE_SCALE,
    ];
  });
}