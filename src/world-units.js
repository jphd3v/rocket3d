// Project unit model:
// 1 Three.js world unit equals the edge length of one voxel.
// This is the main scale rule for world geometry. Terrain, rocket voxels,
// landmarks, pads, props, collision dimensions, chamber sizes, tunnel
// radii, and authored voxel maps all use this same unit unless the code is
// clearly dealing with a non-world effect such as particles, lights, UI, or
// camera helpers.
export const WORLD_UNITS_PER_VOXEL = 1;
export const CHUNK_SIZE_VOXELS = 32;

// Dynamic objects that are built as voxels use this same edge length.
