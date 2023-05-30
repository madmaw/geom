import { ReadonlyVec2, ReadonlyVec3, mat4, vec2, vec3 } from "gl-matrix";
import { Face } from "./face";
import { Shape } from "./shape";
import { Triangle3 } from "./triangle3";
import { Line } from "./line";

export function decompose(shape: Shape): readonly Triangle3[] {
  const faces = decomposeShapeToFaces(shape);
  return [];
}

const NORMAL_X: ReadonlyVec3 = [1, 0, 0];
const NORMAL_Z: ReadonlyVec3 = [0, 0, 1];
const EPSILON = 0.0001;

export function decomposeShapeToFaces(shape: Shape): readonly Face[] {
  
  // break the shape into faces
  const faces = shape.value.map<Face[]>(([direction, offset]) => {
    const cosRadians = vec3.dot(NORMAL_Z, direction);
    const translate = mat4.translate(
      mat4.create(),
      mat4.identity(mat4.create()),
      offset,
    );
    const axis = Math.abs(cosRadians) < 1 - EPSILON 
        ? vec3.normalize(
          vec3.create(),
          vec3.cross(vec3.create(), NORMAL_Z, direction),
        ) 
        : NORMAL_X;
    const rotate = mat4.rotate(
      mat4.create(), 
      mat4.identity(mat4.create()),
      Math.acos(cosRadians),
      axis,
    );
    const transform = mat4.multiply(mat4.create(), translate, rotate);
    //const transform = rotate;
    const inverseRotate = mat4.invert(mat4.create(), rotate);
    const inverse = mat4.invert(mat4.create(), transform);
    const lines = shape.value.map<Line[]>(([compareDirection, compareOffset]) => {
      const rotatedCompareNormal = vec3.transformMat4(
        vec3.create(),
        compareDirection,
        inverseRotate,
      );
      if (Math.abs(rotatedCompareNormal[2]) > 1 - EPSILON) {
        return [];
      }
      const rotatedCompareOffset = vec3.transformMat4(
        vec3.create(),
        compareOffset,
        inverse,
      );
      // work out the intersection line of this plane with the current plane
      const intersectionDirection = vec3.normalize(
        vec3.create(), 
        vec3.cross(vec3.create(), rotatedCompareNormal, NORMAL_Z),
      );
      const planeDirection = vec3.normalize(
        vec3.create(),
        vec3.cross(vec3.create(), intersectionDirection, rotatedCompareNormal),
      );
      const intersectionProportion = rotatedCompareOffset[2]/planeDirection[2];
      const intersectionPoint = rotatedCompareOffset.map((v, i) => (
        v - intersectionProportion * planeDirection[i]
      ));
      // NOTE: these are actually vec3s
      return [[
        intersectionDirection as ReadonlyVec2,
        intersectionPoint as ReadonlyVec2,
      ]];
    }).flat(1);

    // work out the intersections
    const intersections = lines.map<([number, ReadonlyVec3] | 0)>(line => {
      let maxD: number | undefined;
      let maxLineIndex: number | undefined;
      const [[nx2, ny2], [px2, py2]] = line;
      lines.forEach((compare, compareIndex) => {
        const [[nx1, ny1], [px1, py1]] = compare; 
        const cosAngle = vec2.dot([-ny2, nx2], [nx1, ny1]);
        if (cosAngle > EPSILON) {
          const d = (nx1 * py2 - nx1 * py1 - ny1 * px2 + ny1 * px1)/(ny1 * nx2 - nx1 * ny2);
          if (!(d < maxD)) {
            maxD = d;
            maxLineIndex = compareIndex;
          }
        }
      });
      return maxD < 0
        ? [maxLineIndex, [px2 + nx2 * maxD, py2 + ny2 * maxD, 0]]
        : 0;
    });

    // walk the perimeter
    let intersection = intersections.find(i => i);
    let startIndex = -1;
    const perimeterIntersections: [number, ReadonlyVec3][] = [];
    while (intersection && startIndex < 0) {
      const nextIntersection = intersections[intersection[0]];
      perimeterIntersections.push(intersection);
      intersection = nextIntersection;
      startIndex = perimeterIntersections.indexOf(
        intersection as [number, ReadonlyVec3],
      );
    }
    // trim off any non circular bits
    perimeterIntersections.splice(0, startIndex);
    // ignore any empty shapes
    if (perimeterIntersections.length < 3) {
      return [];
    }
    // convert to points
    const perimeter = perimeterIntersections.map(
      intersection => intersection[1],
    );
    const face: Face = {
      lines,
      polygon: {
        subtractions: [],
        value: perimeter,
      },
      transform,
    };
    return [face];
  }).flat(1);
  return faces;
}


