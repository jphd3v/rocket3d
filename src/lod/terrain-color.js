import { VOXEL_TYPES } from '../voxel-types.js';
import { getVoxelMaterial } from '../voxel-materials.js';

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function sampleTerrainColorNoise(x, y, z) {
  return (
    (Math.sin(x * 0.071 + z * 0.047 + y * 0.023) +
      Math.sin(x * 0.149 - z * 0.093 + y * 0.041) * 0.55 +
      Math.sin((x + z) * 0.034 - y * 0.11) * 0.35) /
    1.9
  );
}

function sampleMossPatchNoise(x, y, z) {
  return (
    Math.sin(x * 0.038 + z * 0.027 + y * 0.011) * 0.55 +
    Math.sin(x * 0.094 - z * 0.061 + y * 0.019) * 0.32 +
    Math.sin((x - z) * 0.016 + y * 0.047) * 0.22
  );
}

function multiplyColor(color, multiplier) {
  return [
    Math.min(1, color[0] * multiplier),
    Math.min(1, color[1] * multiplier),
    Math.min(1, color[2] * multiplier),
  ];
}

function tintColor(color, tint, strength) {
  return [
    color[0] * (1 - strength) + tint[0] * strength,
    color[1] * (1 - strength) + tint[1] * strength,
    color[2] * (1 - strength) + tint[2] * strength,
  ];
}

function getBiomeTint(biomeId) {
  if (biomeId === 'moss') {
    return [0.62, 0.86, 0.66];
  }
  if (biomeId === 'amber') {
    return [0.84, 0.7, 0.48];
  }
  if (biomeId === 'ice') {
    return [0.62, 0.82, 0.92];
  }
  if (biomeId === 'machine') {
    return [0.66, 0.72, 0.74];
  }
  return [0.72, 0.94, 0.78];
}

export function getTerrainSurfaceColor(options) {
  var voxelType = options.voxelType;
  var wx = options.worldX;
  var wy = options.worldY;
  var wz = options.worldZ;
  var nx = options.normalX;
  var ny = options.normalY;
  var nz = options.normalZ;
  var biomeId = options.biomeId;
  var featureInfo = options.featureInfo;
  var surfaceBiomeBand = options.surfaceBiomeBand;

  var voxelMaterial = getVoxelMaterial(voxelType);

  var color = voxelMaterial.baseColor || [0.5, 0.5, 0.5];

  var hash =
    Math.abs(Math.sin(wx * 12.9898 + wy * 78.233 + wz * 37.719)) * 43758.5453;
  var terrainNoise = sampleTerrainColorNoise(wx, wy, wz);
  var broadNoise = sampleTerrainColorNoise(wx * 0.45, wy * 0.65, wz * 0.45);

  var variations = voxelMaterial.variations;
  if (variations) {
    var colorIndex = Math.floor(hash * variations.length) % variations.length;
    var variationColor = variations[colorIndex];
    var blendFactor =
      typeof voxelMaterial.variationBlend === 'number'
        ? voxelMaterial.variationBlend
        : 0.78;
    color = [
      color[0] * (1 - blendFactor) + variationColor[0] * blendFactor,
      color[1] * (1 - blendFactor) + variationColor[1] * blendFactor,
      color[2] * (1 - blendFactor) + variationColor[2] * blendFactor,
    ];
  }

  var floorFace = Math.max(0, ny);
  var ceilingFace = Math.max(0, -ny);
  var wallFace = 1 - floorFace - ceilingFace;
  var chamberWeight = featureInfo && featureInfo.kind === 'chamber' ? 1 : 0;
  var tunnelWeight = featureInfo && featureInfo.kind === 'tunnel' ? 1 : 0;
  var chamberCenterWeight = 0;

  if (featureInfo && featureInfo.kind === 'chamber' && featureInfo.source) {
    var chamberLocalX =
      (wx - featureInfo.source.center.x) / featureInfo.source.radius.x;
    var chamberLocalZ =
      (wz - featureInfo.source.center.z) / featureInfo.source.radius.z;
    var chamberHorizontal = Math.sqrt(
      chamberLocalX * chamberLocalX + chamberLocalZ * chamberLocalZ
    );
    chamberCenterWeight = clamp01(1 - chamberHorizontal / 0.4);
  }

  var hemiFactor = 0.62 + floorFace * 0.46 - ceilingFace * 0.22;
  var sideFactor = 0.9 + Math.max(0, nx) * 0.08 + Math.max(0, nz) * 0.05;
  var caveFloorDarkening = 1 - clamp01((220 - wy) / 240) * 0.05;
  var surfaceDistance = featureInfo ? Math.max(0, featureInfo.distance) : 0;
  var surfaceExposure =
    1 - clamp01(surfaceDistance / Math.max(1, surfaceBiomeBand));

  var finalMultiplier = hemiFactor * sideFactor * caveFloorDarkening;

  if (chamberWeight > 0) {
    finalMultiplier *= 1.04 + chamberCenterWeight * 0.05;
  }

  if (tunnelWeight > 0) {
    finalMultiplier *= 0.9;
  }

  if (voxelType === VOXEL_TYPES.ROCK) {
    var strata = 0.5 + 0.5 * Math.sin(wy * 0.21 + terrainNoise * 3.2);

    if (floorFace > 0.5) {
      color = tintColor(color, [0.56, 0.63, 0.46], 0.28);
    } else if (wallFace > 0.5) {
      color = tintColor(color, [0.17, 0.27, 0.24], 0.22);
    } else if (ceilingFace > 0.5) {
      color = tintColor(color, [0.08, 0.12, 0.12], 0.28);
    }

    color = tintColor(color, [0.24, 0.34, 0.29], surfaceExposure * 0.24);
    finalMultiplier *= 0.94 + strata * 0.14;
  }

  if (voxelType === VOXEL_TYPES.MOSS) {
    var floorBloom = clamp01(0.5 + broadNoise * 0.7);
    var wallBloom = clamp01(0.5 + terrainNoise * 0.9);
    var chamberBloom = 0.1 + chamberWeight * 0.14;
    var mossPatch = sampleMossPatchNoise(wx, wy, wz);
    var freshGrowth = clamp01((mossPatch + 0.28) * 0.78);
    var oldGrowth = clamp01((-mossPatch + 0.24) * 0.82);
    var verticalStreak = 0.5 + 0.5 * Math.sin(wy * 0.33 + broadNoise * 3.4);
    var limeAccent = clamp01(freshGrowth * verticalStreak);
    var deepAccent = clamp01(oldGrowth * (1 - verticalStreak * 0.45));

    if (floorFace > 0.5) {
      color = tintColor(
        color,
        [0.6, 0.82, 0.22],
        0.18 + floorBloom * 0.18 + chamberBloom + limeAccent * 0.12
      );
      color = tintColor(
        color,
        [0.76, 0.95, 0.38],
        chamberCenterWeight * 0.16 + freshGrowth * 0.08
      );
      color = tintColor(
        color,
        [0.2, 0.38, 0.13],
        surfaceExposure * 0.16 + deepAccent * 0.14
      );
      finalMultiplier *=
        0.98 +
        floorBloom * 0.1 +
        chamberWeight * 0.05 +
        limeAccent * 0.08 -
        deepAccent * 0.08;
    } else if (wallFace > 0.5) {
      color = tintColor(color, [0.1, 0.2, 0.11], 0.18 + deepAccent * 0.16);
      color = tintColor(
        color,
        [0.46, 0.76, 0.24],
        wallBloom * 0.16 +
          surfaceExposure * 0.1 +
          chamberWeight * 0.05 +
          freshGrowth * 0.1
      );
      color = tintColor(
        color,
        [0.62, 0.9, 0.34],
        limeAccent * 0.11 + verticalStreak * chamberWeight * 0.04
      );
      finalMultiplier *=
        0.93 +
        wallBloom * 0.1 -
        tunnelWeight * 0.04 +
        limeAccent * 0.1 -
        deepAccent * 0.06;
    } else if (ceilingFace > 0.5) {
      color = tintColor(
        color,
        [0.06, 0.12, 0.07],
        0.28 + tunnelWeight * 0.07 + deepAccent * 0.18
      );
      color = tintColor(
        color,
        [0.28, 0.5, 0.2],
        chamberWeight * 0.1 + freshGrowth * 0.07
      );
      finalMultiplier *=
        0.86 - tunnelWeight * 0.04 + limeAccent * 0.06 - deepAccent * 0.05;
    }
  }

  if (
    voxelType >= VOXEL_TYPES.CRYSTAL_EMERALD &&
    voxelType <= VOXEL_TYPES.CRYSTAL_AMETHYST
  ) {
    finalMultiplier += 0.36;
  } else if (voxelType === VOXEL_TYPES.GLOW_POD) {
    color = [0.72, 1.0, 0.8];
    color = tintColor(
      color,
      [0.42, 0.7, 0.44],
      clamp01(0.18 + broadNoise * 0.12)
    );
    color = tintColor(color, [0.9, 1.0, 0.82], chamberCenterWeight * 0.06);
    finalMultiplier += 0.32;
  } else if (voxelType === VOXEL_TYPES.EMBER_VENT) {
    finalMultiplier += 0.14;
  } else if (voxelType === VOXEL_TYPES.LAMP) {
    finalMultiplier += 0.16;
  }

  color = multiplyColor(color, finalMultiplier);

  color = tintColor(
    color,
    getBiomeTint(biomeId),
    voxelType === VOXEL_TYPES.MOSS ? 0.08 : 0.1
  );

  if (tunnelWeight > 0) {
    color = tintColor(color, [0.06, 0.1, 0.09], 0.1);
  }

  if (voxelMaterial.tintColor) {
    color = tintColor(color, voxelMaterial.tintColor, 0.14);
  }

  return color;
}
