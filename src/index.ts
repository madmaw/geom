import { Shape } from "./geometry/shape";
import { toPlane } from "./geometry/plane";
import { decompose, decomposeShapesToFaces } from "./geometry/decompose";
import { ReadonlyVec3, ReadonlyVec4, mat4, vec3, vec4 } from "gl-matrix";
import { loadShader } from "./util/webgl";

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
  const shape1: Shape = {
    value: [
      // toPlane(1, 1, 0, 1),
      // toPlane(1, -1, 0, 1),
      toPlane(1, 0, 0, 1),
      toPlane(-1, 0, 0, 1),
      toPlane(0, 1, 0, 1),
      toPlane(0, -1, 0, 1),
      toPlane(0, 0, 1, 1),
      toPlane(0, 0, -1, 1),
    ],
    subtractions: [],
  };
  const shape2: Shape = {
    subtractions: [],
    value: [
      toPlane(1, 0, 0, .2),
      toPlane(-1, 0, 0, .2),
      toPlane(0, 1, 0, .2),
      toPlane(0, -1, 0, .2),
      toPlane(0, 0, 1, 1.2),
      toPlane(0, 0, -1, -.8),
    ],
  };

  const faces = decomposeShapesToFaces([shape1, shape2]);
  const facesToPolygons = decompose([shape2, shape1]);
  console.log(facesToPolygons);
  console.log(facesToPolygons.map(([face, polygons]) => (
    polygons.map(polygon => {
      return polygon.map(point => (
        vec3.transformMat4(vec3.create(), point, face.transform)
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
  const points = facesToPolygons.map(([face, polygons]) => {
    return polygons.map(polygon => {
      return polygon.map<[number, number, number, number]>(point => {
        return [
          ...vec3.transformMat4(vec3.create(), point, face.transform),
          1,
        ] as any;
      });
    });
  }).flat(2);
  const colors = facesToPolygons.map(([_, polygons], j) => {
    return polygons.map((polygon, i) => {
      const color = COLORS[(j+i) % COLORS.length];
      return polygon.map<[number, number, number, number]>(() => {
        return [...color] as any;
      });
    });
  }).flat(2);
  const [indices] = facesToPolygons.reduce<[number[], number]>((acc, [_, polygons]) => {
    return polygons.reduce(([indices, offset], polygon) => {
      const newIndices = polygon.slice(2).map((_, i) => {
        return [offset, offset + i + 1, offset + i + 2];
      }).flat(1);
      return [[...indices, ...newIndices], offset + polygon.length];
    }, acc);
  }, [[], 0]);


  /*
  const points = faces.map(face => {
    return face.polygon.value.map(point => (
      [...vec3.transformMat4(vec3.create(), point, face.transform), 1]
    ));
  }).flat(1);
  const colors = faces.map((face, i) => {
    const color = COLORS[i % COLORS.length];
    return face.polygon.value.map((_, i) => {
      return [...color]
    });
  }).flat(1);
  const [indices] = faces.reduce<[number[], number]>(([indices, offset], face) => {
    const newIndices = face.polygon.value.slice(2).map((_, i) => {
      return [offset, offset + i + 1, offset + i + 2];
    }).flat(1);
    return [[...indices, ...newIndices], offset + face.polygon.value.length];
  }, [[], 0]);
  */

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

  let rotation = 0;
  function animate() {
    rotation += .01;
    const modelViewMatrix = mat4.rotate(
      mat4.create(),
      modelPositionMatrix,
      rotation,
      [0.2, 1, 0],
    );

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniformMatrix4fv(uModelViewMatrix, false, modelViewMatrix);
    gl.uniformMatrix4fv(uProjectionMatrix, false, projectionMatrix);
    
    // gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);  
    requestAnimationFrame(animate);
  }
  animate();
};

const COLORS: ReadonlyVec4[] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 1, 0, 1],
  [1, 0, 1, 1],
  [0, 1, 1, 1],
];