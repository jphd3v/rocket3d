export const VOXEL_TYPES = {
  EMPTY: 0,
  ROCK: 1,
  CRYSTAL_EMERALD: 2,
  CRYSTAL_SAPPHIRE: 3,
  CRYSTAL_AQUAMARINE: 4,
  CRYSTAL_AMETHYST: 5,
  MOSS: 6,
  AMBER: 7,
  ICE: 8,
  MACHINE: 9,
  GLOW_POD: 10,
  EMBER_VENT: 11,
  LAMP: 12,
};

export function isCrystalVoxelType(voxelType) {
  return (
    voxelType === VOXEL_TYPES.CRYSTAL_EMERALD ||
    voxelType === VOXEL_TYPES.CRYSTAL_SAPPHIRE ||
    voxelType === VOXEL_TYPES.CRYSTAL_AQUAMARINE ||
    voxelType === VOXEL_TYPES.CRYSTAL_AMETHYST
  );
}

export function isLightVoxelType(voxelType) {
  return (
    isCrystalVoxelType(voxelType) ||
    voxelType === VOXEL_TYPES.GLOW_POD ||
    voxelType === VOXEL_TYPES.EMBER_VENT ||
    voxelType === VOXEL_TYPES.LAMP
  );
}
