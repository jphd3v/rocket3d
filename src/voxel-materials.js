import { VOXEL_TYPES } from './voxel-types.js';

const MATERIALS_BY_TYPE = {
  [VOXEL_TYPES.EMPTY]: {
    id: 'empty',
    solid: false,
    renderable: false,
    destructible: false,
    durability: 0,
    baseColor: [0, 0, 0],
  },
  [VOXEL_TYPES.ROCK]: {
    id: 'rock',
    solid: true,
    renderable: true,
    destructible: true,
    durability: 3,
    baseColor: [0.34, 0.43, 0.38],
    variations: [
      [0.28, 0.37, 0.33],
      [0.36, 0.46, 0.39],
      [0.42, 0.52, 0.43],
      [0.31, 0.4, 0.36],
      [0.45, 0.56, 0.45],
      [0.24, 0.32, 0.3],
      [0.38, 0.47, 0.41],
      [0.33, 0.43, 0.37],
    ],
    variationBlend: 1,
  },
  [VOXEL_TYPES.CRYSTAL_EMERALD]: {
    id: 'crystalEmerald',
    solid: true,
    renderable: true,
    transparent: true,
    opacity: 0.58,
    destructible: true,
    durability: 1,
    emitsLight: true,
    baseColor: [0.2, 0.9, 0.7],
    variations: [
      [0.15, 0.8, 0.6],
      [0.25, 0.95, 0.75],
      [0.2, 0.85, 0.65],
      [0.18, 0.92, 0.72],
    ],
    tintColor: [0.4, 1.0, 0.82],
  },
  [VOXEL_TYPES.CRYSTAL_SAPPHIRE]: {
    id: 'crystalSapphire',
    solid: true,
    renderable: true,
    transparent: true,
    opacity: 0.58,
    destructible: true,
    durability: 1,
    emitsLight: true,
    baseColor: [0.2, 0.4, 0.9],
    variations: [
      [0.15, 0.3, 0.8],
      [0.25, 0.45, 0.95],
      [0.2, 0.35, 0.85],
      [0.18, 0.42, 0.92],
    ],
    tintColor: [0.42, 0.58, 1.0],
  },
  [VOXEL_TYPES.CRYSTAL_AQUAMARINE]: {
    id: 'crystalAquamarine',
    solid: true,
    renderable: true,
    transparent: true,
    opacity: 0.58,
    destructible: true,
    durability: 1,
    emitsLight: true,
    baseColor: [0.3, 0.7, 0.9],
    variations: [
      [0.25, 0.6, 0.8],
      [0.35, 0.75, 0.95],
      [0.3, 0.65, 0.85],
      [0.28, 0.72, 0.92],
    ],
    tintColor: [0.5, 0.86, 1.0],
  },
  [VOXEL_TYPES.CRYSTAL_AMETHYST]: {
    id: 'crystalAmethyst',
    solid: true,
    renderable: true,
    transparent: true,
    opacity: 0.58,
    destructible: true,
    durability: 1,
    emitsLight: true,
    baseColor: [0.7, 0.3, 0.9],
    variations: [
      [0.6, 0.25, 0.8],
      [0.75, 0.35, 0.95],
      [0.65, 0.3, 0.85],
      [0.72, 0.32, 0.92],
    ],
    tintColor: [0.88, 0.58, 1.0],
  },
  [VOXEL_TYPES.MOSS]: {
    id: 'moss',
    solid: true,
    renderable: true,
    destructible: true,
    durability: 2,
    baseColor: [0.28, 0.48, 0.22],
    variations: [
      [0.12, 0.24, 0.1],
      [0.18, 0.36, 0.14],
      [0.25, 0.5, 0.18],
      [0.34, 0.62, 0.22],
      [0.42, 0.72, 0.26],
      [0.5, 0.82, 0.32],
      [0.28, 0.44, 0.18],
      [0.2, 0.42, 0.26],
    ],
    variationBlend: 0.95,
  },
  [VOXEL_TYPES.AMBER]: {
    id: 'amber',
    solid: true,
    renderable: true,
    destructible: true,
    durability: 2,
    baseColor: [0.56, 0.34, 0.18],
    variations: [
      [0.48, 0.28, 0.14],
      [0.64, 0.38, 0.2],
      [0.76, 0.46, 0.24],
      [0.56, 0.33, 0.16],
    ],
  },
  [VOXEL_TYPES.ICE]: {
    id: 'ice',
    solid: true,
    renderable: true,
    destructible: true,
    durability: 2,
    baseColor: [0.5, 0.66, 0.78],
    variations: [
      [0.46, 0.64, 0.82],
      [0.58, 0.78, 0.94],
      [0.38, 0.56, 0.74],
      [0.5, 0.7, 0.88],
    ],
  },
  [VOXEL_TYPES.MACHINE]: {
    id: 'machine',
    solid: true,
    renderable: true,
    destructible: false,
    durability: 8,
    baseColor: [0.42, 0.45, 0.5],
    variations: [
      [0.36, 0.39, 0.44],
      [0.48, 0.52, 0.58],
      [0.28, 0.31, 0.36],
      [0.4, 0.43, 0.48],
    ],
    variationBlend: 1,
  },
  [VOXEL_TYPES.GLOW_POD]: {
    id: 'glowPod',
    solid: true,
    renderable: true,
    destructible: true,
    durability: 1,
    emitsLight: true,
    baseColor: [0.6, 0.95, 0.75],
    variations: [
      [0.55, 0.95, 0.72],
      [0.48, 0.82, 0.98],
      [0.64, 0.96, 0.84],
      [0.62, 0.84, 1.0],
    ],
  },
  [VOXEL_TYPES.EMBER_VENT]: {
    id: 'emberVent',
    solid: true,
    renderable: true,
    destructible: false,
    durability: 0,
    emitsLight: true,
    baseColor: [1.0, 0.52, 0.24],
    variations: [
      [1.0, 0.46, 0.18],
      [1.0, 0.6, 0.3],
      [0.92, 0.36, 0.14],
    ],
  },
  [VOXEL_TYPES.LAMP]: {
    id: 'lamp',
    solid: true,
    renderable: true,
    destructible: false,
    durability: 0,
    emitsLight: true,
    baseColor: [1.0, 0.88, 0.62],
    variations: [
      [1.0, 0.82, 0.54],
      [0.84, 0.92, 1.0],
      [1.0, 0.92, 0.72],
    ],
  },
};

const DEFAULT_MATERIAL = {
  id: 'unknown',
  solid: true,
  renderable: true,
  destructible: false,
  durability: 1,
  baseColor: [0.5, 0.5, 0.5],
};

export function getVoxelMaterial(voxelType) {
  return MATERIALS_BY_TYPE[voxelType] || DEFAULT_MATERIAL;
}

export function isVoxelSolid(voxelType) {
  return getVoxelMaterial(voxelType).solid === true;
}

export function isVoxelRenderable(voxelType) {
  return getVoxelMaterial(voxelType).renderable === true;
}

export function isVoxelTransparent(voxelType) {
  return getVoxelMaterial(voxelType).transparent === true;
}

export function isVoxelDestructible(voxelType) {
  return getVoxelMaterial(voxelType).destructible === true;
}
