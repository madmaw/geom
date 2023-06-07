import { ConvexShape, Shape, convexShapeExpand } from "./geometry/shape";
import { toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyVec3, ReadonlyVec4, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON } from "./geometry/constants";

const A_VERTEX_POSITION = "aVertexPosition";
const A_VERTEX_COLOR = "aVertexColor";

const U_MODEL_VIEW_MATRIX = "uModelViewMatrix";
const U_PROJECTION_MATRIX = "uProjectionMatrix";

const V_COLOR = "vColor";
const O_COLOR = "oColor";

const VERTEX_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${A_VERTEX_POSITION};
  in vec4 ${A_VERTEX_COLOR};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_COLOR};

  void main(void) {
    gl_Position = ${U_PROJECTION_MATRIX} * ${U_MODEL_VIEW_MATRIX} * ${A_VERTEX_POSITION};
    ${V_COLOR} = ${A_VERTEX_COLOR};
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_COLOR};
  out vec4 ${O_COLOR};

  void main(void) {
    ${O_COLOR} = ${V_COLOR};
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
    toPlane(0, -1, 0, .4),
    toPlane(0, 0, 1, .15),
    toPlane(0, 0, -1, .15),
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
    toPlane(1, 0, 0, .2),
    toPlane(-1, 0, 0, .2),
    toPlane(0, 1, 0, 1.8),
    toPlane(0, -1, 0, 1),
    toPlane(0, 0, 1, 1),
    toPlane(0, 0, -1, -.6),
  ];

  // chimney hole
  const shape6: ConvexShape = [
    toPlane(1, 0, 0, .1),
    toPlane(-1, 0, 0, .1),
    toPlane(0, 1, 0, 1.9),
    toPlane(0, -1, 0, 1.1),
    toPlane(0, 0, 1, 1.1),
    toPlane(0, 0, -1, -.7),
  ];
  

  const expand = 0.0;
  const shapes: Shape[] = ([
    [shape5, [shape6]],
    [shape1, [shape2, shape3, shape4, shape6]],
  ] as const).map(([addition, subtractions]) => {
    return [
      convexShapeExpand(addition, expand),
      subtractions.map(subtraction => convexShapeExpand(subtraction, -expand)),
    ];
  });

  const faces = decompose(shapes).filter(() => Math.random() > .0);
  
  console.log(faces.map(({ polygons }) => polygons.map(polygon => polygon.map(point => [...point]))));
  console.log(faces.map(({ polygons, transform }) => (
    polygons.map(polygon => {
      return polygon.map(point => (
        [...vec3.transformMat4(vec3.create(), point, transform)]
      ));
    })
  )));

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const gl = canvas.getContext("webgl2");
  
  const projectionMatrix = mat4.multiply(
    mat4.create(),
    mat4.identity(mat4.create()),
    mat4.perspective(
      mat4.create(),
      Math.PI/4,
      canvas.clientWidth/canvas.clientHeight,
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
  ] = [
    A_VERTEX_POSITION,
    A_VERTEX_COLOR,
  ].map(
    attribute => gl.getAttribLocation(program, attribute)
  );
  const [
    uModelViewMatrix,
    uProjectionMatrix,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_PROJECTION_MATRIX,
  ].map(
    uniform => gl.getUniformLocation(program, uniform)
  );
  // const points = faces.map(({ polygons, transform }) => {
  //   return polygons.map(polygon => {
  //     return polygon.map<[number, number, number]>(point => {
  //       return [...vec3.transformMat4(vec3.create(), point, transform)] as any;
  //     });
  //   });
  // }).flat(2);
  // const colors = faces.map(({ polygons }, j) => {
  //   return polygons.map((polygon, i) => {
  //     //const color = COLORS[(j+i) % COLORS.length];
  //     const color = [Math.random(), Math.random(), Math.random()];
  //     return polygon.map<[number, number, number]>(() => {
  //       return [...color] as any;
  //     });
  //   });
  // }).flat(2);
  // const [indices] = faces.reduce<[number[], number]>((acc, { polygons }) => {
  //   return polygons.reduce(([indices, offset], polygon) => {
  //     const newIndices = polygon.slice(2).map((_, i) => {
  //       return [offset, offset + i + 1, offset + i + 2];
  //     }).flat(1);
  //     return [[...indices, ...newIndices], offset + polygon.length];
  //   }, acc);
  // }, [[], 0]);

  const [points, colors, indices] = faces.reduce<[[number, number, number][], [number, number, number][], number[]]>(([points, colors, indices], { polygons, transform }) => {
    const inverse = mat4.invert(mat4.create(), transform);
    const polygonPoints = polygons.flat(1);
    const hashesToPoints = polygonPoints.reduce((acc, point) => {
      const pointHash = hashPoint(point);
      return acc.set(pointHash, [...point] as any);
    }, new Map<number, [number, number, number]>());
    const uniquePoints = [...hashesToPoints.values()];

    //const color: [number, number, number] = [Math.random(), Math.random(), Math.random()];
    const normal: [number, number, number] = [...vec3.subtract(
      vec3.create(),
      vec3.transformMat4(vec3.create(), [0, 0, 1], transform),
      vec3.transformMat4(vec3.create(), [0, 0, 0], transform),
    )] as any;
    const cosAngle = (vec3.dot([.5, .8, 0], normal)+2)/3;
    const color: [number, number, number] = [cosAngle, cosAngle, cosAngle];

    const newColors = uniquePoints.map(() => color);
    const newIndices = polygons.reduce<number[]>((indices, polygon) => {
      const polygonIndices = polygon.map(point => {
        const hash = hashPoint(point);
        const uniquePoint = hashesToPoints.get(hash);
        return uniquePoints.indexOf(uniquePoint);
      });
      const originIndex = points.length + polygonIndices[0];
      const newIndices = polygonIndices.slice(1, -1).map((currentIndex, i) => {
        // + 2 because we removed the first element
        const nextIndex = polygonIndices[(i + 2)];
        return [originIndex, points.length + currentIndex, points.length + nextIndex];
      }).flat(1);
      return [...indices, ...newIndices];
    }, []);
    const transformedPoints = uniquePoints.map<[number, number, number]>(point => {
      return [...vec3.transformMat4(vec3.create(), point, transform)] as any;      
    });
    return [
      [...points, ...transformedPoints],
      [...colors, ...newColors],
      [...indices, ...newIndices],
    ];
  }, [[], [], []]);

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  ([
    [aPosition, points],
    [aColor, colors],
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

  gl.viewport(0, 0, canvas.clientWidth, canvas.clientHeight);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

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
    const modelViewMatrix = mat4.multiply(
      mat4.create(),
      modelPositionMatrix,
      modelRotationMatrix,
    )

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(uModelViewMatrix, false, modelViewMatrix);
    
    // gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);  
    //gl.drawElements(gl.LINE_LOOP, indices.length, gl.UNSIGNED_SHORT, 0);  
    requestAnimationFrame(animate);
  }
  animate(0);
};

const COLORS: ReadonlyVec4[] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 1, 0, 1],
  [1, 0, 1, 1],
  [0, 1, 1, 1],
];

function hashPoint(point: ReadonlyVec3) {
  return [...point].reduce((acc, v) => {
    return (acc << 10) | ((v * 32) & 1023);
  }, 0);
}