import { vec3 } from "gl-matrix";
import { decompose } from "./decompose";
import { ConvexShape } from "./shape";
import { toPlane } from "./plane";

export function round(
  // base shape to round
  shape: ConvexShape,
  // the radius to round to, or, if negative, to subtract from the base shape
  r: number,
  // corners or edges
  edges?: boolean,
): ConvexShape {
  const faces = decompose([[shape, []]]);
  const normals = faces.flatMap(({ polygons, toWorldCoordinates }) => {
    return polygons.flatMap((polygon) => {
      return polygon.map((point, i) => {
        const nextPoint = polygon[(i + 1)%polygon.length];
        const [worldPoint, nextWorldPoint] = [point, nextPoint].map(point => {
          return vec3.transformMat4(vec3.create(), point, toWorldCoordinates);;
        });
        return edges
          ?  vec3.scale(vec3.create(), vec3.add(vec3.create(), worldPoint, nextWorldPoint), .5)
          : worldPoint
          ;
      });
    });
  });
  const newPlanes = normals.filter((normal, i) => {
    return !normals.slice(0, i).some(compare => {
      return vec3.equals(normal, compare);
    });
  }).map(normal => {
    const [x, y, z] = vec3.normalize(vec3.create(), normal);
    return toPlane(
      x, y, z,
      r > 0 ? r : vec3.length(normal) + r,
    );
  });
  return [...shape, ...newPlanes];
}
