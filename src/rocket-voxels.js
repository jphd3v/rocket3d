import { WORLD_UNITS_PER_VOXEL } from './world-units.js';

export const ROCKET_VOXEL_SIZE = WORLD_UNITS_PER_VOXEL;

// Rocket voxels use the same one-unit grid as terrain voxels. This preserves
// the original stepped V-shaped ship silhouette, but each visible block is now
// a standard voxel instead of a scaled micro-block.
export const ROCKET_VOXELS = [
  { x: 0, y: 0, z: 1, role: 'nose' },
  { x: 0, y: 0, z: 0, role: 'nose' },
  { x: -1, y: 0, z: -1, role: 'body' },
  { x: -1, y: 0, z: -2, role: 'body' },
  { x: 1, y: 0, z: -1, role: 'body' },
  { x: 1, y: 0, z: -2, role: 'body' },
  { x: -2, y: 0, z: -3, role: 'wing' },
  { x: -2, y: 0, z: -4, role: 'wing' },
  { x: 2, y: 0, z: -3, role: 'wing' },
  { x: 2, y: 0, z: -4, role: 'wing' },
  { x: -3, y: 0, z: -5, role: 'engine' },
  { x: -3, y: 0, z: -6, role: 'engine' },
  { x: 3, y: 0, z: -5, role: 'engine' },
  { x: 3, y: 0, z: -6, role: 'engine' },
];

export const ROCKET_EXHAUST_POINTS = [
  { x: -3, y: 0, z: -6.8 },
  { x: 3, y: 0, z: -6.8 },
];

export const ROCKET_TARGET_ANCHOR = { x: 0, y: 0, z: -3.0 };
export const ROCKET_WEAPON_MUZZLE_POINT = { x: 0, y: 0, z: 2.1 };
export const ROCKET_CABIN_LIGHT_POINT = { x: 0, y: 1.2, z: 0.4 };
export const ROCKET_HEADLIGHT_POINT = { x: 0, y: 0.8, z: 1.8 };
export const ROCKET_HEADLIGHT_TARGET_POINT = { x: 0, y: 0, z: 36 };
