import { ConvexShape, Shape, convexShapeContainPoint, convexShapeExpand } from "./geometry/shape";
import { Plane, toPlane } from "./geometry/plane";
import { decompose } from "./geometry/decompose";
import { ReadonlyMat4, ReadonlyVec3, mat4, vec3 } from "gl-matrix";
import { loadShader } from "./util/webgl";
import { EPSILON, NORMAL_Z } from "./geometry/constants";
import { Face } from "./geometry/face";

type MaybeInvertedFace = Face & {
  inverted: number,
};

const TEXTURE_SCALE = 128;
const BASE_LINE_WIDTH = 1;
const BORDER_EXPAND = 0.01;

const A_VERTEX_POSITION = "aVertexPosition";
const A_VERTEX_COLOR = "aVertexColor";
const A_VERTEX_TEXTURE_COORD = 'aVertexTextureCoord';

const U_MODEL_VIEW_MATRIX = "uModelViewMatrix";
const U_MODEL_ROTATION_MATRIX = 'uModelRotationMatrix';
const U_PROJECTION_MATRIX = "uProjectionMatrix";
const U_TEXTURE = 'uTexture';

const V_COLOR = 'vColor';
const V_POSITION = 'vPosition';
const V_TEXTURE_COORD = 'vTextureCoord';

const O_COLOR = "oColor";

const VERTEX_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${A_VERTEX_POSITION};
  in vec4 ${A_VERTEX_COLOR};
  in vec2 ${A_VERTEX_TEXTURE_COORD};
  uniform mat4 ${U_MODEL_VIEW_MATRIX};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  uniform mat4 ${U_PROJECTION_MATRIX};
  out vec4 ${V_COLOR};
  out vec3 ${V_POSITION};
  out vec2 ${V_TEXTURE_COORD};

  void main(void) {
    gl_Position = ${U_PROJECTION_MATRIX} * ${U_MODEL_VIEW_MATRIX} * ${U_MODEL_ROTATION_MATRIX} * ${A_VERTEX_POSITION};
    ${V_COLOR} = ${A_VERTEX_COLOR};
    ${V_POSITION} = ${A_VERTEX_POSITION}.xyz;
    ${V_TEXTURE_COORD} = ${A_VERTEX_TEXTURE_COORD};
  }
`;

const FRAGMENT_SHADER = `#version 300 es
  precision lowp float;

  in vec4 ${V_COLOR};
  in vec3 ${V_POSITION};
  in vec2 ${V_TEXTURE_COORD};
  uniform sampler2D ${U_TEXTURE};
  uniform mat4 ${U_MODEL_ROTATION_MATRIX};
  out vec4 ${O_COLOR};

  void main(void) {
    vec4 p = texture(${U_TEXTURE}, ${V_TEXTURE_COORD});
    vec3 n = (p.xyz - .5) * 2.; 
    ${O_COLOR} = vec4(
      mix(vec3(1.), ${V_COLOR}.rgb * (dot(normalize(n), vec3(.2, .7, -.5)) + 1.)/2., p.a),
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
    toPlane(1, 0, 0, .2),
    toPlane(-1, 0, 0, .2),
    toPlane(0, 1, 0, 1.8),
    toPlane(0, -1, 0, .8),
    toPlane(0, 0, 1, 1),
    //toPlane(0, 0, 1, 2),
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

  const segmentsz = 6;
  const segmentsy = 3;
  const ry = .3;
  const rz = 1;
  const hole = ry * 3;

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
      const az = Math.PI * 2 * j / arrz.length;
      const cosz = Math.cos(az);
      const sinz = Math.sin(az);
      return [
        [-cosz * cosy, -sinz * cosy, -siny],
        [cosz * (cosy * ry - hole), sinz * (cosy * ry - hole), siny * ry],
      ];
    }).concat([
      toPlane(0, 0, -1, 2),
      toPlane(0, 0, 1, 2),  
    ]);
});
  
  const shapes: readonly Shape[] = ([
    // [shape5, [shape6]],
    // [shape1, [shape2, shape3, shape4, shape6]],
    [disc, columns],
    // [disc, [column]],
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
          return hashPoint(n) != hashPoint(p);
        })).filter(polygon => polygon.length > 2),
        rotateToWorldCoordinates,
        toWorldCoordinates,
        inverted: i,
      };
    }).filter(shape => shape.polygons.length);
  }).flat(1);
  
  console.log(faces.map(({ polygons }) => polygons.map(polygon => polygon.map(point => [...point]))));
  console.log(faces.map(({ polygons, toWorldCoordinates }) => (
    polygons.map(polygon => {
      return polygon.map(point => {
        const worldPoint = vec3.transformMat4(vec3.create(), point, toWorldCoordinates);
        const hash = hashPoint(worldPoint); 
        return [...worldPoint, hash];
      });
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
    aTextureCoord,
  ] = [
    A_VERTEX_POSITION,
    A_VERTEX_COLOR,
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

  const [points, colors, textureCoords, indices] = faces.reduce<[
    [number, number, number][],
    [number, number, number][],
    [number, number][],
    number[],
  ]>(
    ([points, colors, textureCoords, indices], face) => {
      const { polygons, toWorldCoordinates, rotateToWorldCoordinates, inverted = 0 } = face;
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
      const normal = vec3.transformMat4(vec3.create(), NORMAL_Z, rotateToWorldCoordinates);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgba(${[...normal].map(v => (v + 1) * 127).join()},${(1 - inverted) * 255})`;
      ctx.fillRect(originalTextureX, textureY, width, height);
      ctx.globalCompositeOperation = 'destination-out';
      polygons.forEach(polygon => {
        polygon.forEach((p, i) => {
          const n = polygon[(i + 1)%polygon.length];
          const adjacentFace = pointAdjacency
              .get(hashPoint(n, toWorldCoordinates))
              .get(hashPoint(p, toWorldCoordinates));
          const normal = vec3.transformMat4(
            vec3.create(), NORMAL_Z, rotateToWorldCoordinates,
          );
          const adjacentNormal = vec3.transformMat4(
            vec3.create(), NORMAL_Z, adjacentFace.rotateToWorldCoordinates,
          );
          const lineWidth = 1 - Math.abs(vec3.dot(normal, adjacentNormal));
          if (lineWidth > EPSILON || true) {
            ctx.lineWidth = BASE_LINE_WIDTH;
            ctx.beginPath();
            [p, n].forEach(([px, py]) => {
              ctx.lineTo(
                originalTextureX + (px - minX) * TEXTURE_SCALE + BASE_LINE_WIDTH, 
                textureY + (py - minY) * TEXTURE_SCALE + BASE_LINE_WIDTH,
              );  
            });
            ctx.stroke();    
          }
        });
      });
        
      const hashesToPoints = polygonPoints.reduce((acc, point) => {
        const pointHash = hashPoint(point);
        return acc.set(pointHash, [...point] as any);
      }, new Map<number, [number, number, number]>());
      const uniquePoints = [...hashesToPoints.values()];

      const newTextureCoords = uniquePoints.map<[number, number]>(([px, py]) => {
        const x = ((px - minX) * TEXTURE_SCALE + BASE_LINE_WIDTH + originalTextureX)/canvas2d.width;
        const y = ((py - minY) * TEXTURE_SCALE + BASE_LINE_WIDTH + textureY)/canvas2d.height;
        return [x, y];
      });

      const outsideColor: [number, number, number] = [.4, .4, .6];
      const insideColor: [number, number, number] = [.1, .1, .1];
      const newColors = uniquePoints.map(point => {
        const worldPoint = vec3.transformMat4(vec3.create(), point, toWorldCoordinates);
        const inside = shapes.some(([addition]) => convexShapeContainPoint(addition, worldPoint));
        return inside ? insideColor : outsideColor;
      });

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
        [...colors, ...newColors],
        [...textureCoords, ...newTextureCoords],
        [...indices, ...newIndices],
      ];
    },
    [[], [], [], []],
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

function hashPoint(point: ReadonlyVec3, transform?: ReadonlyMat4) {
  const transformed = transform
      ? vec3.transformMat4(vec3.create(), point, transform)
      : point;
  return [...transformed].reduce((acc, v) => {
    return (acc << 10) | (Math.round((v+4) * 128) & 1023);
  }, 0);
}