export const SPAWN = { x: 0.5, z: 17.5 };
export const LIGHTHOUSE = { x: 26.5, z: -37.5 };
export const SOUTH_ARCH = { x: -17.5, z: 44.5 };
export const SOUTH_BEACON = { x: 22.5, z: 65.5 };
export const LANDMARKS = [LIGHTHOUSE, SOUTH_ARCH, SOUTH_BEACON];
export const DOCK = { start: 6, end: 17.3, z: 19.4, halfWidth: 1.1, deck: 2 };
type Station = readonly [x: number, z: number, sideways?: boolean];
export const STATIONS: readonly Station[] = [
  [0.5, 8.5],
  [3.5, -2.5],
  [-7.5, -6.5, true],
  [11.5, -13.5],
  [-13.5, 6.5],
  [4.5, -21.5, true],
  [-14.5, -19.5],
  [17.5, -22.5],
  [-23.5, -9.5, true],
  [3.5, -33.5],
  [22.5, -34.5],
  [-13.5, -33.5],
  [-19.5, 20.5],
  [4.5, 26.5],
  [-4.5, -43.5],
  [-26.5, -28.5],
  [10.5, 42.5, true],
  [-7.5, 45.5],
  [18.5, 61.5],
] as const;

export const NOTICE = { width: 2.34, height: 1.64, bottom: 0.9, face: 0.158 };

const ROUTES = [
  [
    [0.5, 29],
    [0.5, 17.5],
    [0.5, 8.5],
    [1.5, 3],
    [3.5, -2.5],
    [8, -7],
    [11.5, -13.5],
    [17.5, -22.5],
    [22.5, -34.5],
    [26, -38],
  ],
  [
    [3.5, -2.5],
    [-7.5, -6.5],
    [-15, -6],
    [-23.5, -9.5],
    [-26.5, -28.5],
  ],
  [
    [-19.5, 20.5],
    [-13.5, 6.5],
    [-7.5, -6.5],
    [-14.5, -19.5],
    [-13.5, -33.5],
    [-4.5, -43.5],
  ],
  [
    [11.5, -13.5],
    [4.5, -21.5],
    [3.5, -33.5],
    [-4.5, -43.5],
  ],
  [
    [4.5, 26.5],
    [0.5, 17.5],
  ],
  [
    [0.5, 29],
    [1.5, 36.5],
    [-7.5, 45.5],
    [-16.5, 49.5],
    [-17.5, 40.5],
    [-21, 31],
    [-19.5, 20.5],
  ],
  [
    [1.5, 36.5],
    [10.5, 42.5],
    [14.5, 52.5],
    [18.5, 61.5],
    [20.5, 66.5],
  ],
];

export function noise(x: number, z: number) {
  let seed = Math.imul(x, 374761393) + Math.imul(z, 668265263);
  seed = Math.imul(seed ^ (seed >>> 13), 1274126177);
  return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
}

export function trailDistance(x: number, z: number) {
  let nearest = Infinity;
  for (const route of ROUTES) {
    for (let i = 1; i < route.length; i++) {
      const [ax, az] = route[i - 1];
      const [bx, bz] = route[i];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
      );
      nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
  }
  return nearest;
}

function shore(z: number) {
  const headland = 24 * Math.max(0, 1 - ((z - 58) / 28) ** 2) ** 2;
  return (
    11 +
    Math.sin((z + 9) * 0.14) * 4 +
    23 * Math.exp(-(((z + 32) / 18) ** 2)) -
    Math.max(0, -z - 48) * 0.4 +
    headland
  );
}

export const WATER = 1.1;
export const MIN_X = -89;
export const MAX_X = 46;
export const MIN_Z = -107;
export const MAX_Z = 76;

function ridge(
  x: number,
  z: number,
  cx: number,
  cz: number,
  width: number,
  length: number,
  height: number,
) {
  return (
    height *
    Math.max(0, 1 - Math.abs((x - cx) / width) - Math.abs((z - cz) / length))
  );
}

function terrainHeight(x: number, z: number) {
  const coast = shore(z) - x;
  if (coast < -1) return 0;
  if (coast < 1.4) return 1;
  const hills =
    5 +
    Math.sin(x * 0.24 + z * 0.132) * 1.5 +
    Math.cos(z * 0.25 - x * 0.09) * 1.25 +
    Math.sin(x * 0.54 + z * 0.37) * 0.75;
  const nearerHills =
    ridge(x, z, -43, 5, 32, 38, 22) + ridge(x, z, -31, -29, 23, 28, 19);
  const mountains = Math.max(
    ridge(x, z, -55, -52, 35, 31, 33),
    ridge(x, z, -37, -63, 29, 26, 38),
    ridge(x, z, -17, -73, 32, 27, 31),
    ridge(x, z, 4, -71, 28, 28, 23),
    ridge(x, z, -72, -64, 24, 34, 43),
  );
  const trail = trailDistance(x, z);
  const trailBlend = Math.max(0, Math.min(1, (trail - 1.5) / 6));
  const trailLevel = 4.65 + 0.7 * Math.sin(z * 0.13);
  const height =
    trailLevel + (hills + nearerHills + mountains - trailLevel) * trailBlend;
  return Math.max(2, Math.floor(Math.min(height, 1 + coast * 0.78)));
}

const WIDTH = MAX_X - MIN_X;
const heights = new Uint8Array(WIDTH * (MAX_Z - MIN_Z));
for (let z = MIN_Z; z < MAX_Z; z++) {
  for (let x = MIN_X; x < MAX_X; x++) {
    heights[(z - MIN_Z) * WIDTH + x - MIN_X] = terrainHeight(x + 0.5, z + 0.5);
  }
}

export function ground(x: number, z: number) {
  x = Math.floor(x);
  z = Math.floor(z);
  if (x < MIN_X || x >= MAX_X || z < MIN_Z || z >= MAX_Z) return 0;
  return heights[(z - MIN_Z) * WIDTH + x - MIN_X];
}

export type Color = readonly [number, number, number];
type Point = readonly [number, number, number];
export type Obstacle = { x: number; z: number; bottom: number; top: number } & (
  | { radius: number }
  | { halfWidth: number; halfDepth: number }
);

const LIGHTHOUSE_TOP = 11.1 + 0.56;
export const STATION_TOP = 3.42 + 0.1;

const grass: Color = [0.38, 0.43, 0.205];
const hills: Color = [0.345, 0.39, 0.235];
const clay: Color = [0.32, 0.25, 0.16];
const shale: Color = [0.33, 0.34, 0.31];
const sand: Color = [0.72, 0.58, 0.36];
const path: Color = [0.64, 0.48, 0.275];
const basalt: Color = [0.33, 0.37, 0.33];

function tint(color: Color, light: number): Color {
  return [color[0] * light, color[1] * light, color[2] * light];
}

export class Mesh {
  vertices: number[] = [];

  quad(
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    color: Color,
    material = 0,
    light = 1,
  ) {
    const shaded = tint(color, light);
    for (const point of [a, b, c, a, c, d])
      this.vertices.push(...point, ...shaded, material);
  }

  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: Color,
    material = 0,
  ) {
    const r = x + w;
    const t = y + h;
    const f = z + d;
    const light = material === 3 ? 1 : undefined;
    this.quad(
      [x, t, f],
      [r, t, f],
      [r, t, z],
      [x, t, z],
      color,
      material,
      light ?? 1.13,
    );
    this.quad(
      [x, y, z],
      [r, y, z],
      [r, y, f],
      [x, y, f],
      color,
      material,
      light ?? 0.61,
    );
    this.quad(
      [x, y, f],
      [r, y, f],
      [r, t, f],
      [x, t, f],
      color,
      material,
      light ?? 0.82,
    );
    this.quad(
      [r, y, z],
      [x, y, z],
      [x, t, z],
      [r, t, z],
      color,
      material,
      light ?? 0.71,
    );
    this.quad(
      [r, y, f],
      [r, y, z],
      [r, t, z],
      [r, t, f],
      color,
      material,
      light ?? 0.93,
    );
    this.quad(
      [x, y, z],
      [x, y, f],
      [x, t, f],
      [x, t, z],
      color,
      material,
      light ?? 0.67,
    );
  }
}

function addDock(mesh: Mesh, obstacles: Obstacle[]) {
  const { start, end, z, halfWidth, deck } = DOCK;
  const timber: Color = [0.33, 0.235, 0.15];
  for (let i = 0; i < 24; i++) {
    const plank = start + ((end - start) * i) / 24;
    const tone = 0.88 + noise(i, 38) * 0.24;
    mesh.box(
      plank,
      deck - 0.18,
      z - halfWidth,
      (end - start) / 24 - 0.015,
      0.18,
      halfWidth * 2,
      tint([0.58, 0.43, 0.27], tone),
    );
  }
  for (const side of [-1, 1]) {
    const edge = z + side * (halfWidth - 0.12);
    mesh.box(start, deck - 0.35, edge - 0.1, end - start, 0.19, 0.2, timber);
    for (const x of [7.6, 10.55, 13.5, 16.65]) {
      mesh.box(x - 0.13, 0.45, edge - 0.13, 0.26, deck - 0.05, 0.26, timber);
      mesh.box(x - 0.16, deck + 0.4, edge - 0.16, 0.32, 0.08, 0.32, basalt);
    }
  }
  mesh.box(
    end - 0.85,
    deck + 0.46,
    z - halfWidth + 0.21,
    0.08,
    0.3,
    0.08,
    timber,
  );
  mesh.box(
    end - 0.95,
    deck + 0.72,
    z - halfWidth + 0.11,
    0.28,
    0.22,
    0.28,
    [1, 0.74, 0.32],
    3,
  );
  mesh.box(
    end - 0.97,
    deck + 0.94,
    z - halfWidth + 0.09,
    0.32,
    0.07,
    0.32,
    basalt,
  );
  obstacles.push({
    x: (start + end) / 2,
    z,
    halfWidth: (end - start) / 2,
    halfDepth: halfWidth,
    bottom: deck - 0.18,
    top: deck,
  });
}

function addTree(
  mesh: Mesh,
  obstacles: Obstacle[],
  x: number,
  y: number,
  z: number,
  n: number,
) {
  const scale = 0.77 + n * 0.65;
  const wood: Color = [0.32, 0.23, 0.13];
  const green: Color = [0.21 + n * 0.1, 0.32 + n * 0.1, 0.26];
  function box(
    bottom: number,
    height: number,
    width: number,
    depth: number,
    color: Color,
    material = 0,
  ) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    mesh.box(
      x - halfWidth,
      bottom,
      z - halfDepth,
      width,
      height,
      depth,
      color,
      material,
    );
    obstacles.push({
      x,
      z,
      bottom,
      top: bottom + height,
      halfWidth,
      halfDepth,
    });
  }
  box(y, 3.3 * scale, 0.42, 0.4, wood, 2);
  for (let i = 0; i < 5; i++) {
    const width = (3.04 - i * 0.57) * scale;
    box(
      y + (1.55 + i * 0.78) * scale,
      0.78 * scale,
      width,
      width,
      tint(green, 0.87 + i * 0.066),
    );
  }
}

function addLighthouse(mesh: Mesh, x: number, y: number, z: number) {
  const ivory: Color = [0.85, 0.79, 0.61];
  const red: Color = [0.61, 0.29, 0.19];
  const dark: Color = [0.23, 0.24, 0.2];
  const window: Color = [1, 0.73, 0.34];
  mesh.box(x - 2.15, y - 1, z - 2.15, 4.3, 1.5, 4.3, basalt, 2);
  for (let i = 0; i < 6; i++) {
    const width = 3.4 - i * 0.12;
    mesh.box(
      x - width / 2,
      y + 0.5 + i * 1.32,
      z - width / 2,
      width,
      1.32,
      width,
      i % 2 ? ivory : red,
      2,
    );
  }
  mesh.box(x - 2.04, y + 8.42, z - 2.04, 4.08, 0.35, 4.08, dark);
  mesh.box(x - 1.26, y + 8.77, z - 1.26, 2.52, 1.38, 2.52, window, 3);
  for (const dx of [-1.38, 1.16]) {
    for (const dz of [-1.38, 1.16])
      mesh.box(x + dx, y + 8.77, z + dz, 0.22, 1.45, 0.22, dark);
  }
  mesh.box(x - 1.75, y + 10.15, z - 1.75, 3.5, 0.26, 3.5, dark);
  mesh.box(x - 1.35, y + 10.41, z - 1.35, 2.7, 0.37, 2.7, red);
  mesh.box(x - 0.77, y + 10.78, z - 0.77, 1.54, 0.35, 1.54, red);
  mesh.box(x - 0.15, y + 11.1, z - 0.15, 0.3, 0.56, 0.3, dark);
}

function addStoneArch(mesh: Mesh, obstacles: Obstacle[]) {
  const { x, z } = SOUTH_ARCH;
  const stone: Color = [0.48, 0.45, 0.34];
  const top = Math.max(ground(x - 1.7, z), ground(x + 1.7, z)) + 3.45;
  for (const dx of [-1.7, 1.7]) {
    const pillar = x + dx;
    const base = ground(pillar, z) - 0.5;
    mesh.box(pillar - 0.6, base, z - 0.58, 1.2, 0.86, 1.16, basalt, 2);
    mesh.box(pillar - 0.45, base, z - 0.46, 0.9, top - base, 0.92, stone, 2);
    mesh.box(pillar - 0.59, top - 0.4, z - 0.55, 1.18, 0.4, 1.1, basalt, 2);
    obstacles.push({
      x: pillar,
      z,
      halfWidth: 0.6,
      halfDepth: 0.58,
      bottom: base,
      top,
    });
  }
  obstacles.push({
    x,
    z,
    halfWidth: 2.22,
    halfDepth: 0.59,
    bottom: top,
    top: top + 0.82,
  });
  mesh.box(x - 2.22, top, z - 0.56, 4.44, 0.52, 1.12, stone, 2);
  mesh.box(x - 1.82, top + 0.52, z - 0.46, 3.64, 0.3, 0.92, basalt, 2);
  mesh.box(x - 0.41, top + 0.06, z - 0.59, 0.82, 0.62, 1.18, stone, 2);
}

function addSouthBeacon(mesh: Mesh, obstacles: Obstacle[]) {
  const { x, z } = SOUTH_BEACON;
  const y = ground(x, z);
  const stone: Color = [0.76, 0.68, 0.49];
  const copper: Color = [0.3, 0.43, 0.39];
  mesh.box(x - 1.1, y - 1, z - 1.1, 2.2, 1.55, 2.2, basalt, 2);
  mesh.box(x - 0.72, y + 0.55, z - 0.72, 1.44, 2.65, 1.44, stone, 2);
  mesh.box(x - 0.94, y + 3.2, z - 0.94, 1.88, 0.3, 1.88, copper);
  mesh.box(x - 0.61, y + 3.5, z - 0.61, 1.22, 0.84, 1.22, [1, 0.72, 0.35], 3);
  for (const dx of [-0.71, 0.53]) {
    for (const dz of [-0.71, 0.53]) {
      mesh.box(x + dx, y + 3.5, z + dz, 0.18, 0.84, 0.18, copper);
    }
  }
  mesh.box(x - 0.92, y + 4.34, z - 0.92, 1.84, 0.22, 1.84, copper);
  mesh.box(x - 0.64, y + 4.56, z - 0.64, 1.28, 0.28, 1.28, copper);
  mesh.box(x - 0.34, y + 4.84, z - 0.34, 0.68, 0.27, 0.68, copper);
  obstacles.push({
    x,
    z,
    halfWidth: 1.1,
    halfDepth: 1.1,
    bottom: y - 1,
    top: y + 5.11,
  });
}

export function makeTerrain() {
  const mesh = new Mesh();
  const obstacles: Obstacle[] = [];
  const { x: lightX, z: lightZ } = LIGHTHOUSE;
  for (let z = MIN_Z; z < MAX_Z; z++) {
    for (let x = MIN_X; x < MAX_X; x++) {
      const y = ground(x, z);
      if (!y) continue;
      const n = noise(x, z);
      const trail = trailDistance(x + 0.5, z + 0.5);
      const coast = y < 4 && shore(z) - x < 4.2;
      const rocky = y >= 19 && n > 0.28;
      const onTrail = trail < 1.37 + n * 0.38;
      const top = coast
        ? sand
        : onTrail
          ? path
          : rocky
            ? shale
            : y >= 10
              ? hills
              : grass;
      const relief = Math.min(
        0.18,
        Math.max(0, ground(x - 1, z) - y, ground(x, z + 1) - y) * 0.063,
      );
      const tone = 0.94 + n * 0.19 - relief;
      mesh.quad(
        [x, y, z + 1],
        [x + 1, y, z + 1],
        [x + 1, y, z],
        [x, y, z],
        top,
        0,
        tone,
      );
      const side = coast ? sand : rocky ? shale : clay;
      let b = ground(x, z + 1);
      if (b < y)
        mesh.quad(
          [x, b, z + 1],
          [x + 1, b, z + 1],
          [x + 1, y, z + 1],
          [x, y, z + 1],
          side,
          2,
          tone * 0.82,
        );
      b = ground(x, z - 1);
      if (b < y)
        mesh.quad(
          [x + 1, b, z],
          [x, b, z],
          [x, y, z],
          [x + 1, y, z],
          side,
          2,
          tone * 0.67,
        );
      b = ground(x + 1, z);
      if (b < y)
        mesh.quad(
          [x + 1, b, z + 1],
          [x + 1, b, z],
          [x + 1, y, z],
          [x + 1, y, z + 1],
          side,
          2,
          tone * 0.94,
        );
      b = ground(x - 1, z);
      if (b < y)
        mesh.quad(
          [x, b, z],
          [x, b, z + 1],
          [x, y, z + 1],
          [x, y, z],
          side,
          2,
          tone * 0.62,
        );
      if (
        coast ||
        rocky ||
        trail < 2 ||
        LANDMARKS.some(
          (landmark) => Math.hypot(x - landmark.x, z - landmark.z) < 4,
        )
      )
        continue;
      if (x % 3 === 0 && z % 3 === 0 && n > 0.72 && (x < -5 || z < -10)) {
        addTree(mesh, obstacles, x + 0.5, y, z + 0.5, noise(z, x));
      } else if (n < 0.3 && z > -55) {
        const reeds: Color =
          noise(z, x) > 0.64 ? [0.65, 0.55, 0.27] : [0.42, 0.49, 0.235];
        mesh.box(x + 0.29, y, z + 0.39, 0.085, 0.19 + n * 0.72, 0.085, reeds);
        mesh.box(x + 0.47, y, z + 0.58, 0.09, 0.16 + n * 0.48, 0.09, reeds);
        if (n < 0.041)
          mesh.box(
            x + 0.26,
            y + 0.21,
            z + 0.36,
            0.14,
            0.09,
            0.14,
            [0.91, 0.67, 0.29],
          );
      }
    }
  }
  const lightY = ground(lightX, lightZ);
  addLighthouse(mesh, lightX, lightY, lightZ);
  addDock(mesh, obstacles);
  addStoneArch(mesh, obstacles);
  addSouthBeacon(mesh, obstacles);
  obstacles.push({
    x: lightX,
    z: lightZ,
    radius: 2.2,
    bottom: lightY - 1,
    top: lightY + LIGHTHOUSE_TOP,
  });
  for (let z = 3; z < 16; z += 2) {
    const x = 8 + Math.sin((z + 9) * 0.14) * 3;
    const y = ground(x, z);
    if (y < 2) continue;
    mesh.box(x, y, z, 0.22, 0.79, 0.22, clay, 2);
    mesh.box(x - 0.05, y + 0.68, z - 0.05, 0.32, 0.16, 0.32, basalt);
  }
  mesh.quad(
    [-180, WATER, 180],
    [260, WATER, 180],
    [260, WATER, -230],
    [-180, WATER, -230],
    [0.19, 0.37, 0.39],
    1,
  );
  return { vertices: new Float32Array(mesh.vertices), obstacles };
}

export function makeStations(count: number) {
  const mesh = new Mesh();
  for (const [x, z, sideways] of STATIONS.slice(0, count)) {
    const y = ground(x, z);
    const wood: Color = [0.32, 0.25, 0.17];
    const trim: Color = [0.62, 0.43, 0.22];
    const lamp: Color = [1, 0.74, 0.32];
    function box(
      u: number,
      level: number,
      v: number,
      w: number,
      h: number,
      d: number,
      color: Color,
      material = 0,
    ) {
      if (sideways)
        mesh.box(x - v - d, y + level, z + u, d, h, w, color, material);
      else mesh.box(x + u, y + level, z + v, w, h, d, color, material);
    }
    for (const offset of [-0.96, 0.96]) {
      box(offset - 0.28, 0, -0.28, 0.56, 0.15, 0.56, basalt, 2);
      box(offset - 0.16, 0.15, -0.16, 0.32, 0.69, 0.32, wood, 2);
    }
    box(-1.29, 0.78, -0.15, 2.58, 1.88, 0.3, wood, 2);
    box(-1.34, 0.77, -0.2, 2.68, 0.13, 0.4, trim, 2);
    box(-1.34, 2.54, -0.2, 2.68, 0.16, 0.4, trim, 2);
    box(-1.4, 2.7, -0.26, 2.8, 0.13, 0.52, wood, 2);
    box(-0.34, 2.83, -0.3, 0.68, 0.11, 0.6, trim);
    box(-0.25, 2.94, -0.21, 0.5, 0.38, 0.42, lamp, 3);
    for (const dx of [-0.28, 0.2]) {
      for (const dz of [-0.24, 0.16]) box(dx, 2.94, dz, 0.08, 0.4, 0.08, wood);
    }
    box(-0.34, 3.32, -0.29, 0.68, 0.1, 0.58, wood);
    box(-0.25, 3.42, -0.22, 0.5, 0.1, 0.44, trim);
  }
  return new Float32Array(mesh.vertices);
}

export const NOTICE_VERTICES = 12;

export function makeNoticeFaces(count: number) {
  const vertices: number[] = [];
  const half = NOTICE.width / 2;
  // Each face winds outward and has an independent left edge, so the back
  // of the board shows the same page without mirroring it.
  for (const [x, z, sideways] of STATIONS.slice(0, count)) {
    const bottom = ground(x, z) + NOTICE.bottom;
    for (const side of [1, -1]) {
      for (const [u, v] of [
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 1],
        [1, 0],
        [0, 0],
      ]) {
        const along = side * (u * NOTICE.width - half);
        const across = side * NOTICE.face;
        vertices.push(
          x + (sideways ? -across : along),
          bottom + (1 - v) * NOTICE.height,
          z + (sideways ? along : across),
          u,
          v,
        );
      }
    }
  }
  return new Float32Array(vertices);
}

export function stationPenetration(
  [x, z, sideways]: Station,
  px: number,
  pz: number,
) {
  const along = sideways ? pz - z : px - x;
  const across = sideways ? px - x : pz - z;
  return Math.min(1.53 - Math.abs(along), 0.42 - Math.abs(across));
}
