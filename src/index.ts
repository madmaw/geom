import { ConvexShape, Shape, convexShapeContainPoint, convexShapeExpand } from "./geometry/shape";
import { Plane, toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_X, NORMAL_Z } from "./geometry/constants";
import { Face, convexPolygonContainsPoint } from "./geometry/face";
import { Material, featureMaterial } from "./materials/material";
import { riverStonesFactory } from "./materials/river_stones";
import { craterFeature } from "./materials/craters";
import { staticFactory } from "./materials/static";
import { round } from "./geometry/round";
import { createFlatMaterialFactory } from "./materials/flat";
import { DEPTH_RANGE } from "./constants";
import { spikeFeature } from "./materials/spikes";

type MaybeInvertedFace = Face & {
  inverted: number,
};

//const LINE_TEXTURE_DIMENSION = 4096;
//const LINE_TEXTURE_DIMENSION = 512;
//const LINE_TEXTURE_SCALE = 80;
const LINE_TEXTURE_PROPORTION = 64/4096;
//const LINE_TEXTURE_BUFFER = LINE_TEXTURE_SCALE/2;
const BORDER_EXPAND = .05;
//const MATERIAL_TEXTURE_DIMENSION = 4096;
const MATERIAL_TEXTURE_DIMENSION = 2048;
const MATERIAL_DEPTH_SCALE = 256/(MATERIAL_TEXTURE_DIMENSION * DEPTH_RANGE);

const A_VERTEX_WORLD_POSITION = "aVertexWorldPosition";
const A_VERTEX_PLANE_POSITION = 'aVertexPlanePosition';
const A_VERTEX_PLANE_ROTATION_MATRIX = 'aVertexPlaneRotation';
const A_VERTEX_LINE_TEXTURE_OFFSET = 'aVertexLineTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelView";
const U_MODEL_ROTATION_MATRIX = 'uModelRotation';
const U_PROJECTION_MATRIX = "uProjection";
const U_LINE_TEXTURE = 'uLine';
const U_LINE_COLOR = 'uLineColor';
const U_LINE_WIDTH = 'uLineWidth';
const U_BOUNDARY_TEXTURE = 'uBoundary';
const U_MATERIAL_TEXTURE = 'uMaterial';
const U_MATERIAL_COLOR_1 = 'uMaterialColor1';
const U_MATERIAL_COLOR_2 = 'uMaterialColor2';
const U_CAMERA_POSITION = 'uCameraPosition';

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
  in vec4 ${A_VERTEX_PLANE_POSITION};
  in mat4 ${A_VERTEX_PLANE_ROTATION_MATRIX};
  in vec2 ${A_VERTEX_LINE_TEXTURE_OFFSET};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_NORMAL};
  out vec4 ${V_WORLD_POSITION};
  out vec4 ${V_PLANE_POSITION};
  out mat4 ${V_PLANE_ROTATION_MATRIX};
  out mat4 ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX};
  out vec2 ${V_LINE_TEXTURE_COORD};

  void main(void) {
    ${V_WORLD_POSITION} = ${U_MODEL_VIEW_MATRIX} * ${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_WORLD_POSITION};
    ${V_PLANE_POSITION} = ${A_VERTEX_PLANE_POSITION};
    ${V_LINE_TEXTURE_COORD} = ${A_VERTEX_LINE_TEXTURE_OFFSET};
    ${V_NORMAL} = ${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_PLANE_ROTATION_MATRIX} * vec4(0., 0., 1., 1.);
    ${V_PLANE_ROTATION_MATRIX} = ${A_VERTEX_PLANE_ROTATION_MATRIX};
    ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX} = inverse(${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_PLANE_ROTATION_MATRIX});

    gl_Position = ${U_PROJECTION_MATRIX} * ${V_WORLD_POSITION};
  }
`;

const STEP = .01;
const NUM_STEPS = DEPTH_RANGE/STEP | 0;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_PLANE_POSITION};
  in vec4 ${V_WORLD_POSITION};
  in vec4 ${V_NORMAL};
  in mat4 ${V_PLANE_ROTATION_MATRIX};
  in mat4 ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX};
  in vec2 ${V_LINE_TEXTURE_COORD};
  uniform sampler2D ${U_LINE_TEXTURE};
  uniform vec4 ${U_LINE_COLOR};
  uniform vec4 ${U_LINE_WIDTH};
  uniform sampler2D ${U_BOUNDARY_TEXTURE};
  uniform sampler2D ${U_MATERIAL_TEXTURE};
  uniform vec4 ${U_MATERIAL_COLOR_1};
  uniform vec4 ${U_MATERIAL_COLOR_2};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform vec3 ${U_CAMERA_POSITION};
  out vec4 ${O_COLOR};

  void main(void) {
    vec4 d = ${V_INVERSE_PLANE_WORLD_ROTATION_MATRIX} * vec4(normalize(${U_CAMERA_POSITION} - ${V_WORLD_POSITION}.xyz), 1);
    // NOTE: c will be positive for camera facing surfaces
    float c = dot(vec3(0, 0, 1), d.xyz);
    float s = length(cross(vec3(0, 0, 1), d.xyz));
    // multiplying by cos, while incorrect, reduces burring as c approaches 0
    //float depthScale = c;
    //float depthScale = dot(${V_NORMAL}.xyz, vec3(0, 0, 1));
    float depthScale = ${MATERIAL_DEPTH_SCALE}/${U_LINE_WIDTH}.w;

    float depth = ${DEPTH_RANGE/2};
    vec4 tm;
    vec4 p;
    vec4 tb;
    for (int count = 0; count < ${NUM_STEPS}; count++) {
      depth -= ${STEP};
      p = ${V_PLANE_POSITION} + d * depth / c;
      vec4 tm1 = texture(
        ${U_MATERIAL_TEXTURE},
        p.xy * ${U_LINE_WIDTH}.w + ${V_PLANE_POSITION}.zw
      );
      float surfaceDepth = (tm1.z - .5) * ${DEPTH_RANGE} * depthScale;
      if (surfaceDepth > depth) {
        float d0 = depth + ${STEP};
        float s0 = d0 - (tm.z - .5) * ${DEPTH_RANGE} * depthScale;
        float s1 = d0 - surfaceDepth;
        //float w = ${STEP} * s/c;
        float divisor = ${STEP} - s1 + s0;
        // make sure it's not almost parallel, if it is, defer until next iteration
        if (abs(divisor) > .0) {
          float si = s0 * ${STEP}/divisor;
          depth += ${STEP} - si;
          p = ${V_PLANE_POSITION} + d * (d0 - si) / c;  
        }
        count = ${NUM_STEPS};
      }
      tm = tm1;
      tb = texture(
        ${U_BOUNDARY_TEXTURE},
        ${V_LINE_TEXTURE_COORD} + p.xy * ${LINE_TEXTURE_PROPORTION}
      );  
      if (tb.a < .5 && depth < 0.) {
        count = ${NUM_STEPS};
      }
    }
    vec4 tl = texture(
      ${U_LINE_TEXTURE},
      ${V_LINE_TEXTURE_COORD} + p.xy * ${LINE_TEXTURE_PROPORTION}
    );

    // todo can move up to replace tm = tm1
    tm = texture(
      ${U_MATERIAL_TEXTURE},
      p.xy * ${U_LINE_WIDTH}.w + ${V_PLANE_POSITION}.zw
    );
    vec2 n = tm.xy * 2. - 1.;
    vec3 m = (${V_PLANE_ROTATION_MATRIX} * vec4(n, pow(1. - length(n), 2.), 1)).xyz;
    vec4 color = mix(${U_MATERIAL_COLOR_2}, ${U_MATERIAL_COLOR_1}, abs(tm.a * 2. - 1.));
    ${O_COLOR} = vec4(
      mix(
        color.rgb * pow(max(0., (dot(m, normalize(vec3(1, 2, 3)))+1.)/2.), color.a * 2.),
        //tm.xyz,
        //(p.xyz + 1.)/2.,
        //vec3(depth + .5),
        //vec3(count/${NUM_STEPS}),
        //mix(${U_LINE_COLOR}.rgb, ${U_MATERIAL_COLOR_1}.rgb, min(1., abs(depth) * 9.)),
        ${U_LINE_COLOR}.rgb,
        //tl.xyz,
        //0.
        max(length(tl.rgb * ${U_LINE_WIDTH}.xyz), 1. - tb.a)
      ),
      1
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
  const cube: ConvexShape = [
    toPlane(0, 0, 1, 2),
    toPlane(0, 0, -1, 2),
    toPlane(1, 0, 0, 2),
    toPlane(-1, 0, 0, 2),
    toPlane(0, 1, 0, 2),
    toPlane(0, -1, 0, 2),
  ];

  const roundedCube1 = round(round(cube, -1, false), -.8, true);
  const roundedCube2 = convexShapeExpand(roundedCube1, .1)
  
  const segmentsz = 8;
  const segmentsy = 4;
  const ry = .3;
  const rz = 1;
  const hole = rz;

  const sphere: ConvexShape = new Array(segmentsz).fill(0).map((_, i, arrz) => {
    const az = Math.PI * 2 * i / arrz.length;
    const cosz = Math.cos(az);
    const sinz = Math.sin(az);
    return new Array(segmentsy).fill(0).map<Plane>((_, j, arry) => {
      const ay = Math.PI * (j + 1) / (arry.length + 1) - Math.PI/2;
      const cosy = Math.cos(ay);
      const siny = Math.sin(ay);
      return toPlane(cosz * cosy, sinz * cosy, siny, rz);
    });
  }).flat(1).concat([
    toPlane(0, 0, -1, rz),
    toPlane(0, 0, 1, rz),
  ]);

  const column: ConvexShape = new Array(segmentsz).fill(0).map((_, i, arrz) => {
    const az = Math.PI * 2 * i / arrz.length;
    const cosz = Math.cos(az);
    const sinz = Math.sin(az);
    return toPlane(cosz, sinz, 0, 1);
  }).concat([
    toPlane(0, 0, -1, 5),
    toPlane(0, 0, 1, 5),
  ]);

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
    //[cube, []],
    //[shape1, []],
    //[shape7, [shape6]],
    // [shape5, [shape6]],
    // [shape1, [shape2, shape3, shape4, shape6]],
    //[disc, columns],
    //[roundedCube1, []],
    [sphere, []],
    //[sphere, [column]],
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

  const canvas3d = document.getElementById("canvas3d") as HTMLCanvasElement;
  canvas3d.width = canvas3d.clientWidth;
  canvas3d.height = canvas3d.clientHeight;
  const gl = canvas3d.getContext("webgl2", {
    // prevents alpha from being rendered, but we can still use it for
    // measuring brightness (hopefully)
    alpha: false,
  });

  //const lineTextureDimension: number = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
  const lineTextureDimension: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  //const lineTextureDimension = 2048;
  const lineTextureScale = lineTextureDimension * LINE_TEXTURE_PROPORTION;
  const lineTextureBuffer = lineTextureScale / 2;
  const baseLineWidth = lineTextureDimension/4096;
  
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
    aNormalTransform,
    aLineTextureOffset,
  ] = [
    A_VERTEX_WORLD_POSITION,
    A_VERTEX_PLANE_POSITION,
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
    uLineColor,
    uLineWidth,
    uBoundaryTexture,
    uMaterialTexture,
    uMaterialColor1,
    uMaterialColor2,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_MODEL_ROTATION_MATRIX,
    U_CAMERA_POSITION,
    U_PROJECTION_MATRIX,
    U_LINE_TEXTURE,
    U_LINE_COLOR,
    U_LINE_WIDTH,
    U_BOUNDARY_TEXTURE,
    U_MATERIAL_TEXTURE,
    U_MATERIAL_COLOR_1,
    U_MATERIAL_COLOR_2,
  ].map(
    uniform => gl.getUniformLocation(program, uniform)
  );

  const pointAdjacency = faces.reduce((acc, face) => {
    const { polygons, toWorldCoordinates } = face;

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

  // add in some textures
  const materials: Material[][] = [
    [
      createFlatMaterialFactory(127, 1),
    ],
    [
      createFlatMaterialFactory(128, .7), 
      featureMaterial(staticFactory(99), 9, 39, 4999),
    ],
    [
      createFlatMaterialFactory(128, .5),
      featureMaterial(riverStonesFactory(.6), 9, 49, 999),
      featureMaterial(staticFactory(40), 2, 2, 4999),
    ],
    [
      createFlatMaterialFactory(128, .5),
      featureMaterial(staticFactory(99), 1, 9, 4999),
      featureMaterial(riverStonesFactory(1), 9, 99, 199),
    ],
    [
      createFlatMaterialFactory(128, 1),
      featureMaterial(craterFeature(99), 9, 99, 99),
      featureMaterial(staticFactory(40), 9, 99, 4999),
    ],
    [
      createFlatMaterialFactory(128, .5),
      featureMaterial(spikeFeature(2, 1, 28), 29, 29, 99),
      featureMaterial(staticFactory(40), 9, 9, 1999),
    ],
  ];
  const materialCanvases = materials.map((materials, i) => {
    const materialCanvas = document.getElementById('canvasMaterial'+i) as HTMLCanvasElement;
    materialCanvas.width = MATERIAL_TEXTURE_DIMENSION;
    materialCanvas.height = MATERIAL_TEXTURE_DIMENSION;
    const ctx = materialCanvas.getContext('2d');
    materials.forEach(material => material(ctx));
    return [materialCanvas];
  });

  // want a space so we can have transparent area to map inverted shapes to
  let textureX = lineTextureScale * 4;
  let textureY = 0;
  let textureMaxHeight = lineTextureScale * 4;
  //ctx.lineCap = 'round';

  const geometryLineCanvases = new Array(6).fill(0).map((_, level) => {
    const canvas = level ? document.createElement('canvas') : document.getElementById("canvasLines") as HTMLCanvasElement;
    const dimension = Math.pow(lineTextureDimension, 1/(level+1));
    canvas.width = dimension;
    canvas.height = dimension;
    return canvas;
  });
  // const geometryLineCanvas = document.getElementById("canvasLines") as HTMLCanvasElement;
  // geometryLineCanvas.width = LINE_TEXTURE_DIMENSION;
  // geometryLineCanvas.height = LINE_TEXTURE_DIMENSION;
  // const ctx = geometryLineCanvas.getContext('2d');

  // leave it as alpha
  //ctx.fillRect(0, 0, LINE_TEXTURE_DIMENSION, LINE_TEXTURE_DIMENSION);
  //ctx.fillStyle = '#000';

  const [
    worldPoints,
    planePoints,
    normalTransforms,
    lineTextureOffsets,
    indices,
  ] = faces.reduce<[
    // world position points
    [number, number, number][],
    // plane position points
    [number, number, number, number][],
    // mat4 normal transforms
    [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number][],
    // line texture offsets
    [number, number][],
    // indices
    number[],
  ]>(
    ([worldPoints, planePoints, normalTransforms, lineTextureOffsets, indices], face) => {
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
      let originalTextureX: number;
      if (!inverted) {
        const width = (maxX - minX) * lineTextureScale + lineTextureBuffer * 2 | 0;
        const height = (maxY - minY) * lineTextureScale + lineTextureBuffer * 2 | 0;
        
        if (textureX + width > lineTextureDimension) {
          textureX = 0;
          textureY += textureMaxHeight;
          textureMaxHeight = 0;
        }
        originalTextureX = textureX;
        textureX += width;
        textureMaxHeight = Math.max(height, textureMaxHeight);
        // function toTextureCoordinate([px, py]: ReadonlyVec3): [number, number] {
        //   return [
        //     originalTextureX + (px - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER, 
        //     textureY + (py - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER,
        //   ];
        // }
        geometryLineCanvases.forEach((geometryLineCanvas, i) => {
          const divisor = Math.pow(2, i);
          const ctx = geometryLineCanvas.getContext('2d');
          const lineConnections = new Map<[number, number, number], [number, number, number]>();
          const normal = [...vec3.transformMat4(
            vec3.create(),
            NORMAL_Z,
            rotateToWorldCoordinates,
          )] as [number, number, number];
    
          polygons.forEach(polygon => {
            ctx.beginPath();
            polygon.forEach((currentPoint, i) => {
              const currentWorldPoint = getWorldPoint(currentPoint, toWorldCoordinates);
              const nextPoint = polygon[(i + 1)%polygon.length];
              const nextWorldPoint = getWorldPoint(nextPoint, toWorldCoordinates);
              const adjacentFace = pointAdjacency.get(nextWorldPoint).get(currentWorldPoint);
              const adjacentNormal = vec3.transformMat4(
                vec3.create(), NORMAL_Z, adjacentFace.rotateToWorldCoordinates,
              );
              const [x, y] = currentPoint;
              const px = originalTextureX + (x - minX) * lineTextureScale + lineTextureBuffer;
              const py = textureY + (y - minY) * lineTextureScale + lineTextureBuffer;
              ctx.lineTo(px / divisor, py / divisor);
              const sinAngle = 1 - Math.abs(vec3.dot(normal, adjacentNormal));
              if (sinAngle > EPSILON) {      
                lineConnections.set(currentWorldPoint, nextWorldPoint);
              }
            });
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = baseLineWidth/divisor;
            //ctx.strokeStyle = '#000';
            ctx.stroke();
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
    
          //ctx.lineCap = 'round';
          // ctx.fillStyle = 'rgba(0, 0, 0, .5)';
          // ctx.globalCompositeOperation = 'destination-out';
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
              const px = originalTextureX + (x - minX) * lineTextureScale + lineTextureBuffer;
              const py = textureY + (y - minY) * lineTextureScale + lineTextureBuffer;
              ctx.lineTo(px / divisor, py / divisor);
              // round corners
              currentWorldPoint = nextWorldPoint;
            }
            if (closePath) {
              ctx.closePath();
            }
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            ['red', '#FF0', '#FFF'].forEach((strokeStyle, i) => {
              ctx.strokeStyle = strokeStyle;
              //ctx.lineWidth = Math.pow(2, 2 - i);
              ctx.lineWidth = (3 - i) * baseLineWidth/divisor;
              ctx.stroke();  
            });
            ctx.restore();
          }  
        });
      }


      // hashes to transformed points?
      const hashesToPoints = polygonPoints.reduce((acc, point) => {
        return acc.add(getWorldPoint(point, toWorldCoordinates));
      }, new Set<[number, number, number]>());
      const uniquePoints = [...hashesToPoints];

      const x = (-minX * lineTextureScale + lineTextureBuffer + originalTextureX)/lineTextureDimension;
      const y = (-minY * lineTextureScale + lineTextureBuffer + textureY)/lineTextureDimension;
      const newLineTextureOffsets = uniquePoints.map<[number, number]>(() => {
        // const [px, py] = vec3.transformMat4(vec3.create(), worldPoint, fromWorldCoordinates);
        // const x = ((px - minX) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + originalTextureX)/geometryLineCanvas.width;
        // const y = ((py - minY) * LINE_TEXTURE_SCALE + LINE_TEXTURE_BUFFER + textureY)/geometryLineCanvas.height;
        return inverted ? [0, 0] : [x, y];
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
        // const cosAngle = vec3.dot(normal, NORMAL_Z);
        // const angle = Math.acos(cosAngle);
        // const axis = Math.abs(cosAngle) > 1 - EPSILON
        //   ? NORMAL_X
        //   : vec3.normalize(vec3.create(), vec3.cross(vec3.create(), normal, NORMAL_Z));
        // const rotation = mat4.rotate(mat4.create(), mat4.identity(mat4.create()), angle, axis);
        // return [...rotation] as any;
        // return [...vec3.normalize(normal, normal)] as [number, number, number];

        return [...rotateToWorldCoordinates] as any;
      });
      const dx = Math.random();
      const dy = Math.random();
      const newPlanePoints = uniquePoints.map<[number, number, number, number]>(worldPoint => {
        const [x, y] = vec3.transformMat4(vec3.create(), worldPoint, fromWorldCoordinates);
        return [x, y, dx, dy];
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
        [...normalTransforms, ...newNormalTransforms],
        [...lineTextureOffsets, ...newLineTextureOffsets],
        [...indices, ...newIndices],
      ];
    },
    [[], [], [], [], []],
  );

  [
    geometryLineCanvases,
    [geometryLineCanvases[0]],
    ...materialCanvases,
  ].forEach((images, i) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // TODO need to mipmap geometry because we are scaling it so much
    images.forEach((image, level) => {
      gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    });
    // NOT required (don't use mipmaps)
    gl.generateMipmap(gl.TEXTURE_2D);
    // materials needs a linear filter otherwise the gaps between resolutions
    // causes holes in the material
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      images.length > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
    );
  });


  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  ([
    [aWorldPosition, worldPoints],
    [aPlanePosition, planePoints],
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
  let material = 2;

  window.onclick = (e: MouseEvent) => {
    // camera position is 0, 0, 0
    const inverseProjectionMatrix = mat4.invert(mat4.create(), projectionMatrix);
    const world = vec3.transformMat4(
      vec3.create(),
      [e.clientX/canvas3d.width * 2 - 1, e.clientY/canvas3d.height * -2 + 1, 0],
      inverseProjectionMatrix,
    );
    console.log('world', ...world);
    const line = vec3.normalize(
      vec3.create(),
      world,
    );
    console.log('line', ...line);
    const modelMatrix = mat4.multiply(
      mat4.create(),
      modelPositionMatrix,
      modelRotationMatrix,
    );
    const inverseModelMatrix = mat4.invert(
      mat4.create(),
      modelMatrix,
    );
    const inverseModelRotationMatrix = mat4.invert(
      mat4.create(),
      modelRotationMatrix,
    );
    const relativeCameraPosition = vec3.transformMat4(vec3.create(), [0, 0, 0], inverseModelMatrix);
    const relativeCameraDirection = vec3.transformMat4(vec3.create(), line, inverseModelRotationMatrix);
    const intersections = faces.map(({
      polygons,
      toWorldCoordinates,
      rotateToWorldCoordinates,
      inverted,
    }) => {
      if (!inverted) {
        const fromWorldCoordinates = mat4.invert(mat4.create(), toWorldCoordinates);
        const rotateFromWorldCoordinates = mat4.invert(mat4.create(), rotateToWorldCoordinates);  
        const surfaceCameraPosition = vec3.transformMat4(vec3.create(), relativeCameraPosition, fromWorldCoordinates);
        const surfaceCameraDirection = vec3.transformMat4(vec3.create(), relativeCameraDirection, rotateFromWorldCoordinates);
        const dz = surfaceCameraDirection[2];
        const z = surfaceCameraPosition[2];
        // ensure the surface is pointing at us
        if (dz < -EPSILON) {
          const surfaceIntersectionPoint = vec3.scaleAndAdd(
            vec3.create(),
            surfaceCameraPosition,
            surfaceCameraDirection,
            -z / dz,
          );
          const contained = polygons.some(polygon => {
            return convexPolygonContainsPoint(polygon, surfaceIntersectionPoint);
          });  
          if (contained) {
            const worldPoint = vec3.transformMat4(vec3.create(), surfaceIntersectionPoint, toWorldCoordinates);
            return worldPoint;
          }
        }
      }
      return [];
    }).flat(1).map(worldPoint => {
      return [...vec3.transformMat4(vec3.create(), worldPoint, modelMatrix)];
    });
    console.log('intersections', ...intersections);
  };
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
    const v = e.deltaY/100;
    const positionMatrix = mat4.translate(mat4.create(), mat4.identity(mat4.create()), [0, 0, -v]);
    mat4.multiply(modelPositionMatrix, positionMatrix, modelPositionMatrix);
  };
  window.onkeydown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'Enter':
        material = (material + 1)%materials.length;
        gl.uniform1i(uMaterialTexture, material + 2);
        break;
      case 'ArrowLeft':
        cameraX-=.1;
        setCameraPosition();
        break;
      case 'ArrowRight':
        cameraX+=.1;
        setCameraPosition();
        break;
      case 'ArrowUp':
        cameraY+=.1;
        setCameraPosition();
        break;
      case 'ArrowDown':
        cameraY-=.1;
        setCameraPosition();
        break;
      case 'a':
        gl.uniform4f(uMaterialColor1, Math.random(), Math.random(), Math.random(), Math.random());
        break;
      case 's':
        gl.uniform4f(uMaterialColor2, Math.random(), Math.random(), Math.random(), Math.random());
        break;
      case 'd':
        gl.uniform4f(uLineColor, Math.random(), Math.random(), Math.random(), 1);
        break;
      case 'z':
        lineWidthIndex--;
        setLineWidth();
        break;
      case 'x':
        lineWidthIndex++;
        setLineWidth();
        break;
      case 'w':
        materialScale*=2;
        setLineWidth();
        console.log('material scale', materialScale);
        break;
      case 'q':
        materialScale/=2;
        setLineWidth();
        console.log('material scale', materialScale);
        break;
    } 
  };

  let lineWidthIndex = 0;
  let materialScale = MATERIAL_DEPTH_SCALE;
  function setLineWidth() {
    gl.uniform4f(
      uLineWidth,
      lineWidthIndex == 0 ? 1 : 0,
      lineWidthIndex == 1 ? 1 : 0,
      lineWidthIndex == 2 ? 1 : 0,
      materialScale,
    );
  }
  let cameraX = 0;
  let cameraY = 0;
  let cameraZ = 0;
  function setCameraPosition() {
    gl.uniform3f(uCameraPosition, cameraX, cameraY, cameraZ);
  }

  const fpsDiv = document.getElementById('fps');
  const lastFrameTimes: number[] = [];
  gl.uniform1i(uLineTexture, 0);
  gl.uniform1i(uBoundaryTexture, 1);
  //gl.uniform4f(uLineColor, .8, .9, 1, 1);
  gl.uniform4f(uLineColor, 0, 1, 1, 1);
  gl.uniform1i(uMaterialTexture, material);
  gl.uniform4f(uMaterialColor1, 0, 0, 0, 0);
  gl.uniform4f(uMaterialColor2, .2, .2, .4, .5);
  setLineWidth();
  setCameraPosition();
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
    const cameraPositionAndProjectionMatrix = mat4.multiply(
      mat4.create(),
      projectionMatrix,
      mat4.fromTranslation(mat4.create(), [-cameraX, -cameraY, -cameraZ]),
    );
    gl.uniformMatrix4fv(uProjectionMatrix, false, cameraPositionAndProjectionMatrix);
    gl.uniformMatrix4fv(uModelViewMatrix, false, modelPositionMatrix);
    gl.uniformMatrix4fv(uModelRotationMatrix, false, modelRotationMatrix);
    
    // gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);  
    //gl.drawElements(gl.LINE_LOOP, indices.length, gl.UNSIGNED_SHORT, 0);  
    requestAnimationFrame(animate);
  }
  animate(0);
};
