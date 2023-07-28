import { ConvexShape, Shape, convexShapeContainPoint, convexShapeExpand } from "./geometry/shape";
import { Plane, toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, mat4, vec2, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_X, NORMAL_Z } from "./geometry/constants";
import { Face, convexPolygonContainsPoint } from "./geometry/face";
import { Material, clusteredDistributionFactory, evenDistributionFactory, featureMaterial, randomDistributionFactory } from "./materials/material";
import { riverStonesFactory } from "./materials/river_stones";
import { craterFeature } from "./materials/craters";
import { staticFactory } from "./materials/static";
import { round } from "./geometry/round";
import { DEPTH_RANGE, MATERIAL_TEXTURE_DIMENSION } from "./constants";
import { spikeFeature } from "./materials/spikes";
import { Line, closestLinePointVector, lineDeltaAndLength, lineIntersection, lineIntersectsPoints, toFiniteLine, toLine } from "./geometry/line";
import { hillFeature } from "./materials/hills";

type MaybeInvertedFace = Face & {
  inverted: number,
};

const LINE_TEXTURE_DIMENSION = 4096;
//const LINE_TEXTURE_DIMENSION = 1024;
//const LINE_TEXTURE_SCALE = 80;
//const c = 64/4096;
const LINE_TEXTURE_PROPORTION = 64/LINE_TEXTURE_DIMENSION;
//const LINE_TEXTURE_BUFFER = LINE_TEXTURE_SCALE/2;
const BORDER_EXPAND = .02;
//const MATERIAL_TEXTURE_DIMENSION = 4096;
const MATERIAL_DEPTH_SCALE = 256/(MATERIAL_TEXTURE_DIMENSION * DEPTH_RANGE);
const MATERIAL_OFFSET_SCALE = 256/MATERIAL_TEXTURE_DIMENSION;

const A_VERTEX_WORLD_POSITION = "aVertexWorldPosition";
const A_VERTEX_PLANE_POSITION = 'aVertexPlanePosition';
const A_VERTEX_PLANE_ROTATION_MATRIX = 'aVertexPlaneRotation';
const A_VERTEX_LINE_TEXTURE_OFFSET = 'aVertexLineTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelView";
const U_MODEL_ROTATION_MATRIX = 'uModelRotation';
const U_PROJECTION_MATRIX = "uProjection";
const U_LINE_TEXTURE = 'uLine';
const U_LINE_COLOR = 'uLineColor';
const U_LINE_SCALE_EXPONENT_MATERIAL_SCALE = 'uScales';
const U_MATERIAL_TEXTURE = 'uMaterial';
const U_MATERIAL_DISTANCE_TEXTURE = 'uMaterialDistance';
const U_MATERIAL_COLOR_BASE = 'uMaterialColorBase';
const U_MATERIAL_COLOR_FEATURE = 'uMaterialColorFeature';
const U_MATERIAL_COLOR_SURFACE = 'uMaterialColorSurface';
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
  uniform vec3 ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE};
  uniform sampler2D ${U_MATERIAL_TEXTURE};
  uniform sampler2D ${U_MATERIAL_DISTANCE_TEXTURE};
  uniform vec4 ${U_MATERIAL_COLOR_BASE};
  uniform vec4 ${U_MATERIAL_COLOR_FEATURE};
  uniform vec4 ${U_MATERIAL_COLOR_SURFACE};
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
    float depthScale = ${MATERIAL_DEPTH_SCALE}/${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z;

    float depth = ${DEPTH_RANGE/2};
    // material
    vec4 tm;
    // distances
    vec4 td;
    vec4 p;
    vec4 tl;
    for (int count = 0; count < ${NUM_STEPS}; count++) {
      depth -= ${STEP};
      p = ${V_PLANE_POSITION} + d * depth / c;
      tl = texture(
        ${U_LINE_TEXTURE},
        ${V_LINE_TEXTURE_COORD} + p.xy * ${LINE_TEXTURE_PROPORTION}
      );  
      td = texture(
        ${U_MATERIAL_DISTANCE_TEXTURE},
        p.xy * ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z + ${V_PLANE_POSITION}.zw
      );
      vec2 cp = p.xy - (td.xy - .5) * ${MATERIAL_OFFSET_SCALE}/${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z;
      float r = td.z * ${MATERIAL_OFFSET_SCALE}/${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z;
      vec4 tc = texture(
        ${U_LINE_TEXTURE},
        ${V_LINE_TEXTURE_COORD} + cp * ${LINE_TEXTURE_PROPORTION}
      );
      vec4 tm1 = tc.r < r ? vec4(.5) : texture(
        ${U_MATERIAL_TEXTURE},
        p.xy * ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z + ${V_PLANE_POSITION}.zw
      );

      float surfaceDepth = (tm1.z - .5) ${DEPTH_RANGE == 1 ? '' : ` * ${DEPTH_RANGE}`} * depthScale; 
      if (surfaceDepth > depth && tl.a > .5) {
        float d0 = depth + ${STEP};
        float s0 = d0 - (tm.z - .5) ${DEPTH_RANGE == 1 ? '' : ` * ${DEPTH_RANGE}`} * depthScale;
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
      // TODO do we need to update tc with the new p?
      tm = tc.r < r ? vec4(.5) : texture(
        ${U_MATERIAL_TEXTURE},
        p.xy * ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.z + ${V_PLANE_POSITION}.zw
      );  
      tl = texture(
        ${U_LINE_TEXTURE},
        ${V_LINE_TEXTURE_COORD} + p.xy * ${LINE_TEXTURE_PROPORTION}
      );

      if (tl.a < .5 && depth < 0.) {
        count = ${NUM_STEPS};
      }
    }

    vec2 n = tm.xy * 2. - 1.;
    vec3 m = (${V_PLANE_ROTATION_MATRIX} * vec4(n, pow(1. - length(n), 2.), 1)).xyz;
    vec4 color = ${U_MATERIAL_COLOR_BASE}
      + mix(
        ${U_MATERIAL_COLOR_FEATURE} * (tm.a * 2. - 1.),
        ${U_MATERIAL_COLOR_SURFACE} * (td.a * 2. - 1.),
        abs(td.a * 2. - 1.)
      );
    ${O_COLOR} = vec4(
      mix(
        color.rgb * pow(max(0., (dot(m, normalize(vec3(1, 2, 3)))+1.)/2.), color.a * 2.),
        //tm.xyz,
        //(p.xyz + 1.)/2.,
        //vec3(depth + .5) * 2.,
        //vec3(count/${NUM_STEPS}),
        ${U_LINE_COLOR}.rgb,
        //tl.xyz,
        //0.
        pow(
          (1. - tl.g) * ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.x,
          ${U_LINE_SCALE_EXPONENT_MATERIAL_SCALE}.y
        )
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
  
  // const segmentsz = 16;
  // const segmentsy = 8;
  const segmentsz = 6;
  const segmentsy = 2;
  const ry = .6;
  const rz = 2;
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
    //[disc, []],
    //[disc, columns],
    [roundedCube1, []],
    //[sphere, []],
    //[sphere, [column]],
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

  // get context loss if the textures are too big
  //const lineTextureDimension: number = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
  //const lineTextureDimension: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const lineTextureDimension = LINE_TEXTURE_DIMENSION;
  const lineTextureScale = lineTextureDimension * LINE_TEXTURE_PROPORTION;
  const lineTextureBuffer = lineTextureScale / 2;
  const baseLineWidth = lineTextureDimension/LINE_TEXTURE_DIMENSION;
  
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
    uLineScaleExponentMaterialScale,
    uMaterialTexture,
    uMaterialDistanceTexture,
    uMaterialColorBase,
    uMaterialColorFeature,
    uMaterialColorSurface,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_MODEL_ROTATION_MATRIX,
    U_CAMERA_POSITION,
    U_PROJECTION_MATRIX,
    U_LINE_TEXTURE,
    U_LINE_COLOR,
    U_LINE_SCALE_EXPONENT_MATERIAL_SCALE,
    U_MATERIAL_TEXTURE,
    U_MATERIAL_DISTANCE_TEXTURE,
    U_MATERIAL_COLOR_BASE,
    U_MATERIAL_COLOR_FEATURE,
    U_MATERIAL_COLOR_SURFACE,
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
  });

  const pointFaces = faces.reduce<Map<[number, number, number], Set<Face>>>(
    (acc, face) => {
      const { polygons, toWorldCoordinates } = face;
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
    [],
    [
      featureMaterial(staticFactory(99), 50, 2999, clusteredDistributionFactory(
        20,
        50,
        1,
        5,
        .8, 
        4
      ), true),
    ],
    [
      featureMaterial(riverStonesFactory(.6), 40, 699, randomDistributionFactory(.9, 2)),
      featureMaterial(staticFactory(40), 4, 999, randomDistributionFactory(.5, 1), true),
    ],
    [
      featureMaterial(hillFeature(1), 99, 99, randomDistributionFactory(.9, 2)),
    ],
    [
      featureMaterial(hillFeature(-.5), 99, 99, randomDistributionFactory(.9, 2)),
      featureMaterial(staticFactory(99), 9, 999, randomDistributionFactory(.9, 1), true),
    ],
    [
      featureMaterial(riverStonesFactory(1), 19, 99, evenDistributionFactory(49)),
    ],
    [
      featureMaterial(staticFactory(40), 99, 999, randomDistributionFactory(.9, 2), true),
      featureMaterial(craterFeature(59), 49, 199, clusteredDistributionFactory(
        19,
        19,
        0,
        5,
        .8, 
        3,
      )),
    ],
    [
      featureMaterial(spikeFeature(3, 2, 99), 30, 99, clusteredDistributionFactory(
        9,
        99,
        1,
        0,
        .3, 
        9,
      )),
      featureMaterial(staticFactory(40), 9, 999, randomDistributionFactory(.5, 1), true),
    ],
  ];
  const materialCanvases = materials.map((materials, i) => {
    const materialCanvas = document.getElementById('canvasMaterial'+i) as HTMLCanvasElement || document.createElement('canvas');
    materialCanvas.width = MATERIAL_TEXTURE_DIMENSION;
    materialCanvas.height = MATERIAL_TEXTURE_DIMENSION; 
    const ctx = materialCanvas.getContext('2d', {
      willReadFrequently: true,
    });
    // nx = 0, ny = 0, depth = 0, feature color = 0
    ctx.fillStyle = 'rgba(127,127,128,.5)';
    ctx.fillRect(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);

    const materialCanvas2 = document.getElementById('canvasDistance'+i) as HTMLCanvasElement || document.createElement('canvas');
    materialCanvas2.width = MATERIAL_TEXTURE_DIMENSION;
    materialCanvas2.height = MATERIAL_TEXTURE_DIMENSION; 
    const ctx2 = materialCanvas2.getContext('2d', {
      willReadFrequently: true,
    });
    // dx = 0, dy = 0, r = 0, surface color = 0
    ctx2.fillStyle = 'rgba(127,127,0,.5)';
    ctx2.fillRect(0, 0, MATERIAL_TEXTURE_DIMENSION, MATERIAL_TEXTURE_DIMENSION);

    materials.forEach(material => material(ctx, ctx2));
    return [materialCanvas, materialCanvas2];
  });

  // want a space so we can have transparent area to map inverted shapes to
  let textureX = lineTextureScale * 4;
  let textureY = 0;
  let textureMaxHeight = lineTextureScale * 4;

  const geometryLineCanvas = document.getElementById("canvasLines") as HTMLCanvasElement;
  geometryLineCanvas.width = lineTextureDimension;
  geometryLineCanvas.height = lineTextureDimension;

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
        const ctx = geometryLineCanvas.getContext('2d', {
          willReadFrequently: true,
        });
        const lineConnections = new Map<[number, number, number], [number, number, number]>();
        const edgeConnections = new Map<[number, number, number], [number, number, number]>();
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
            const px = originalTextureX + (x - minX) * lineTextureScale + lineTextureBuffer + .5;
            const py = textureY + (y - minY) * lineTextureScale + lineTextureBuffer + .5;
            ctx.lineTo(px, py);
            const sinAngle = 1 - Math.abs(vec3.dot(normal, adjacentNormal));
            if (sinAngle > EPSILON) {
              lineConnections.set(currentWorldPoint, nextWorldPoint);
            }
            if (adjacentFace != face) {
              edgeConnections.set(currentWorldPoint, nextWorldPoint);
            }
          });
          ctx.closePath();
          ctx.fill();
          // TODO baseLineWidth is probably 1, so can be removed
          ctx.lineWidth = baseLineWidth;
          //ctx.strokeStyle = '#000';
          ctx.stroke();
        });

        const imageData = ctx.getImageData(originalTextureX, textureY, width, height);
        const keyPointsAndlines = [...lineConnections].map(worldPoints => {
          const linePoints: [ReadonlyVec3, ReadonlyVec3] = worldPoints.map(worldPoint => {
            return vec3.transformMat4(
              vec3.create(),
              worldPoint,
              fromWorldCoordinates,
            );
          }) as any;
          const finiteLine = toFiniteLine(...linePoints);
          return [worldPoints[0], finiteLine] as const;
        });
        for(let py=0; py<height; py++) {
          const y = (py - lineTextureBuffer + .5)/lineTextureScale + minY;
          for(let px=0; px<width; px++) {
            const x = (px - lineTextureBuffer + .5)/lineTextureScale + minX;
            const index = (py * width + px) * 4;
            // for performance reasons, only perform this calculation if the pixel is filled 
            if (imageData.data[index + 3]) {
              let minLine = 1;
              let minEdge = 1;
              keyPointsAndlines.forEach(([keyPoint, line]) => {
                const d = vec2.length(closestLinePointVector(line, [x, y]));
                minEdge = Math.min(minEdge, d);
                if (lineConnections.has(keyPoint)) {
                  minLine = Math.min(minLine, d);
                }
              });
              imageData.data.set([minEdge * 255 | 0, minLine * 255 | 0], index);                
            }
          }
        }
        ctx.putImageData(imageData, originalTextureX, textureY);
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

      const newNormalTransforms = uniquePoints.map(() => {
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
    geometryLineCanvas,
    ...materialCanvases.flat(1),
  ].forEach((image, i) => {  
    gl.activeTexture(gl.TEXTURE0 + i);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // NOT required (don't use mipmaps)
    //gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      //images.length > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      gl.LINEAR,
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
  let material = 1;

  window.onclick = (e: MouseEvent) => {
    // camera position is 0, 0, 0f
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
        gl.uniform1i(uMaterialTexture, material * 2 + 1);
        gl.uniform1i(uMaterialDistanceTexture, material * 2 + 2);
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
        gl.uniform4f(uMaterialColorBase, Math.random()/2, Math.random()/2, Math.random()/2, Math.random());
        break;
      case 's':
        gl.uniform4f(uMaterialColorSurface, Math.random()/2, Math.random()/2, Math.random()/2, Math.random());
        break;
      case 'd':
        gl.uniform4f(uLineColor, Math.random(), Math.random(), Math.random(), 1);
        break;
      case 'f':
        gl.uniform4f(uMaterialColorFeature, Math.random(), Math.random(), Math.random(), Math.random());
        break;
      case 'z':
        lineExponent*=1.2;
        setLineScaleExponentMaterialScale();
        break;
      case 'x':
        lineExponent/=1.2;
        setLineScaleExponentMaterialScale();
        break;
      case 'c':
        lineScale/=2;
        setLineScaleExponentMaterialScale();
        break;
      case 'v':
        lineScale*=2;
        setLineScaleExponentMaterialScale();
        break;
      case 'w':
        materialScale*=1.5;
        setLineScaleExponentMaterialScale();
        console.log('material scale', materialScale);
        break;
      case 'q':
        materialScale/=1.5;
        setLineScaleExponentMaterialScale();
        console.log('material scale', materialScale);
        break;
    } 
  };

  let lineScale = 1;
  let lineExponent = 50;
  let materialScale = .25;
  function setLineScaleExponentMaterialScale() {
    gl.uniform3f(
      uLineScaleExponentMaterialScale,
      lineScale,
      lineExponent,
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
  //gl.uniform4f(uLineColor, .8, .9, 1, 1);
  gl.uniform4f(uLineColor, 0, 1, 1, 1);
  gl.uniform1i(uMaterialTexture, material * 2 + 1);
  gl.uniform1i(uMaterialDistanceTexture, material * 2 + 2);
  gl.uniform4f(uMaterialColorBase, .2, .2, .4, .5);
  gl.uniform4f(uMaterialColorFeature, .4, .4, .5, .5);
  gl.uniform4f(uMaterialColorSurface, .5, .5, .5, .5);
  setLineScaleExponentMaterialScale();
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
