import { ConvexShape, Shape, convexShapeContainPoint, convexShapeExpand } from "./geometry/shape";
import { Plane, toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_Z } from "./geometry/constants";
import { ConvexPolygon, Face } from "./geometry/face";
import { Line, lineDistance } from "./geometry/line";

type MaybeInvertedFace = Face & {
  inverted: number,
};

const LINE_TEXTURE_DIMENSION = 4096;
const LINE_TEXTURE_SCALE = 64;
const LINE_TEXTURE_BUFFER = 10;
const BASE_LINE_WIDTH = 1;
const BASE_EDGE_SMOOTHING = 20;
const BORDER_EXPAND = 0.02;
const MATERIAL_TEXTURE_DIMENSION = 256;

const A_VERTEX_WORLD_POSITION = "aVertexWorldPosition";
const A_VERTEX_PLANE_POSITION = 'aVertexPlanePosition';
const A_VERTEX_COLOR = "aVertexColor";
const A_VERTEX_PLANE_ROTATION_MATRIX = 'aVertexPlaneRotation';
const A_VERTEX_LINE_TEXTURE_OFFSET = 'aVertexLineTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelView";
const U_MODEL_ROTATION_MATRIX = 'uModelRotation';
const U_PROJECTION_MATRIX = "uProjection";
const U_LINE_TEXTURE = 'uLine';
const U_MATERIAL_TEXTURE = 'uMaterial';
const U_MATERIAL_COLOR = 'uMaterialColor';
const U_CAMERA_POSITION = 'uCameraPosition';

const V_COLOR = 'vColor';
const V_PLANE_POSITION = 'vPlanePosition';
const V_WORLD_POSITION = 'vWorldPosition';
const V_NORMAL = 'vNormal';
const V_PLANE_ROTATION_MATRIX = 'vPlaneTransform';
const V_INVERSE_PLANE_WORLD_ROTATION_MATRIX = 'vInversePlaneWorld';
const V_LINE_TEXTURE_COORD = 'vLineTextureCoord';

const O_COLOR = "oColor";

const VERTEX_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${A_VERTEX_WORLD_POSITION};
  in vec2 ${A_VERTEX_PLANE_POSITION};
  in vec4 ${A_VERTEX_COLOR};
  in mat4 ${A_VERTEX_PLANE_ROTATION_MATRIX};
  in vec2 ${A_VERTEX_LINE_TEXTURE_OFFSET};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_COLOR};
  out vec4 ${V_NORMAL};
  out vec4 ${V_WORLD_POSITION};
  out vec4 ${V_PLANE_POSITION};
  out mat4 ${V_PLANE_ROTATION_MATRIX};
  out mat4 ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX};
  out vec2 ${V_LINE_TEXTURE_COORD};

  void main(void) {
    ${V_WORLD_POSITION} = ${U_MODEL_VIEW_MATRIX} * ${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_WORLD_POSITION};
    ${V_PLANE_POSITION} = vec4(${A_VERTEX_PLANE_POSITION}, 0, 1);
    ${V_COLOR} = ${A_VERTEX_COLOR};
    ${V_LINE_TEXTURE_COORD} = ${A_VERTEX_LINE_TEXTURE_OFFSET};
    ${V_NORMAL} = ${A_VERTEX_PLANE_ROTATION_MATRIX} * vec4(0., 0., 1., 1.);
    ${V_PLANE_ROTATION_MATRIX} = ${A_VERTEX_PLANE_ROTATION_MATRIX};
    ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX} = inverse(${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_PLANE_ROTATION_MATRIX});

    gl_Position = ${U_PROJECTION_MATRIX} * ${V_WORLD_POSITION};
  }
`;

const STEP = .01;
const STEPS = 1/STEP | 0;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_COLOR};
  in vec4 ${V_PLANE_POSITION};
  in vec4 ${V_WORLD_POSITION};
  in vec4 ${V_NORMAL};
  in mat4 ${V_PLANE_ROTATION_MATRIX};
  in mat4 ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX};
  in vec2 ${V_LINE_TEXTURE_COORD};
  uniform sampler2D ${U_LINE_TEXTURE};
  uniform sampler2D ${U_MATERIAL_TEXTURE};
  uniform vec4 ${U_MATERIAL_COLOR};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform vec3 ${U_CAMERA_POSITION};
  out vec4 ${O_COLOR};

  void main(void) {
    vec4 d = ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX} * vec4(normalize(${U_CAMERA_POSITION} - ${V_WORLD_POSITION}.xyz), 1);
    float c = dot(vec3(0, 0, 1), d.xyz);
    float s = length(cross(vec3(0, 0, 1), d.xyz));

    //float depth = c < 0. ? 0. : -.5;
    float depth = -.5;
    float l = 0.;
    vec4 tm;
    bool done = false;
    int count = 0;
    vec4 p;
    do {
      depth += ${STEP};
      p = ${V_PLANE_POSITION} - d * depth / c;
      vec4 tm1 = texture(${U_MATERIAL_TEXTURE}, p.xy);
      float surfaceDepth = tm1.z - .5;
      if (surfaceDepth < depth) {
        float d0 = depth - ${STEP};
        float s0 = d0 - (tm.z - .5);
        float s1 = d0 - surfaceDepth;
        float w = ${STEP} * s/c;
        float si = s0 * ${-STEP}/(${-STEP} - s1 + s0);
        //float si = s1;
        //float si = s0;
        //float si = -${STEP};
        depth -= ${STEP} + si;
        p = ${V_PLANE_POSITION} - d * (d0 - si) / c;
        // tm = texture(${U_MATERIAL_TEXTURE}, p.xy);
        done = true;
      } else {
        tm = tm1;
      }
      vec4 tl = texture(
        ${U_LINE_TEXTURE},
        ${V_LINE_TEXTURE_COORD} + p.xy * ${LINE_TEXTURE_SCALE/LINE_TEXTURE_DIMENSION}
      );
      l = depth > ${-STEP} ? max(l, tl.r) : l;
      count++;
    } while (!done && c > 0. && count < ${STEPS} && l < .9);
    tm = texture(${U_MATERIAL_TEXTURE}, p.xy);
    vec2 n = tm.xy * 2. - 1.;
    vec3 m = (${V_PLANE_ROTATION_MATRIX} * vec4(n, pow(1. - length(n), 2.), 1)).xyz;
    ${O_COLOR} = vec4(
      mix(
        //(tm.w > ${-STEP} && tm.w < .0 ? ${U_MATERIAL_COLOR}.rgb * (dot(m, normalize(vec3(1, 1, 0))) + 1.)/2. : vec3(tm.w * 100., abs(tm.w) * 100., 0)),
        ${U_MATERIAL_COLOR}.rgb * max(0., (dot(m, normalize(vec3(3, 2, 1))) + 1.)/2.),
        //vec3((p.xyz + 1.)/2.),
        //texture(${U_MATERIAL_TEXTURE}, p.xy).xyz,
        //vec3((p.xyz - ${V_PLANE_POSITION}.xyz) * 3. + .5),
        //vec3(-depth * 2., float(count) / 100., depth > -.02 ? 1. : 0.),
        //tm.xyz,
        //(d.xyz + 1.) / 2. * (dot(m, normalize(vec3(1, 1, 0))) + 1.)/2.,
        //(p.xyz + 1.)/2.,
        //vec3(depth + .5),
        vec3(1.),
        max(${V_COLOR}.a, l)
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
  
  const segmentsz = 6;
  const segmentsy = 3;
  const ry = .9;
  const rz = 2;
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
    return toPlane(cosz, sinz, 0, 1);
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

  const geometryLineCanvas = document.getElementById("canvasLines") as HTMLCanvasElement;
  geometryLineCanvas.width = LINE_TEXTURE_DIMENSION;
  geometryLineCanvas.height = LINE_TEXTURE_DIMENSION;
  const ctx = geometryLineCanvas.getContext('2d');

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
    aWorldPosition,
    aPlanePosition,
    aColor,
    aNormalTransform,
    aLineTextureOffset,
  ] = [
    A_VERTEX_WORLD_POSITION,
    A_VERTEX_PLANE_POSITION,
    A_VERTEX_COLOR,
    A_VERTEX_PLANE_ROTATION_MATRIX,
    A_VERTEX_LINE_TEXTURE_OFFSET,
  ].map(
    attribute => gl.getAttribLocation(program, attribute)
  );
  const [
    uModelViewMatrix,
    uModelRotationMatrix,
    uCameraPosition,
    uProjectionMatrix,
    uLineTexture,
    uMaterialTexture,
    uMaterialColor,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_MODEL_ROTATION_MATRIX,
    U_CAMERA_POSITION,
    U_PROJECTION_MATRIX,
    U_LINE_TEXTURE,
    U_MATERIAL_TEXTURE,
    U_MATERIAL_COLOR,
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



  // want a space so we can have transparent area to map outlines to
  let textureX = LINE_TEXTURE_SCALE;
  let textureY = 0;
  let textureMaxHeight = LINE_TEXTURE_SCALE;
  //ctx.lineCap = 'round';

  const materials = 1;
  // add in some textures
  const materialCanvases = new Array(materials).fill(0).map((_, i) => {
    const materialCanvas = document.getElementById('canvasTexture'+i) as HTMLCanvasElement;
    materialCanvas.width = MATERIAL_TEXTURE_DIMENSION;
    materialCanvas.height = MATERIAL_TEXTURE_DIMENSION;
    const ctx = materialCanvas.getContext('2d');
    const maxDepth = (i+1) * 15;
    ctx.fillStyle = `rgba(127, 127, 127, 255)`;
    ctx.fillRect(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);
    const imageData = ctx.getImageData(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);
    for (let i=0; i<999; i++) {
      const d = Math.random() * maxDepth + maxDepth;
      const r = d/2;
      const x = Math.random() * MATERIAL_TEXTURE_DIMENSION;
      const y = Math.random() * MATERIAL_TEXTURE_DIMENSION;
      for (let px = x | 0; px < (x + d + 1 | 0); px++) {
        for (let py = y | 0; py < (y + d + 1 | 0); py++) {
          let index = ((py % MATERIAL_TEXTURE_DIMENSION) * MATERIAL_TEXTURE_DIMENSION
              + (px % MATERIAL_TEXTURE_DIMENSION)) * 4;
          const dx = px - x - r;
          const dy = py - y - r;
          const dzsq = r * r - dx * dx - dy * dy;
          const existingDepth = imageData.data[index + 2];
          if (dzsq > 0) {
            const dz = Math.sqrt(dzsq)/2;
            const [nx, ny] = vec3.normalize(vec3.create(), [dx, dy, dz]);
            const depth = 127 - dz;
            if (depth < existingDepth) {
              imageData.data.set([(nx + 1) * 127 | 0, (ny + 1) * 127 | 0, depth | 0, 255], index);  
            }
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return materialCanvas;
  });

  // fill it with black
  ctx.fillRect(0, 0, LINE_TEXTURE_DIMENSION, LINE_TEXTURE_DIMENSION);
  const [worldPoints, planePoints, colors, normalTransforms, lineTextureOffsets, indices] = faces.reduce<[
    // world position points
    [number, number, number][],
    // plane position points
    [number, number][],
    // colors
    [number, number, number, number][],
    // mat4 normal transforms
    [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number][],
    // line texture offsets
    [number, number][],
    // indices
    number[],
  ]>(
    ([worldPoints, planePoints, colors, normalTransforms, lineTextureOffsets, indices], face) => {
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

      const width = (maxX - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER * 2 | 0;
      const height = (maxY - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER * 2 | 0;
      
      // TODO ignore inverted face textures
      if (textureX + width > ctx.canvas.width) {
        textureX = 0;
        textureY += textureMaxHeight;
        textureMaxHeight = 0;
      }
      const originalTextureX = textureX;
      textureX += width;
      textureMaxHeight = Math.max(height, textureMaxHeight);
      // function toTextureCoordinate([px, py]: ReadonlyVec3): [number, number] {
      //   return [
      //     originalTextureX + (px - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER, 
      //     textureY + (py - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER,
      //   ];
      // }
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
            //const lineWidth = sinAngle * BASE_EDGE_SMOOTHING;
            // const p = toTextureCoordinate(currentPoint);
            // const n = toTextureCoordinate(nextPoint);
            // const [px, py] = p;
            // const [nx, ny] = n;
            // const a = Math.atan2(ny - py, nx - px);
            // const ap = a + Math.PI/2;
            // const cos = Math.cos(ap) * lineWidth/2;
            // const sin = Math.sin(ap) * lineWidth/2;
            // const gradient = ctx.createLinearGradient(
            //   px + cos, 
            //   py + sin,
            //   px - cos,
            //   py - sin,
            // );
            // gradient.addColorStop(1, normalToColor(adjacentNormal));
            // gradient.addColorStop(0, normalToColor(normal));
            // ctx.strokeStyle = gradient;

            // ctx.lineWidth = lineWidth;
            // ctx.beginPath();
            // [p, n].forEach(point => {
            //   ctx.lineTo(...point);
            // });  
            //ctx.stroke();
      
            lineConnections.set(currentWorldPoint, nextWorldPoint);
          }
        });
      });

      // const imageData = ctx.createImageData(width, height);
      // const normalArray = normal.map(v => Math.round((v + 1) * 127.5));
      // const lineEntries = [...lineConnections.entries()];
      // for(let py=0; py<height; py++) {
      //   //const y = (py - minY) * TEXTURE_SCALE + TEXTURE_BUFFER;
      //   const y = (py - TEXTURE_BUFFER)/TEXTURE_SCALE + minY;
      //   for(let px=0; px<width; px++) {
      //     //const x = (px - minX) * TEXTURE_SCALE + TEXTURE_BUFFER;
      //     const x = (px - TEXTURE_BUFFER)/TEXTURE_SCALE + minX;
      //     const index = (py * width + px) * 4;
      //     // find the closest line
      //     let minD = 1;
      //     lineEntries.forEach(worldPoints => {
      //       const line: Line = worldPoints.map(worldPoint => {
      //         return vec3.transformMat4(
      //           vec3.create(),
      //           worldPoint,
      //           fromWorldCoordinates,
      //         );
      //       }) as any; 
      //       const d = lineDistance(line, [x, y]);
      //       minD = Math.min(d, minD);
      //     });
      //     imageData.data.set([...normalArray, 127 + minD * 128 | 0], index);
      //   }
      // }
      // ctx.putImageData(imageData, originalTextureX, textureY);

      ctx.lineWidth = BASE_LINE_WIDTH;
      //ctx.lineCap = 'round';
      // ctx.fillStyle = 'rgba(0, 0, 0, .5)';
      // ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#F00';
      const lineConnectionValues = new Set(lineConnections.values());
      while (lineConnections.size) {
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

        ctx.beginPath();
        while (currentWorldPoint) {
          const nextWorldPoint = lineConnections.get(currentWorldPoint);
          lineConnections.delete(currentWorldPoint);
          const [x, y] = vec3.transformMat4(
            vec3.create(),
            currentWorldPoint,
            fromWorldCoordinates,
          );
          const px = originalTextureX + (x - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER;
          const py = textureY + (y - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER;
          ctx.lineTo(px, py);
          // round corners
          currentWorldPoint = nextWorldPoint;
        }
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

      const x = (-minX * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + originalTextureX)/LINE_TEXTURE_DIMENSION;
      const y = (-minY * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + textureY)/LINE_TEXTURE_DIMENSION;
      const newLineTextureOffsets = uniquePoints.map<[number, number]>((worldPoint) => {
        // const [px, py] = vec3.transformMat4(vec3.create(), worldPoint, fromWorldCoordinates);
        // const x = ((px - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + originalTextureX)/geometryLineCanvas.width;
        // const y = ((py - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + textureY)/geometryLineCanvas.height;
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
      const newNormalTransforms = uniquePoints.map(worldPoint => {
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

        return [...rotateToWorldCoordinates] as any;
      });
      const newPlanePoints = uniquePoints.map<[number, number]>(worldPoint => {
        const [x, y] = vec3.transformMat4(vec3.create(), worldPoint, fromWorldCoordinates);
        return [x, y];
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
        }).flat(1).map(v => v + worldPoints.length);
        return [...indices, ...newIndices];
      }, []);
      return [
        [...worldPoints, ...uniquePoints],
        [...planePoints, ...newPlanePoints],
        [...colors, ...newColors],
        [...normalTransforms, ...newNormalTransforms],
        [...lineTextureOffsets, ...newLineTextureOffsets],
        [...indices, ...newIndices],
      ];
    },
    [[], [], [], [], [], []],
  );

  [geometryLineCanvas, ...materialCanvases].forEach((image, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    //gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  });


  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  ([
    [aWorldPosition, worldPoints],
    [aPlanePosition, planePoints],
    [aColor, colors],
    [aNormalTransform, normalTransforms],
    [aLineTextureOffset, lineTextureOffsets],
  ] as const).forEach(([attribute, vectors]) => {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vectors.flat(1)), gl.STATIC_DRAW);
    let count = 0;
    while (count * 4 < vectors[0].length) {
      const length = Math.min(4, vectors[0].length - count * 4);
      gl.enableVertexAttribArray(attribute + count);
      gl.vertexAttribPointer(
        attribute + count,
        length,
        gl.FLOAT,
        false,
        vectors[0].length > 4 ? 64 : 0,
        count * 16,
      );
      count++;
    }
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
  gl.uniform1i(uLineTexture, 0);
  gl.uniform1i(uMaterialTexture, 1);
  gl.uniform4f(uMaterialColor, .2, .2, .4, 0);
  gl.uniform3f(uCameraPosition, 0, 0, 0);
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
