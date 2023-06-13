import { ConvexShape, Shape, convexShapeExpand } from "./geometry/shape";
import { toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_Z } from "./geometry/constants";
import { Face } from "./geometry/face";

const TEXTURE_SCALE = 256;
const BASE_LINE_WIDTH = 16;


const A_VERTEX_POSITION = "aVertexPosition";
const A_VERTEX_COLOR = "aVertexColor";
const A_VERTEX_NORMAL = 'aVertexNormal';
const A_VERTEX_TEXTURE_COORD = 'aVertexTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelViewMatrix";
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
  in vec4 ${A_VERTEX_NORMAL};
  in vec4 ${A_VERTEX_COLOR};
  in vec2 ${A_VERTEX_TEXTURE_COORD};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_COLOR};
  out vec3 ${V_POSITION};
  out vec3 ${V_NORMAL};
  out vec2 ${V_TEXTURE_COORD};

  void main(void) {
    gl_Position = ${U_PROJECTION_MATRIX} * ${U_MODEL_VIEW_MATRIX} * ${A_VERTEX_POSITION};
    ${V_COLOR} = ${A_VERTEX_COLOR};
    ${V_POSITION} = ${A_VERTEX_POSITION}.xyz;
    ${V_NORMAL} = (${U_MODEL_VIEW_MATRIX} * ${A_VERTEX_NORMAL} - ${U_MODEL_VIEW_MATRIX} * vec4(0., 0., 0., 1.)).xyz;
    ${V_TEXTURE_COORD} = ${A_VERTEX_TEXTURE_COORD};
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_COLOR};
  in vec3 ${V_POSITION};
  in vec3 ${V_NORMAL};
  in vec2 ${V_TEXTURE_COORD};
  uniform sampler2D ${U_TEXTURE};
  out vec4 ${O_COLOR};

  void main(void) {
    ${O_COLOR} = vec4(
      mix(${V_COLOR}.rgb, vec3(1.), texture(${U_TEXTURE}, ${V_TEXTURE_COORD}).a),
      1.
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
    toPlane(0, -1, 0, .8),
    toPlane(0, 0, 1, 1),
    toPlane(0, 0, -1, -.6),
  ];

  // chimney hole
  const shape6: ConvexShape = [
    toPlane(1, 0, 0, .1),
    toPlane(-1, 0, 0, .1),
    toPlane(0, 1, 0, 1.9),
    toPlane(0, -1, 0, 1.1),
    toPlane(0, 0, 1, .9),
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

  let faces = decompose(shapes).filter(shape => shape.polygons.length);
  
  console.log(faces.map(({ polygons }) => polygons.map(polygon => polygon.map(point => [...point]))));
  console.log(faces.map(({ polygons, toWorldCoordinates }) => (
    polygons.map(polygon => {
      return polygon.map(point => (
        [...vec3.transformMat4(vec3.create(), point, toWorldCoordinates)]
      ));
    })
  )));

  const canvas2d = document.getElementById("canvas2d") as HTMLCanvasElement;
  canvas2d.width = 4096;
  canvas2d.height = 4096;
  const ctx = canvas2d.getContext('2d');

  
  const canvas3d = document.getElementById("canvas3d") as HTMLCanvasElement;
  canvas3d.width = canvas3d.clientWidth;
  canvas3d.height = canvas3d.clientHeight;
  const gl = canvas3d.getContext("webgl2");
  
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
    uProjectionMatrix,
  ] = [
    U_MODEL_VIEW_MATRIX,
    U_PROJECTION_MATRIX,
  ].map(
    uniform => gl.getUniformLocation(program, uniform)
  );

  const pointAdjacency = faces.reduce((acc, face) => {
    const { polygons, toWorldCoordinates } = face;
    return polygons.reduce((acc, polygon) => {
      return polygon.reduce((acc, currentPoint, i) => {
        const currentHash = hashPoint(currentPoint, toWorldCoordinates);
        const nextPoint = polygon[(i + 1)%polygon.length];
        const nextHash = hashPoint(nextPoint, toWorldCoordinates);
        return acc.set(
          currentHash,
          (acc.get(currentHash) || new Map()).set(nextHash, face),
        );
      }, acc);
    }, acc);
  }, new Map<number, Map<number, Face>>());
  faces = faces.filter(face => {
    const { polygons, toWorldCoordinates } = face;
    const currentHash = hashPoint(polygons[0][0], toWorldCoordinates);
    const nextHash = hashPoint(polygons[0][1], toWorldCoordinates);
    return pointAdjacency.get(currentHash)?.get(nextHash) == face;
  })

  let textureX = 0;
  let textureY = 0;
  let textureMaxHeight = 0;
  //ctx.strokeStyle = 'white';
  ctx.lineCap = 'round';

  const [points, normals, colors, textureCoords, indices] = faces.reduce<[
    [number, number, number][],
    [number, number, number][],
    [number, number, number][],
    [number, number][],
    number[],
  ]>(
    ([points, normals, colors, textureCoords, indices], face) => {
      const { polygons, toWorldCoordinates, rotateToWorldCoordinates } = face;
      //ctx.fillStyle = `rgb(${Math.random() * 125 | 0}, ${Math.random() * 125 | 0}, ${Math.random() * 125 | 0})`;

      const polygonPoints = polygons.flat(1);
      const [[minX, minY], [maxX, maxY]] = polygonPoints.reduce<[[number, number, number], [number, number, number]]>(([min, max], point) => {
        const newMin = min.map((v, i) => Math.min(v, point[i])) as [number, number, number];
        const newMax = max.map((v, i) => Math.max(v, point[i])) as [number, number, number];
        return [newMin, newMax];
      }, [
        [...polygonPoints[0]] as [number, number, number],
        [...polygonPoints[0] as [number, number, number]],
      ]);

      const width = (maxX - minX) * TEXTURE_SCALE + BASE_LINE_WIDTH * 2;
      const height = (maxY - minY) * TEXTURE_SCALE + BASE_LINE_WIDTH * 2;
      
      if (textureX + width > ctx.canvas.width) {
        textureX = 0;
        textureY += textureMaxHeight;
        textureMaxHeight = 0;
      }
      const originalTextureX = textureX;
      textureX += width;
      textureMaxHeight = Math.max(height, textureMaxHeight);
      //ctx.fillRect(originalTextureX, textureY, width, height);
      polygons.forEach(polygon => {
        polygon.forEach((p, i) => {
          const n = polygon[(i + 1)%polygon.length];
          const adjacentFace = pointAdjacency
              .get(hashPoint(n, toWorldCoordinates))
              ?.get(hashPoint(p, toWorldCoordinates));
          if (adjacentFace != face && adjacentFace) {
            const normal = vec3.transformMat4(
              vec3.create(), NORMAL_Z, rotateToWorldCoordinates,
            );
            const adjacentNormal = vec3.transformMat4(
              vec3.create(), NORMAL_Z, adjacentFace.rotateToWorldCoordinates,
            );
            const lineWidth = 1 - Math.abs(vec3.dot(normal, adjacentNormal));
            if (lineWidth > EPSILON) {
              ctx.lineWidth = lineWidth * BASE_LINE_WIDTH;
              //ctx.lineWidth = BASE_LINE_WIDTH;
              ctx.beginPath();
              [p, n].forEach(([px, py]) => {
                ctx.lineTo(
                  originalTextureX + (px - minX) * TEXTURE_SCALE + BASE_LINE_WIDTH, 
                  textureY + (py - minY) * TEXTURE_SCALE + BASE_LINE_WIDTH,
                );  
              });
              ctx.stroke();    
            } else {
              console.log(lineWidth);
            }
          }
        });
      });
        
      const hashesToPoints = polygonPoints.reduce((acc, point) => {
        const pointHash = hashPoint(point);
        return acc.set(pointHash, [...point] as any);
      }, new Map<number, [number, number, number]>());
      const uniquePoints = [...hashesToPoints.values()];

      const normal: [number, number, number] = [...vec3.subtract(
        vec3.create(),
        vec3.transformMat4(vec3.create(), [0, 0, 1], toWorldCoordinates),
        vec3.transformMat4(vec3.create(), [0, 0, 0], toWorldCoordinates),
      )] as any;
      const newNormals = uniquePoints.map(() => normal);

      const newTextureCoords = uniquePoints.map<[number, number]>(([px, py]) => {
        const x = ((px - minX) * TEXTURE_SCALE + BASE_LINE_WIDTH + originalTextureX)/canvas2d.width;
        const y = ((py - minY) * TEXTURE_SCALE + BASE_LINE_WIDTH + textureY)/canvas2d.height;
        return [x, y];
      });

      const color: [number, number, number] = [.2, .2, .3];
      const newColors = uniquePoints.map(() => color);

      const newIndices = polygons.reduce<number[]>((indices, polygon, i) => {
        const polygonIndices = polygon.map(point => {
          const hash = hashPoint(point);
          const uniquePoint = hashesToPoints.get(hash);
          return uniquePoints.indexOf(uniquePoint);
        });
        const originIndex = polygonIndices[0];
        const newIndices = polygonIndices.slice(1, -1).map((currentIndex, i) => {
          // + 2 because the offset is from 1
          const nextIndex = polygonIndices[i + 2];
          return [originIndex, currentIndex, nextIndex];
        }).flat(1).map(v => v + points.length);
        return [...indices, ...newIndices];
      }, []);
      const transformedPoints = uniquePoints.map<[number, number, number]>(point => {
        return [...vec3.transformMat4(vec3.create(), point, toWorldCoordinates)] as any;      
      });
      return [
        [...points, ...transformedPoints],
        [...normals, ...newNormals],
        [...colors, ...newColors],
        [...textureCoords, ...newTextureCoords],
        [...indices, ...newIndices],
      ];
    },
    [[], [], [], [], []],
  );

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
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

function hashPoint(point: ReadonlyVec3, transform?: ReadonlyMat4) {
  const transformed = transform
      ? vec3.transformMat4(vec3.create(), point, transform)
      : point;
  return [...transformed].reduce((acc, v) => {
    return (acc << 10) | (Math.round((v+8) * 64) & 1023);
  }, 0);
}