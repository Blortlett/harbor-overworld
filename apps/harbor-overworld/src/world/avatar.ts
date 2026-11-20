import { type Color, Mesh } from './terrain';

export const COATS: readonly Color[] = [
  [0.21, 0.57, 0.62],
  [0.81, 0.38, 0.24],
  [0.53, 0.47, 0.72],
  [0.67, 0.63, 0.24],
  [0.42, 0.64, 0.35],
  [0.77, 0.43, 0.54],
];

export function coatIndex(id: number) {
  return (id - 1) % COATS.length;
}

export function avatarMesh(index: number) {
  const mesh = new Mesh();
  const coat = COATS[index];
  const skin: Color =
    index % 3 === 0
      ? [0.77, 0.54, 0.36]
      : index % 3 === 1
        ? [0.62, 0.39, 0.28]
        : [0.9, 0.69, 0.49];
  const canvas: Color = [0.29, 0.3, 0.25];
  const boots: Color = [0.21, 0.19, 0.15];
  const pack: Color = [0.53, 0.36, 0.24];
  const trim: Color = [0.95, 0.77, 0.4];

  for (const [index, x] of [-0.21, 0.02].entries()) {
    const limb = 4 + index;
    mesh.box(x, 0.13, -0.115, 0.19, 0.47, 0.23, canvas, limb);
    mesh.box(x - 0.01, 0.0, -0.175, 0.21, 0.16, 0.3, boots, limb);
  }
  mesh.box(-0.235, 0.56, -0.15, 0.47, 0.6, 0.3, coat);
  mesh.box(-0.235, 0.59, -0.157, 0.47, 0.07, 0.014, boots);
  mesh.box(-0.035, 0.99, -0.163, 0.07, 0.07, 0.012, trim);
  for (const x of [-0.38, 0.235]) {
    mesh.box(x, 0.74, -0.115, 0.145, 0.39, 0.23, coat);
    mesh.box(x + 0.012, 0.66, -0.1, 0.12, 0.1, 0.2, skin);
  }
  mesh.box(-0.155, 1.13, -0.14, 0.31, 0.3, 0.29, skin);
  mesh.box(-0.183, 1.4, -0.163, 0.366, 0.12, 0.33, coat);
  mesh.box(-0.17, 1.377, -0.224, 0.34, 0.042, 0.105, boots);
  for (const x of [-0.09, 0.056]) {
    mesh.box(x, 1.285, -0.144, 0.035, 0.035, 0.008, boots);
  }
  mesh.box(-0.175, 0.68, 0.14, 0.35, 0.4, 0.145, pack);
  mesh.box(-0.175, 0.99, 0.14, 0.35, 0.08, 0.162, boots);
  mesh.box(-0.038, 0.865, 0.285, 0.076, 0.065, 0.009, trim);
  return new Float32Array(mesh.vertices);
}

export function crownMesh() {
  const mesh = new Mesh();
  const gold: Color = [0.99, 0.69, 0.17];
  const highlight: Color = [1, 0.84, 0.35];
  const ruby: Color = [0.79, 0.14, 0.24];
  mesh.box(-0.193, 1.51, -0.19, 0.386, 0.085, 0.372, gold);
  mesh.box(-0.198, 1.578, -0.195, 0.396, 0.02, 0.382, highlight);
  for (const z of [-0.19, 0.13]) {
    for (const x of [-0.193, 0.139]) {
      mesh.box(x, 1.595, z, 0.054, 0.099, 0.054, gold);
      mesh.box(x + 0.009, 1.686, z + 0.009, 0.036, 0.035, 0.036, highlight);
    }
  }
  mesh.box(-0.033, 1.595, -0.19, 0.066, 0.136, 0.054, gold);
  mesh.box(-0.023, 1.717, -0.18, 0.046, 0.041, 0.034, highlight);
  mesh.box(-0.022, 1.534, -0.198, 0.044, 0.043, 0.011, ruby);
  return new Float32Array(mesh.vertices);
}

export function nameplate(id: number, name: string) {
  const paper = document.createElement('canvas');
  paper.width = 128;
  paper.height = 32;
  const context = paper.getContext('2d');
  if (!context) return null;
  const font = '700 18px monospace';
  context.font = font;
  paper.width = Math.max(
    128,
    Math.min(320, Math.ceil(context.measureText(name).width + 24)),
  );
  context.fillStyle = '#15241c';
  context.fillRect(0, 0, paper.width, paper.height);
  const tint = COATS[coatIndex(id)].map((channel) => Math.round(channel * 255));
  context.fillStyle = `rgb(${tint.join(',')})`;
  context.fillRect(0, 0, paper.width, 3);
  context.fillStyle = '#fff0d5';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = font;
  context.fillText(name, paper.width / 2, 19, paper.width - 16);
  return paper;
}
