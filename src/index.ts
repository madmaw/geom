import { ConvexShape, Shape, convexShapeContainPoint, convexShapeExpand } from "./geometry/shape";
import { Plane, toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_Z } from "./geometry/constants";
import { ConvexPolygon, Face } from "./geometry/face";

type MaybeInvertedFace = Face & {
  inverted: number,
};

const TEXTURE_DIMENSION = 4096;
const TEXTURE_SCALE = 64;
const TEXTURE_BUFFER = 10;
const BASE_LINE_WIDTH = 1;
const BASE_EDGE_SMOOTHING = 20;
const BORDER_EXPAND = 0.02;

const A_VERTEX_POSITION = "aVertexPosition";
const A_VERTEX_COLOR = "aVertexColor";
const A_VERTEX_NORMAL = 'aVertexNormal';
const A_VERTEX_TEXTURE_COORD = 'aVertexTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelViewMatrix";
const U_MODEL_ROTATION_MATRIX = 'uModelRotationMatrix';
const U_PROJECTION_MATRIX = "uProjectionMatrix";
const U_TEXTURE = 'uTexture';

const V_COLOR = 'vColor';
const V_POSITION = 'vPosition';
const V_NORMAL = 'vNormal';
const V_TEXTURE_COORD = 'vTextureCoord';

const O_COLOR = "oColor";

const VERTEX_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${A_VERTEX_POSITION};
  in vec4 ${A_VERTEX_COLOR};
  in vec4 ${A_VERTEX_NORMAL};
  in vec2 ${A_VERTEX_TEXTURE_COORD};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_COLOR};
  out vec3 ${V_POSITION};
  out vec4 ${V_NORMAL};
  out vec2 ${V_TEXTURE_COORD};

  void main(void) {
    gl_Position = ${U_PROJECTION_MATRIX} * ${U_MODEL_VIEW_MATRIX} * ${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_POSITION};
    ${V_COLOR} = ${A_VERTEX_COLOR};
    ${V_POSITION} = ${A_VERTEX_POSITION}.xyz;
    ${V_TEXTURE_COORD} = ${A_VERTEX_TEXTURE_COORD};
    ${V_NORMAL} = ${A_VERTEX_NORMAL};
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_COLOR};
  in vec3 ${V_POSITION};
  in vec4 ${V_NORMAL};
  in vec2 ${V_TEXTURE_COORD};
  uniform sampler2D ${U_TEXTURE};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  out vec4 ${O_COLOR};

  mat4 x = mat4(
    1, 0, 0, 0,
    0, 1, 0, 1,
    0, 0, 1, 0,
    0, 0, 0, 1
  );

  void main(void) {
    vec4 p = texture(${U_TEXTURE}, ${V_TEXTURE_COORD});
    vec3 n = (p.xyz/length(p.xyz) - .5) * 2.;
    //vec3 n = ${V_NORMAL}.xyz;
    ${O_COLOR} = vec4(
      mix(
        (texture(${U_TEXTURE}, ${V_POSITION}.xy).rgb + texture(${U_TEXTURE}, ${V_POSITION}.xz).rgb + texture(${U_TEXTURE}, ${V_POSITION}.zy).rgb)/3.,
        //${V_COLOR}.rgb * (dot(normalize(n), vec3(.2, .7, -.5)) + 1.)/2.,
        vec3(1.),
        max(${V_COLOR}.a, (1. - p.a)/.9)
      ),
      ${V_COLOR}.a
    );
  }
`;

window.onload = () => {
  // frame
  const shape1: ConvexShape = [
    toPlane(0, 0, 1, 1),
    toPlane(0, 0, -1, 1),
    toPlane(1, 1, 0, 1),
    toPlane(-1, 1, 0, 1),
    toPlane(1, 0, 0, 1),
    toPlane(-1, 0, 0, 1),
    //toPlane(0, 1, 0, 1),
    toPlane(0, -1, 0, 1),
  ];

  // windows
  const shape2: ConvexShape = [
    toPlane(1, 0, 0, 1.2),
    toPlane(-1, 0, 0, 1.2),
    toPlane(0, 1, 0, 0),
    toPlane(0, -1, 0, .5),
    toPlane(0, 0, 1, .3),
    toPlane(0, 0, -1, .3),
  ];

  // door
  const shape3: ConvexShape = [
    toPlane(1, 0, 0, .2),
    toPlane(-1, 0, 0, .2),
    toPlane(0, 1, 0, 0),
    toPlane(0, -1, 0, .8),
    toPlane(0, 0, 1, 0.8),
    toPlane(0, 0, -1, 1.3),
  ];

  // interior
  const shape4: ConvexShape = [
    toPlane(0, 0, 1, .8),
    toPlane(0, 0, -1, .8),
    toPlane(1, 1, 0, .8),
    toPlane(-1, 1, 0, .8),
    toPlane(1, 0, 0, .8),
    toPlane(-1, 0, 0, .8),
    //toPlane(0, 1, 0, .8),
    toPlane(0, -1, 0, .8),
  ];

  // chimney
  const shape5: ConvexShape = [
    toPlane(1, 0, 0, .4),
    toPlane(-1, 0, 0, .4),
    toPlane(0, 1, 0, 1.8),
    toPlane(0, -1, 0, .8),
    toPlane(0, 0, 1, 1),
    //toPlane(0, 0, 1, 2),
    toPlane(0, 0, -1, -.2),
  ];
  
  // chimney hole
  const shape6: ConvexShape = [
    toPlane(1, 0, 0, .2),
    toPlane(-1, 0, 0, .2),
    toPlane(0, 1, 0, 1.9),
    toPlane(0, -1, 0, 1.1),
    toPlane(0, 0, 1, .8),
    toPlane(0, 0, -1, -.4),
  ];

  // chimney2
  const shape7: ConvexShape = [
    toPlane(1, 0, 0, .4),
    toPlane(-1, 0, 0, .4),
    toPlane(0, 1, 0, 1.5),
    toPlane(0, -1, 0, .8),
    toPlane(0, 0, 1, 1),
    //toPlane(0, 0, 1, 2),
    toPlane(0, 0, -1, -.2),
  ];
  
  // cube
  const shape8: ConvexShape = [
    toPlane(0, 0, 1, 1),
    toPlane(0, 0, -1, 1),
    toPlane(1, 0, 0, 1),
    toPlane(-1, 0, 0, 1),
    toPlane(0, 1, 0, 1),
    toPlane(0, -1, 0, 1),
  ];
  
  const segmentsz = 3;
  const segmentsy = 2;
  const ry = .3;
  const rz = 1;
  const hole = rz;

  const disc: ConvexShape = new Array(segmentsz).fill(0).map((_, i, arrz) => {
    const az = Math.PI * 2 * i / arrz.length;
    const cosz = Math.cos(az);
    const sinz = Math.sin(az);
    return new Array(segmentsy).fill(0).map<Plane>((_, j, arry) => {
      const ay = Math.PI * (j + 1) / (arry.length + 1) - Math.PI/2;
      const cosy = Math.cos(ay);
      const siny = Math.sin(ay);
      return [
        [cosz * cosy, sinz * cosy, siny],
        [cosz * (cosy * ry + rz), sinz * (cosy * ry + rz), siny * ry],
      ];
    });
  }).flat(1).concat([
    toPlane(0, 0, -1, ry),
    toPlane(0, 0, 1, ry),
  ]);

  const column: ConvexShape = new Array(segmentsz).fill(0).map((_, i, arrz) => {
    const az = Math.PI * 2 * i / arrz.length;
    const cosz = Math.cos(az);
    const sinz = Math.sin(az);
    return toPlane(cosz, sinz, 0, .4);
  }).concat([
    toPlane(0, 0, -1, 1),
    toPlane(0, 0, 1, 1),
  ]);

  const columns: ConvexShape[] = new Array(segmentsy).fill(0).map((_, i, arry) => {
    const ay = Math.PI * (i + 1) / (arry.length + 1) - Math.PI/2;
    const cosy = Math.cos(ay);
    const siny = Math.sin(ay);
    return new Array(segmentsz).fill(0).map<Plane>((_, j, arrz) => {
      const az = Math.PI * 2 * (j + (arrz.length%2)/2) / arrz.length;
      const cosz = Math.cos(az);
      const sinz = Math.sin(az);
      return [
        [-cosz * cosy, -sinz * cosy, -siny],
        [cosz * (cosy * ry - hole), sinz * (cosy * ry - hole), siny * ry],
      ];
    }).concat([
      toPlane(0, 0, -1, 1),
      toPlane(0, 0, 1, 1),
    ]);
  }).filter(v => v != null);
  
  const shapes: readonly Shape[] = ([
    //[shape8, [shape6]],
    //[shape1, []],
    [shape5, [shape6]],
    //[shape7, [shape6]],
    [shape1, [shape2, shape3, shape4, shape6]],
    //[disc, columns],
    //[disc, []],
    //[column, []],
    //[columns[0], []],
    //...columns.map<Shape>(column => [column, []]),
  ] as const);
  const negativeShapes = shapes.map(([addition, subtractions]) => {
    return [
      convexShapeExpand(addition, BORDER_EXPAND),
      subtractions.map(subtraction => convexShapeExpand(subtraction, -BORDER_EXPAND)),
    ] as const;
  });

  const pointCache: [number, number, number][] = [];

  function getWorldPoint(point: ReadonlyVec3, toWorldCoordinates: ReadonlyMat4): [number, number, number] {
    const worldPoint = [...vec3.transformMat4(vec3.create(), point, toWorldCoordinates)] as [number, number, number];
    const cachedWorldPoint = pointCache.find(cachedPoint => {
      const d = vec3.distance(cachedPoint, worldPoint);
      return d < EPSILON * 10;
    });
    if (cachedWorldPoint != null) {
      return cachedWorldPoint;
    }
    pointCache.push(worldPoint);
    return worldPoint;
  }

  let faces: MaybeInvertedFace[] = [shapes, negativeShapes].map((shapes, i) => {
    const faces = decompose(shapes);
    // reverse the face
    return faces.map<MaybeInvertedFace>(({
      polygons,
      rotateToWorldCoordinates,
      toWorldCoordinates,
    }) => {
      return {
        polygons: polygons.map(polygon => (i ? [...polygon].reverse() : polygon).filter((p, i, a) => {
          const n = a[(i + 1)%a.length];
          return getWorldPoint(n, toWorldCoordinates) != getWorldPoint(p, toWorldCoordinates);
        })).filter(polygon => polygon.length > 2),
        rotateToWorldCoordinates,
        toWorldCoordinates,
        inverted: i,
      };
    }).filter(shape => shape.polygons.length && Math.random() > .0);
  }).flat(1);

  console.log(faces.map(({ polygons }) => polygons.map(polygon => polygon.map(point => [...point]))));
  console.log(faces.map(({ polygons, toWorldCoordinates }) => (
    polygons.map(polygon => {
      return polygon.map(point => {
        const worldPoint = vec3.transformMat4(vec3.create(), point, toWorldCoordinates);
        return [...worldPoint];
      });
    })
  )));

  const canvas2d = document.getElementById("canvas2d") as HTMLCanvasElement;
  canvas2d.width = TEXTURE_DIMENSION;
  canvas2d.height = TEXTURE_DIMENSION;
  const ctx = canvas2d.getContext('2d');
  
  const canvas3d = document.getElementById("canvas3d") as HTMLCanvasElement;
  canvas3d.width = canvas3d.clientWidth;
  canvas3d.height = canvas3d.clientHeight;
  const gl = canvas3d.getContext("webgl2", {
    // prevents alpha from being rendered, but we can still use it for
    // measuring brightness (hopefully)
    alpha: false,
  });
  
  const projectionMatrix = mat4.multiply(
    mat4.create(),
    mat4.identity(mat4.create()),
    mat4.perspective(
      mat4.create(),
      Math.PI/4,
      canvas3d.clientWidth/canvas3d.clientHeight,
      .1,
      100,
    ),
  );
  const modelPositionMatrix = mat4.translate(
    mat4.create(),
    mat4.identity(mat4.create()),
    [0, 0, -10],
  );

  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

  const program = gl.createProgram();
  if (program == null) {
    throw new Error();
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const [
    aPosition,
    aColor,
    aNormal,
    aTextureCoord,
  ] = [
    A_VERTEX_POSITION,
    A_VERTEX_COLOR,
    A_VERTEX_NORMAL,
    A_VERTEX_TEXTURE_COORD,
  ].map(
    attribute => gl.getAttribLocation(program, attribute)
  );
  const [
    uModelViewMatrix,
    uModelRotationMatrix,
    uProjectionMatrix,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_MODEL_ROTATION_MATRIX,
    U_PROJECTION_MATRIX,
  ].map(
    uniform => gl.getUniformLocation(program, uniform)
  );

  const pointAdjacency = faces.reduce((acc, face) => {
    const { polygons, toWorldCoordinates, rotateToWorldCoordinates } = face;

    return polygons.reduce((acc, polygon) => {
      return polygon.reduce((acc, currentPoint, i) => {
        const currentWorldPoint = getWorldPoint(currentPoint, toWorldCoordinates);
        const nextWorldPoint = getWorldPoint(polygon[(i + 1)%polygon.length], toWorldCoordinates);
        return acc.set(
          currentWorldPoint,
          (acc.get(currentWorldPoint) || new Map()).set(nextWorldPoint, face),
        );
      }, acc);
    }, acc);
  }, new Map<ReadonlyVec3, Map<ReadonlyVec3, Face>>());

  // remove duplicate or disconnected faces
  faces = faces.filter(face => {

    const { polygons, toWorldCoordinates } = face;

    return polygons.every((polygon, h) => {
      return polygon.every((currentPoint, i) => {
        const nextPoint = polygon[(i + 1)%polygon.length];
        const currentWorldPoint = getWorldPoint(currentPoint, toWorldCoordinates);
        const nextWorldPoint = getWorldPoint(nextPoint, toWorldCoordinates);
        const adjacentFace = pointAdjacency.get(currentWorldPoint).get(nextWorldPoint);
        return face == adjacentFace;
      });
    });

    const currentWorldPoint = getWorldPoint(polygons[0][0], toWorldCoordinates);
    const nextWorldPoint = getWorldPoint(polygons[0][1], toWorldCoordinates);
    // only keep faces that map to themselves (overlapping faces will map to another face)
    const adjacentFace = pointAdjacency.get(currentWorldPoint).get(nextWorldPoint);

    return adjacentFace == face;
      // and faces that connect to something
      // && !polygons.some(polygon => polygon.some((p, i) => {
      //   const n = polygon[(i + 1)%polygon.length];
      //   const ph = hashPoint(p, toWorldCoordinates);
      //   const nh = hashPoint(n, toWorldCoordinates);
      //   // note we have reversed the order here to get the joining face
      //   const adjacentFace = pointAdjacency.get(nh)?.get(ph);
      //   return !adjacentFace;
      // }));
  });

  const pointFaces = faces.reduce<Map<[number, number, number], Set<Face>>>(
    (acc, face) => {
      const { polygons, toWorldCoordinates } = face;
      // const normal = [...vec3.transformMat4(
      //   vec3.create(),
      //   NORMAL_Z,
      //   rotateToWorldCoordinates,
      // )] as [number, number, number];
      polygons.forEach(polygon => {
        polygon.forEach(point => {
          const worldPoint = getWorldPoint(point, toWorldCoordinates);
          acc.set(worldPoint, (acc.get(worldPoint) || new Set()).add(face));        
        })
      });
      return acc;
    },
    new Map(),
  );

  console.log('point faces', pointFaces);
  /* caculate normals for each point in the faces
  const pointNormals = new Map<[number, number, number], [number, number, number][]>();

  faces.forEach(face => {
    const { polygons, toWorldCoordinates } = face;
    const pointPolygons = [...pointFaces.entries()].reduce((acc, [worldPoint, faces]) => {
      if (faces.has(face)) {
        polygons.forEach(polygon => {
          const inPolygon = polygon.some(point => {
            return getWorldPoint(point, toWorldCoordinates) == worldPoint;
          });
          if (inPolygon) {
            acc.set(worldPoint, (acc.get(worldPoint) || new Set()).add(polygon));
          }
        });
      }
      return acc;
    }, new Map<[number, number, number], Set<ConvexPolygon>>());

    let unmeasuredPointsAndPolygons = [...pointPolygons.entries()].map(([startWorldPoint, polygons]) => {
      return [...polygons].map(polygon => [startWorldPoint, polygon] as const);
    }).flat(1).sort(([p1], [p2]) => pointFaces.get(p2).size - pointFaces.get(p1).size);

    while (unmeasuredPointsAndPolygons.length) {
      unmeasuredPointsAndPolygons = unmeasuredPointsAndPolygons.filter(([startWorldPoint, polygon]) => {
        const faces = pointFaces.get(startWorldPoint);
        let startNormal: [number, number, number] | undefined;
        if (faces.size > 2) {
          // it's good as is
          startNormal = [...vec3.normalize(vec3.create(), [...faces].reduce<ReadonlyVec3>((acc, { rotateToWorldCoordinates }) => {
            const normal = vec3.transformMat4(vec3.create(), NORMAL_Z, rotateToWorldCoordinates);
            return vec3.add(vec3.create(), acc, vec3.scale(vec3.create(), normal, 1/faces.size));
          }, [0, 0, 0]))] as [number, number, number];
          pointNormals.set(startWorldPoint, [startNormal]);
        } else if (faces.size > 1) {
          // should only ever be one
          startNormal = pointNormals.get(startWorldPoint)?.[0];
        }
        if (startNormal) {
          // find the index of the point in the polygon
          const pointIndex = polygon.findIndex(point => {
            const worldPoint = getWorldPoint(point, toWorldCoordinates);
            return startWorldPoint == worldPoint;
          });
          const currentPoint = polygon[pointIndex];
          const nextPoint = polygon[(pointIndex+1)%polygon.length];
          const angle = Math.atan2(nextPoint[1] - currentPoint[1], nextPoint[0] - currentPoint[0]);
          // find the adjacent polygon on the next point that has the same angle
          //console.log(angle);
          let endNormal: [number, number, number] | undefined;
          let currentWorldPoint = getWorldPoint(nextPoint, toWorldCoordinates);
          const worldPoints: [number, number, number][] = [currentWorldPoint];
          let keepGoing: boolean | number = 1;
          while (!endNormal && keepGoing) {
            // find a polygon with the next line matching this angle
            const polygons = pointPolygons.get(currentWorldPoint);
            keepGoing = [...polygons].some(polygon => {
              const pointIndex = polygon.findIndex(point => {
                const worldPoint = getWorldPoint(point, toWorldCoordinates);
                return currentWorldPoint == worldPoint;
              });
              const point = polygon[pointIndex];
              const nextIndex = (pointIndex + 1)%polygon.length;
              const nextPoint = polygon[nextIndex];
              const nextAngle = Math.atan2(nextPoint[1] - point[1], nextPoint[0] - point[0]);
              // check angle delta
              if (Math.abs(nextAngle - angle)%(Math.PI*2) < EPSILON) {
                currentWorldPoint = getWorldPoint(nextPoint, toWorldCoordinates);
                const faces = pointFaces.get(currentWorldPoint);
                if (faces.size > 2) {
                  // it's good as is
                  endNormal = [...vec3.normalize(vec3.create(), [...faces].reduce<ReadonlyVec3>((acc, { rotateToWorldCoordinates }) => {
                    const normal = vec3.transformMat4(vec3.create(), NORMAL_Z, rotateToWorldCoordinates);
                    return vec3.add(vec3.create(), acc, vec3.scale(vec3.create(), normal, 1/faces.size));
                  }, [0, 0, 0]))] as [number, number, number];
                } else if (faces.size > 1) {
                  // should only ever be one
                  endNormal = pointNormals.get(currentWorldPoint)?.[0];
                } 
                if (!endNormal) {
                  worldPoints.push(currentWorldPoint);
                }
                return 1;
              }
            });
          }
          if (endNormal) {
            const endWorldPoint = worldPoints[worldPoints.length-1];
            const maximumDistance = vec3.distance(startWorldPoint, endWorldPoint);
            worldPoints.forEach(worldPoint => {
              const faces = pointFaces.get(worldPoint);
              const normals = pointNormals.get(worldPoint) || [];
              if (faces.size < 2 || !normals.length) {
                const distance = vec3.distance(startWorldPoint, worldPoint);
                const scale = distance/maximumDistance;
                const normal = vec3.normalize(
                  vec3.create(),
                  vec3.add(
                    vec3.create(),
                    vec3.scale(vec3.create(), startNormal, 1 - scale),
                    vec3.scale(vec3.create(), endNormal, scale),
                  ),
                );
                pointNormals.set(
                  worldPoint,
                  normals.concat(
                    [[...normal] as [number, number, number]],
                  ),
                );  
              }
            });
          }
          return !endNormal && worldPoints.length > 1;
        }
        // don't measure internal points, should happen as part of measuring external points
        return faces.size > 1;
      });
    }
  });
  console.log('point normals', pointNormals);
  */

  console.log(faces.map(({ polygons, toWorldCoordinates }) => (
    polygons.map(polygon => {
      return polygon.map(point => {
        const worldPoint = vec3.transformMat4(vec3.create(), point, toWorldCoordinates);
        return [...worldPoint];
      });
    })
  )));



  const materials = 4;
  const materialDimension = TEXTURE_DIMENSION/materials;
  let textureX = 0;
  let textureY = materialDimension;
  let textureMaxHeight = 0;
  //ctx.lineCap = 'round';

  // add in some textures
  for (let materialId = 1; materialId < materials; materialId++){
    ctx.fillStyle = `rgba(${Math.random()* 255 | 0}, ${Math.random() * 255 | 0}, ${Math.random() * 255 | 0})`;
    ctx.fillRect(materialId * materialDimension, 0, materialDimension, materialDimension);
  }

  const [points, colors, normals, textureCoords, indices] = faces.reduce<[
    [number, number, number][],
    [number, number, number, number][],
    [number, number, number][],
    [number, number][],
    number[],
  ]>(
    ([points, colors, normals, textureCoords, indices], face) => {
      const {
        polygons,
        toWorldCoordinates,
        rotateToWorldCoordinates,
        inverted = 0,
      } = face;
      const fromWorldCoordinates = mat4.invert(mat4.create(), toWorldCoordinates);

      const polygonPoints = polygons.flat(1);
      const [[minX, minY], [maxX, maxY]] = polygonPoints.reduce<[[number, number, number], [number, number, number]]>(([min, max], point) => {
        const newMin = min.map((v, i) => Math.min(v, point[i])) as [number, number, number];
        const newMax = max.map((v, i) => Math.max(v, point[i])) as [number, number, number];
        return [newMin, newMax];
      }, [
        [...polygonPoints[0]] as [number, number, number],
        [...polygonPoints[0] as [number, number, number]],
      ]);

      const width = (maxX - minX) * TEXTURE_SCALE + TEXTURE_BUFFER * 2 | 0;
      const height = (maxY - minY) * TEXTURE_SCALE + TEXTURE_BUFFER * 2 | 0;
      
      // TODO ignore inverted face textures
      if (textureX + width > ctx.canvas.width) {
        textureX = 0;
        textureY += textureMaxHeight;
        textureMaxHeight = 0;
      }
      const originalTextureX = textureX;
      textureX += width;
      textureMaxHeight = Math.max(height, textureMaxHeight);
      function toTextureCoordinate([px, py]: ReadonlyVec3): [number, number] {
        return [
          originalTextureX + (px - minX) * TEXTURE_SCALE + TEXTURE_BUFFER, 
          textureY + (py - minY) * TEXTURE_SCALE + TEXTURE_BUFFER,
        ];
      }
      //ctx.globalCompositeOperation = 'lighter';
      ctx.globalCompositeOperation = 'source-over';
      const lineConnections = new Map<[number, number, number], [number, number, number]>();
      const normal = [...vec3.transformMat4(
        vec3.create(),
        NORMAL_Z,
        rotateToWorldCoordinates,
      )] as [number, number, number];

      polygons.forEach(polygon => {
        polygon.forEach((currentPoint, i) => {
          const currentWorldPoint = getWorldPoint(currentPoint, toWorldCoordinates);
          const nextPoint = polygon[(i + 1)%polygon.length];
          const nextWorldPoint = getWorldPoint(nextPoint, toWorldCoordinates);
          const adjacentFace = pointAdjacency.get(nextWorldPoint).get(currentWorldPoint);
          const adjacentNormal = vec3.transformMat4(
            vec3.create(), NORMAL_Z, adjacentFace.rotateToWorldCoordinates,
          );
          const sinAngle = 1 - Math.abs(vec3.dot(normal, adjacentNormal));
          if (sinAngle > EPSILON) {
            const lineWidth = sinAngle * BASE_EDGE_SMOOTHING;
            const p = toTextureCoordinate(currentPoint);
            const n = toTextureCoordinate(nextPoint);
            const [px, py] = p;
            const [nx, ny] = n;
            const a = Math.atan2(ny - py, nx - px);
            const ap = a + Math.PI/2;
            const cos = Math.cos(ap) * lineWidth/2;
            const sin = Math.sin(ap) * lineWidth/2;
            const gradient = ctx.createLinearGradient(
              px + cos, 
              py + sin,
              px - cos,
              py - sin,
            );
            gradient.addColorStop(1, normalToColor(adjacentNormal));
            gradient.addColorStop(0, normalToColor(normal));
            ctx.strokeStyle = gradient;

            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            [p, n].forEach(point => {
              ctx.lineTo(...point);
            });
  
            //ctx.stroke();
      
            lineConnections.set(currentWorldPoint, nextWorldPoint);
          }
        });
      });

      const imageData = ctx.createImageData(width, height);
      for(let y=0; y<height; y++) {
        for(let x=0; x<width; x++) {
          const index = (y * width + x) * 4;
          imageData.data.set([...normal.map(v => Math.round((v + 1) * 127.5)), 255], index);
        }
      }
      ctx.putImageData(imageData, originalTextureX, textureY);


      // draw background under
      // ctx.globalCompositeOperation = 'source-over';
      // ctx.fillStyle = normalToColor(normal);
      // ctx.fillRect(originalTextureX, textureY, width, height);
      // erase lines
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = BASE_LINE_WIDTH;
      ctx.fillStyle = 'rgba(0, 0, 0, .1)';
      const lineConnectionValues = new Set(lineConnections.values());
      while (lineConnections.size) {
        ctx.beginPath();
        const lineConnectionKeys = [...lineConnections.keys()];
        // find the start of a line
        let currentWorldPoint = lineConnectionKeys.find(point => {
          return !lineConnectionValues.has(point);
        });
        const closePath = !currentWorldPoint;
        if (closePath) {
          // if there are no unclosed lines, we are circular and can
          // start anywhere with any point
          currentWorldPoint = lineConnectionKeys[0];
        }
        while (currentWorldPoint) {
          const nextWorldPoint = lineConnections.get(currentWorldPoint);
          lineConnections.delete(currentWorldPoint);
          const [px, py] = vec3.transformMat4(
            vec3.create(),
            currentWorldPoint,
            fromWorldCoordinates,
          );
          ctx.lineTo(
            originalTextureX + (px - minX) * TEXTURE_SCALE + TEXTURE_BUFFER, 
            textureY + (py - minY) * TEXTURE_SCALE + TEXTURE_BUFFER,
          );
          currentWorldPoint = nextWorldPoint;
        }
        // TODO probably don't need this
        if (closePath) {
          ctx.closePath();
        }
        ctx.stroke();
      }      

      // hashes to transformed points?
      const hashesToPoints = polygonPoints.reduce((acc, point) => {
        return acc.add(getWorldPoint(point, toWorldCoordinates));
      }, new Set<[number, number, number]>());
      const uniquePoints = [...hashesToPoints];

      const newTextureCoords = uniquePoints.map<[number, number]>((worldPoint) => {
        const [px, py] = vec3.transformMat4(vec3.create(), worldPoint, fromWorldCoordinates);
        const x = ((px - minX) * TEXTURE_SCALE + TEXTURE_BUFFER + originalTextureX)/canvas2d.width;
        const y = ((py - minY) * TEXTURE_SCALE + TEXTURE_BUFFER + textureY)/canvas2d.height;
        return [x, y];
      });

      // const outsideColor: [number, number, number, number] = [.4, .4, .6, .3];
      // const insideColor: [number, number, number, number] = [.1, .1, .1, .6];
      const color: [number, number, number, number] = inverted
        ? [1, 1, 1, 1]
        : [.4, .4, .6, .1];
      const newColors = uniquePoints.map(worldPoint => {
        //const inside = shapes.some(([addition]) => convexShapeContainPoint(addition, worldPoint));
        //return inside ? insideColor : outsideColor;
        return color;
      });
      const newNormals = uniquePoints.map(worldPoint => {
        // const normals = pointNormals.get(worldPoint);
        // const normal = normals.reduce<vec3>((acc, normal) => {
        //   return vec3.add(
        //     acc,
        //     acc,
        //     normal
        //   );
        // }, [0, 0, 0]);
        // return [...vec3.normalize(normal, normal)] as [number, number, number];
        // const faces = pointFaces.get(worldPoint);
        // const normal = [...faces].reduce<vec3>((acc, face) => {
        //   return vec3.add(
        //     vec3.create(),
        //     acc,
        //     vec3.transformMat4(
        //       vec3.create(),
        //       NORMAL_Z,
        //       face.rotateToWorldCoordinates,
        //     ),
        //   );
        // }, [0, 0, 0]);
        // return [...vec3.normalize(normal, normal)] as [number, number, number];
        return normal;
      });

      const newIndices = polygons.reduce<number[]>((indices, polygon, i) => {
        const polygonIndices = polygon.map(point => {
          const worldPoint = getWorldPoint(point, toWorldCoordinates);
          return uniquePoints.indexOf(worldPoint);
        });
        const originIndex = polygonIndices[0];
        const newIndices = polygonIndices.slice(1, -1).map((currentIndex, i) => {
          // + 2 because the offset is from 1
          const nextIndex = polygonIndices[i + 2];
          return [originIndex, currentIndex, nextIndex];
        }).flat(1).map(v => v + points.length);
        return [...indices, ...newIndices];
      }, []);
      return [
        [...points, ...uniquePoints],
        [...colors, ...newColors],
        [...normals, ...newNormals],
        [...textureCoords, ...newTextureCoords],
        [...indices, ...newIndices],
      ];
    },
    [[], [], [], [], []],
  );

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
  //gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);


  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  ([
    [aPosition, points],
    [aColor, colors],
    [aNormal, normals],
    [aTextureCoord, textureCoords],
  ] as const).forEach(([attribute, vectors]) => {
    gl.enableVertexAttribArray(attribute);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vectors.flat(1)), gl.STATIC_DRAW);
    gl.vertexAttribPointer(attribute, vectors[0].length, gl.FLOAT, false, 0, 0);
  });

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  gl.viewport(0, 0, canvas3d.clientWidth, canvas3d.clientHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(.2, .2, .2, 1);
  gl.enable(gl.CULL_FACE);
  //gl.cullFace(gl.BACK);

  const modelRotationMatrix = mat4.identity(mat4.create());
  let previousPosition: ReadonlyVec3 | undefined;

  window.onmousedown = (e: MouseEvent) => previousPosition = [e.clientX, -e.clientY, 0];
  window.onmouseup = () => previousPosition = undefined;
  window.onmousemove = (e: MouseEvent) => {
    if (previousPosition) {
      const currentPosition: ReadonlyVec3 = [e.clientX, -e.clientY, 0];
      const delta = vec3.subtract(vec3.create(), currentPosition, previousPosition);
      const axis = vec3.normalize(
        vec3.create(),
        vec3.rotateZ(vec3.create(), delta, [0, 0, 0], Math.PI/2),
      );
      const rotation = vec3.length(delta)/399;
      if (rotation > EPSILON) {
        const rotationMatrix = mat4.rotate(
          mat4.create(),
          mat4.identity(mat4.create()),
          rotation,
          axis,
        );  
        mat4.multiply(modelRotationMatrix, rotationMatrix, modelRotationMatrix);  
        previousPosition = currentPosition;
      }
    }
  };
  window.onwheel = (e: WheelEvent) => {
    const positionMatrix = mat4.translate(mat4.create(), mat4.identity(mat4.create()), [0, 0, -e.deltaY/100]);
    mat4.multiply(modelPositionMatrix, positionMatrix, modelPositionMatrix);
  };

  const fpsDiv = document.getElementById('fps');
  const lastFrameTimes: number[] = [];
  gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);
  let then = 0;
  function animate(now: number) {
    const delta = now - then;
    then = now;
    lastFrameTimes.push(delta);
    const recentFrameTimes = lastFrameTimes.slice(-30);
    const spf = recentFrameTimes.reduce((acc, n) => {
      return acc + n/recentFrameTimes.length;
    }, 0);
    if (spf > 0) {
      fpsDiv.innerText = `${Math.round(1000/spf)}`;
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(uModelViewMatrix, false, modelPositionMatrix);
    gl.uniformMatrix4fv(uModelRotationMatrix, false, modelRotationMatrix);
    
    // gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);  
    //gl.drawElements(gl.LINE_LOOP, indices.length, gl.UNSIGNED_SHORT, 0);  
    requestAnimationFrame(animate);
  }
  animate(0);
};

function normalToColor(normal: ReadonlyVec3) {
  return `rgb(${[...normal].map(v => (v + 1) * 85/2).join()})`;
}