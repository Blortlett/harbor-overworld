import { avatarMesh, coatIndex, COATS, nameplate } from './avatar';
import type { Avatar } from './presence';
import {
  ground,
  makeNoticeFaces,
  makeStations,
  makeTerrain,
  NOTICE,
  NOTICE_VERTICES,
  SPAWN,
  stationBlocks,
  STATIONS,
  type Obstacle,
} from './terrain';

export type View = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
};
export const EYE_HEIGHT = 1.64;
export type FallingPost = {
  id: string;
  x: number;
  y: number;
  z: number;
  start: number;
  paper: HTMLCanvasElement;
};

const sky = `
  vec3 horizon(vec3 ray) {
    float light = pow(max(0.0, dot(normalize(vec3(ray.x, 0.0, ray.z)), vec3(.58, 0.0, -.815))), 4.0);
    return mix(vec3(.57,.63,.60), vec3(.99,.67,.40), .28 + light * .72);
  }
`;

const skyVertex = `
  attribute vec2 pos;
  varying vec2 screen;
  void main() { screen = pos; gl_Position = vec4(pos, .9999, 1.0); }
`;
const skyFragment = `
  precision highp float;
  varying vec2 screen;
  uniform vec3 right, up, forward;
  uniform vec2 scale;
  ${sky}
  float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main() {
    vec3 ray = normalize(forward + right * screen.x / scale.x + up * screen.y / scale.y);
    float h = max(0.0, ray.y);
    vec3 warm = horizon(ray);
    vec3 color = mix(warm, vec3(.155,.30,.33), smoothstep(0.0,.70,h));
    color += vec3(.12,.025,.02) * exp(-abs(h-.15) * 6.0);
    vec3 sun = normalize(vec3(.52,.159,-.84));
    vec2 sunPos = vec2(dot(ray-sun,vec3(.85,0.0,.53)), ray.y-sun.y);
    float distance = length(sunPos);
    color += vec3(.19,.125,.055) * exp(-distance*7.0);
    if (dot(ray,sun) > .0) {
      vec2 sunPixel = floor(sunPos * 183.0 + .5) / 183.0;
      color = mix(color, vec3(1.0,.91,.66), step(length(sunPixel), .052));
    }
    if (h > .018) {
      vec2 cloud = floor(ray.xz / h * vec2(17.0,44.0));
      vec2 cell = floor(cloud / vec2(24.0,7.0));
      vec2 detail = mod(cloud,vec2(24.0,7.0));
      float seed = hash(cell);
      float cloudlet = step(abs(detail.x - (7.0 + seed * 8.0)), (9.0 - detail.y * 1.15) * seed);
      float opacity = cloudlet * step(.58, seed) * smoothstep(.03,.095,h) * (1.0 - smoothstep(.43,.76,h));
      vec3 shade = mix(vec3(.53,.49,.46), vec3(1.0,.75,.53), 1.0 - detail.y / 7.0);
      color = mix(color, shade, opacity * .47);
    }
    gl_FragColor = vec4(color,1.0);
  }
`;

const worldVertex = `
  attribute vec3 point, rgb;
  attribute float surface;
  uniform vec3 eye, right, up, forward;
  uniform vec2 scale;
  varying vec3 color, position;
  varying float material;
  #ifdef AVATAR
    uniform vec3 avatarOrigin;
    uniform vec2 avatarRotation;
    uniform float avatarStep;
  #endif
  void main() {
    vec3 p = point;
    #ifdef AVATAR
      if (surface >= 4.0) {
        float leg = avatarStep * (surface == 4.0 ? 1.0 : -1.0) * max(0.0, 1.0 - p.y / .6);
        p.z += leg;
        p.y += max(0.0, leg * .42);
      }
      p.xz = vec2(avatarRotation.x * p.x - avatarRotation.y * p.z,
                  avatarRotation.y * p.x + avatarRotation.x * p.z);
      p += avatarOrigin;
    #endif
    vec3 relative = p - eye;
    float depth = dot(relative, forward);
    gl_Position = vec4(dot(relative,right)*scale.x, dot(relative,up)*scale.y, depth * 1.00045 - .101, depth);
    color = rgb;
    position = p;
    material = surface < 4.0 ? surface : 0.0;
  }
`;
const worldFragment = `
  precision highp float;
  uniform vec3 eye;
  uniform float time;
  varying vec3 color, position;
  varying float material;
  ${sky}
  float hash(vec3 p) { return fract(sin(dot(p,vec3(41.43,37.93,69.15)))*43758.5453); }
  void main() {
    vec3 relative = position-eye;
    float distance = length(relative);
    vec3 ray = relative/max(.001,distance);
    vec3 fog = mix(horizon(ray),vec3(.38,.53,.52),.42);
    float mist = 1.0 - exp(-distance * .0105);
    vec3 paint = color;
    if (material == 1.0) {
      vec2 tile = floor(position.xz * 9.0) / 9.0;
      vec2 ripple = vec2(floor(tile.x*1.28 + sin(tile.y*.54)*1.72), floor(tile.y*2.9+time*.67));
      float fleck = hash(vec3(ripple,0.0));
      float band = fract((tile.y + sin(tile.x*.85)*.12 + time*.22)*3.6);
      float glint = step(.77,fleck)*step(.79,band);
      float sunPath = exp(-abs(ray.x-.53)*7.0) * smoothstep(-.5,-.03,ray.y);
      paint = mix(vec3(.20,.36,.36), vec3(.50,.56,.46), sunPath * .78);
      paint += glint*mix(vec3(.10,.16,.14), vec3(.43,.33,.13), sunPath);
      paint += .049 * step(.74,band);
      mist = 1.0 - exp(-distance * .0075);
    } else if (material != 3.0) {
      vec3 pixel = floor(position * 12.0 + .001);
      paint *= .88 + hash(pixel) * .23;
      if (material == 2.0) {
        float layer = fract(position.y);
        paint *= (.78 + step(.09,layer)*.22) * (1.0 + step(.9,layer)*.14);
      }
    } else {
      mist *= .45;
      paint *= .99 + .035 * sin(time*2.8 + position.x + position.z);
    }
    gl_FragColor = vec4(mix(paint,fog,mist*.84),1.0);
  }
`;

const noticeVertex = `
  attribute vec3 point;
  attribute vec2 paperUv;
  uniform vec3 eye, right, up, forward;
  uniform vec2 scale;
  varying vec2 uv;
  varying vec3 relative;
  void main() {
    relative = point - eye;
    float depth = dot(relative, forward);
    gl_Position = vec4(dot(relative,right)*scale.x, dot(relative,up)*scale.y, depth * 1.00045 - .101, depth);
    uv = paperUv;
  }
`;

const noticeFragment = `
  precision highp float;
  uniform sampler2D paper;
  varying vec2 uv;
  varying vec3 relative;
  ${sky}
  void main() {
    float distance = length(relative);
    vec3 fog = mix(horizon(relative), vec3(.38,.53,.52), .42);
    float mist = (1.0 - exp(-distance * .0105)) * .84;
    vec3 ink = texture2D(paper, uv).rgb;
    gl_FragColor = vec4(mix(ink, fog, mist), 1.0);
  }
`;

function compile(gl: WebGLRenderingContext, vertex: string, fragment: string) {
  function shader(type: number, source: string) {
    const result = gl.createShader(type);
    if (!result) throw new Error('Could not initialize WebGL.');
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      throw new Error(
        gl.getShaderInfoLog(result) ?? 'Shader compilation failed.',
      );
    }
    return result;
  }
  const program = gl.createProgram();
  if (!program) throw new Error('Could not initialize WebGL.');
  const vs = shader(gl.VERTEX_SHADER, vertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Shader linking failed.');
  }
  return program;
}

export function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) throw new Error('WebGL is unavailable in this browser.');
  const context = gl;
  const skyProgram = compile(gl, skyVertex, skyFragment);
  const worldProgram = compile(gl, worldVertex, worldFragment);
  const avatarProgram = compile(
    gl,
    `#define AVATAR\n${worldVertex}`,
    worldFragment,
  );
  const noticeProgram = compile(gl, noticeVertex, noticeFragment);
  const { vertices, obstacles } = makeTerrain();
  const screen = gl.createBuffer();
  const terrain = gl.createBuffer();
  const stations = gl.createBuffer();
  const noticeFaces = gl.createBuffer();
  const nameplateFace = gl.createBuffer();
  const dropTextures = new Map<string, WebGLTexture>();
  const nameTextures = new Map<
    string,
    { name: string; texture: WebGLTexture; halfWidth: number }
  >();
  const avatarMeshes = COATS.map((_, index) => {
    const data = avatarMesh(index);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buffer, count: data.length / 7 };
  });
  const noticeTextures: WebGLTexture[] = [];
  let stationVertices = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, screen);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, terrain);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enable(gl.CULL_FACE);

  function uniformLocations(program: WebGLProgram) {
    return {
      eye: context.getUniformLocation(program, 'eye'),
      right: context.getUniformLocation(program, 'right'),
      up: context.getUniformLocation(program, 'up'),
      forward: context.getUniformLocation(program, 'forward'),
      scale: context.getUniformLocation(program, 'scale'),
    };
  }
  const skyUniforms = uniformLocations(skyProgram);
  const worldUniforms = uniformLocations(worldProgram);
  const avatarUniforms = uniformLocations(avatarProgram);
  const avatarOrigin = gl.getUniformLocation(avatarProgram, 'avatarOrigin');
  const avatarRotation = gl.getUniformLocation(avatarProgram, 'avatarRotation');
  const avatarStep = gl.getUniformLocation(avatarProgram, 'avatarStep');
  const avatarTime = gl.getUniformLocation(avatarProgram, 'time');
  const noticeUniforms = uniformLocations(noticeProgram);
  const timeUniform = gl.getUniformLocation(worldProgram, 'time');
  const screenPosition = gl.getAttribLocation(skyProgram, 'pos');
  function meshAttributes(program: WebGLProgram) {
    return [
      context.getAttribLocation(program, 'point'),
      context.getAttribLocation(program, 'rgb'),
      context.getAttribLocation(program, 'surface'),
    ] as const;
  }
  const worldAttributes = meshAttributes(worldProgram);
  const avatarAttributes = meshAttributes(avatarProgram);
  const noticePoint = gl.getAttribLocation(noticeProgram, 'point');
  const paperUv = gl.getAttribLocation(noticeProgram, 'paperUv');

  function uploadTexture(texture: WebGLTexture, image: HTMLCanvasElement) {
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      context.RGBA,
      context.UNSIGNED_BYTE,
      image,
    );
  }

  function createTexture() {
    const texture = context.createTexture();
    if (!texture) return null;
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MIN_FILTER,
      context.LINEAR,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_MAG_FILTER,
      context.LINEAR,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_S,
      context.CLAMP_TO_EDGE,
    );
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_WRAP_T,
      context.CLAMP_TO_EDGE,
    );
    return texture;
  }

  function setNotice(index: number, image: HTMLCanvasElement) {
    const texture = noticeTextures[index];
    if (texture) uploadTexture(texture, image);
  }

  function nameTexture(key: string, id: number, name: string) {
    const cached = nameTextures.get(key);
    if (cached?.name === name) return cached;
    const image = nameplate(id, name);
    const texture = image && (cached?.texture ?? createTexture());
    if (!image || !texture) return undefined;
    uploadTexture(texture, image);
    const label = { name, texture, halfWidth: (image.width * 0.45) / 128 };
    nameTextures.set(key, label);
    return label;
  }

  return {
    obstacles,
    setNotice,
    setStations(pages: readonly HTMLCanvasElement[]) {
      const mesh = makeStations(pages.length);
      stationVertices = mesh.length / 7;
      context.bindBuffer(context.ARRAY_BUFFER, stations);
      context.bufferData(context.ARRAY_BUFFER, mesh, context.STATIC_DRAW);
      context.bindBuffer(context.ARRAY_BUFFER, noticeFaces);
      context.bufferData(
        context.ARRAY_BUFFER,
        makeNoticeFaces(pages.length),
        context.STATIC_DRAW,
      );
      while (noticeTextures.length > pages.length)
        context.deleteTexture(noticeTextures.pop() ?? null);
      for (const [index, page] of pages.entries()) {
        if (!noticeTextures[index]) {
          const texture = createTexture();
          if (!texture) break;
          noticeTextures.push(texture);
        }
        setNotice(index, page);
      }
    },
    draw(
      view: View,
      time: number,
      avatars: readonly Avatar[],
      drops: readonly FallingPost[],
    ) {
      const gl = context;
      const height = Math.max(1, Math.min(canvas.clientHeight, 660));
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      const width = Math.max(1, Math.round(height * aspect));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      const sy = Math.sin(view.yaw);
      const cy = Math.cos(view.yaw);
      const sp = Math.sin(view.pitch);
      const cp = Math.cos(view.pitch);
      const verticalScale = 1.54;
      function camera(locations: ReturnType<typeof uniformLocations>) {
        gl.uniform3f(locations.eye, view.x, view.y, view.z);
        gl.uniform3f(locations.right, cy, 0, sy);
        gl.uniform3f(locations.up, -sy * sp, cp, cy * sp);
        gl.uniform3f(locations.forward, sy * cp, sp, -cy * cp);
        gl.uniform2f(locations.scale, verticalScale / aspect, verticalScale);
      }
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(skyProgram);
      camera(skyUniforms);
      gl.bindBuffer(gl.ARRAY_BUFFER, screen);
      gl.enableVertexAttribArray(screenPosition);
      gl.vertexAttribPointer(screenPosition, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disableVertexAttribArray(screenPosition);

      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(worldProgram);
      camera(worldUniforms);
      gl.uniform1f(timeUniform, time);
      function mesh(
        buffer: WebGLBuffer | null,
        count: number,
        [point, rgb, surface]: typeof worldAttributes,
      ) {
        if (!count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(point, 3, gl.FLOAT, false, 28, 0);
        gl.vertexAttribPointer(rgb, 3, gl.FLOAT, false, 28, 12);
        gl.vertexAttribPointer(surface, 1, gl.FLOAT, false, 28, 24);
        gl.drawArrays(gl.TRIANGLES, 0, count);
      }
      for (const attr of worldAttributes) gl.enableVertexAttribArray(attr);
      mesh(terrain, vertices.length / 7, worldAttributes);
      mesh(stations, stationVertices, worldAttributes);
      for (const attr of worldAttributes) gl.disableVertexAttribArray(attr);

      const visible = avatars.filter(
        ({ x, z }) => Math.hypot(x - view.x, z - view.z) >= 0.55,
      );
      if (visible.length) {
        gl.useProgram(avatarProgram);
        camera(avatarUniforms);
        gl.uniform1f(avatarTime, time);
        for (const attr of avatarAttributes) gl.enableVertexAttribArray(attr);
        for (const avatar of visible) {
          const model = avatarMeshes[coatIndex(avatar.id)];
          gl.uniform3f(avatarOrigin, avatar.x, avatar.y, avatar.z);
          gl.uniform2f(
            avatarRotation,
            Math.cos(avatar.yaw),
            Math.sin(avatar.yaw),
          );
          gl.uniform1f(
            avatarStep,
            avatar.walking ? Math.sin(time * 14 + avatar.id) * 0.18 : 0,
          );
          mesh(model.buffer, model.count, avatarAttributes);
        }
        for (const attr of avatarAttributes) gl.disableVertexAttribArray(attr);
      }

      const activeNames = new Set<string>();
      for (const avatar of avatars) {
        activeNames.add(String(avatar.id));
        if (avatar.chat?.text) activeNames.add(`chat:${avatar.id}`);
      }
      for (const [key, { texture }] of nameTextures) {
        if (!activeNames.has(key)) {
          gl.deleteTexture(texture);
          nameTextures.delete(key);
        }
      }
      const activeDrops = new Set(drops.map((drop) => drop.id));
      for (const [key, texture] of dropTextures) {
        if (!activeDrops.has(key)) {
          gl.deleteTexture(texture);
          dropTextures.delete(key);
        }
      }
      const nearby = visible.filter(
        ({ x, z }) => Math.hypot(x - view.x, z - view.z) < 17,
      );
      if (noticeTextures.length || nearby.length || drops.length) {
        gl.useProgram(noticeProgram);
        camera(noticeUniforms);
        gl.bindBuffer(gl.ARRAY_BUFFER, noticeFaces);
        gl.enableVertexAttribArray(noticePoint);
        gl.enableVertexAttribArray(paperUv);
        gl.vertexAttribPointer(noticePoint, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(paperUv, 2, gl.FLOAT, false, 20, 12);
        for (const [index, texture] of noticeTextures.entries()) {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.drawArrays(gl.TRIANGLES, index * NOTICE_VERTICES, NOTICE_VERTICES);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, nameplateFace);
        gl.vertexAttribPointer(noticePoint, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(paperUv, 2, gl.FLOAT, false, 20, 12);

        function billboard(
          texture: WebGLTexture,
          x: number,
          z: number,
          bottom: number,
          halfWidth: number,
          height: number,
        ) {
          const leftX = x - cy * halfWidth;
          const leftZ = z - sy * halfWidth;
          const rightX = x + cy * halfWidth;
          const rightZ = z + sy * halfWidth;
          const top = bottom + height;
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([
              leftX,
              bottom,
              leftZ,
              0,
              1,
              rightX,
              bottom,
              rightZ,
              1,
              1,
              rightX,
              top,
              rightZ,
              1,
              0,
              leftX,
              bottom,
              leftZ,
              0,
              1,
              rightX,
              top,
              rightZ,
              1,
              0,
              leftX,
              top,
              leftZ,
              0,
              0,
            ]),
            gl.DYNAMIC_DRAW,
          );
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        for (const avatar of nearby) {
          const label = nameTexture(
            String(avatar.id),
            avatar.id,
            avatar.name ?? `Guest ${avatar.id}`,
          );
          if (label)
            billboard(
              label.texture,
              avatar.x,
              avatar.z,
              avatar.y + 1.63,
              label.halfWidth,
              0.225,
            );
          if (avatar.chat?.text) {
            const chat = nameTexture(
              `chat:${avatar.id}`,
              avatar.id,
              avatar.chat.text,
            );
            if (chat)
              billboard(
                chat.texture,
                avatar.x,
                avatar.z,
                avatar.y + 1.93,
                Math.max(chat.halfWidth, 0.72),
                0.29,
              );
          }
        }
        for (const drop of drops) {
          if (time < drop.start) continue;
          let texture = dropTextures.get(drop.id);
          if (!texture) {
            texture = createTexture() ?? undefined;
            if (!texture) continue;
            uploadTexture(texture, drop.paper);
            dropTextures.set(drop.id, texture);
          }
          const progress = Math.min(1, (time - drop.start) / 1.7);
          const elevation = 10 * (1 - progress * progress);
          const height = drop.paper.height > 32 ? 1.45 : 0.28;
          billboard(
            texture,
            drop.x,
            drop.z,
            drop.y + 0.12 + elevation,
            1.06,
            height,
          );
        }
        gl.disableVertexAttribArray(noticePoint);
        gl.disableVertexAttribArray(paperUv);
      }
    },
  };
}

export function spawnView(slot = 0): View {
  const rows = [SPAWN.z, 14.2, 20.7, 11.5, 23.7, 26.7, 29.1, 32.3];
  const x = SPAWN.x + [0, -1.8, 1.8][Math.floor(slot / rows.length)];
  const z = rows[slot % rows.length];
  return { x, y: ground(x, z) + EYE_HEIGHT, z, yaw: 0.075, pitch: -0.075 };
}

export function walk(
  view: View,
  keys: ReadonlySet<string>,
  dt: number,
  obstacles: readonly Obstacle[],
  stations: number,
) {
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const sideways = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  if (forward || sideways) {
    const speed = (4.7 * dt) / Math.hypot(forward, sideways);
    const dx =
      (Math.sin(view.yaw) * forward + Math.cos(view.yaw) * sideways) * speed;
    const dz =
      (-Math.cos(view.yaw) * forward + Math.sin(view.yaw) * sideways) * speed;
    function clear(x: number, z: number) {
      const current = ground(view.x, view.z);
      const next = ground(x, z);
      if (next < 2 || next > current + 1 || next < current - 2) return false;
      for (const [ox, oz] of [
        [0.18, 0],
        [-0.18, 0],
        [0, 0.18],
        [0, -0.18],
      ]) {
        if (ground(x + ox, z + oz) > current + 1) return false;
      }
      if (
        obstacles.some(
          (obstacle) =>
            Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + 0.17,
        )
      )
        return false;
      return !STATIONS.slice(0, stations).some((station) =>
        stationBlocks(station, x, z),
      );
    }
    if (clear(view.x + dx, view.z)) view.x += dx;
    if (clear(view.x, view.z + dz)) view.z += dz;
  }
  const target = ground(view.x, view.z) + EYE_HEIGHT;
  view.y += (target - view.y) * Math.min(1, dt * 11);
}

export function facingNotice(view: View, count: number) {
  let nearest = -1;
  let range = 4.0;
  const vx = Math.sin(view.yaw);
  const vz = -Math.cos(view.yaw);
  for (let i = 0; i < count; i++) {
    const [x, z, sideways] = STATIONS[i];
    const distance = Math.hypot(x - view.x, z - view.z);
    if (
      distance >= range ||
      Math.abs(ground(x, z) - ground(view.x, view.z)) > 1
    )
      continue;
    const heading = sideways ? vx : vz;
    if (Math.abs(heading) < 0.15) continue;
    const depth = (sideways ? x - view.x : z - view.z) / heading;
    if (depth <= 0) continue;
    const along = sideways ? view.z + vz * depth - z : view.x + vx * depth - x;
    const y = view.y + Math.tan(view.pitch) * depth - ground(x, z);
    if (
      Math.abs(along) > NOTICE.width / 2 + 0.25 ||
      y < NOTICE.bottom - 0.3 ||
      y > 3.65
    )
      continue;
    nearest = i;
    range = distance;
  }
  return nearest;
}
