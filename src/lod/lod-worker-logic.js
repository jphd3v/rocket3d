import { VOXEL_TYPES } from '../voxel-types.js';
import { getTerrainSurfaceColor } from './terrain-color.js';

export function isSolidTerrainVoxel(voxelType) {
  return voxelType !== VOXEL_TYPES.EMPTY;
}

export function getCoarseCellSampleOffsets(blockSize) {
  var max = blockSize - 1;
  var mid = Math.floor(blockSize / 2);
  return [
    [mid, mid, mid],
    [0, 0, 0],
    [max, 0, 0],
    [0, max, 0],
    [max, max, 0],
    [0, 0, max],
    [max, 0, max],
    [0, max, max],
    [max, max, max],
    [mid, mid, 0],
    [mid, mid, max],
    [mid, 0, mid],
    [mid, max, mid],
    [0, mid, mid],
    [max, mid, mid],
  ];
}

export function getCoarseSolidThreshold(blockSize) {
  if (blockSize <= 4) {
    return 3;
  }
  return 2;
}

export function sampleCoarseCell(
  generator,
  originX,
  originY,
  originZ,
  blockSize,
  threshold,
  samples,
  diagnostics
) {
  var solidCount = 0;
  var countsByType = {};

  for (var i = 0; i < samples.length; i++) {
    var offset = samples[i];
    if (diagnostics) {
      diagnostics.generateVoxelCalls++;
    }
    var voxelType = generator.generateVoxel(
      originX + offset[0],
      originY + offset[1],
      originZ + offset[2]
    );
    if (isSolidTerrainVoxel(voxelType)) {
      solidCount++;
      countsByType[voxelType] = (countsByType[voxelType] || 0) + 1;
    }
  }

  if (solidCount < threshold) {
    return { solid: false };
  }

  var dominantType = VOXEL_TYPES.ROCK;
  var maxCount = 0;
  for (var typeStr in countsByType) {
    var count = countsByType[typeStr];
    if (count > maxCount) {
      maxCount = count;
      dominantType = parseInt(typeStr, 10);
    }
  }

  return {
    solid: true,
    voxelType: dominantType,
    solidCount: solidCount,
  };
}

export var FACE_DEFS = [
  {
    dir: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  {
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

export var NEIGHBOR_OFFSETS = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 1, dz: 0 },
  { dx: 0, dy: -1, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

export function buildCoarseLodGeometry(geoOptions) {
  var generator = geoOptions.generator;
  var blockSize = geoOptions.blockSize;
  var regionMinX = geoOptions.regionMinX;
  var regionMinY = geoOptions.regionMinY;
  var regionMinZ = geoOptions.regionMinZ;
  var cellsX = geoOptions.cellsX;
  var cellsY = geoOptions.cellsY;
  var cellsZ = geoOptions.cellsZ;
  var threshold = geoOptions.threshold;
  var samples = geoOptions.samples;
  var diagnostics = geoOptions.diagnostics || { generateVoxelCalls: 0 };

  var half = blockSize / 2;

  var haloSizeX = cellsX + 2;
  var haloSizeY = cellsY + 2;
  var haloSizeZ = cellsZ + 2;
  var haloLayerSize = haloSizeX * haloSizeY;

  // Store cell info: 0=empty, 1=solid (we only track type for solid cells)
  var solidGrid = new Uint8Array(haloSizeX * haloSizeY * haloSizeZ);
  var cellTypes = new Uint8Array(haloSizeX * haloSizeY * haloSizeZ);
  var solidCells = 0;
  var emptyCells = 0;

  for (var hz = -1; hz <= cellsZ; hz++) {
    for (var hy = -1; hy <= cellsY; hy++) {
      for (var hx = -1; hx <= cellsX; hx++) {
        var worldX = regionMinX + hx * blockSize;
        var worldY = regionMinY + hy * blockSize;
        var worldZ = regionMinZ + hz * blockSize;
        var sampleIdx =
          hx + 1 + (hy + 1) * haloSizeX + (hz + 1) * haloLayerSize;
        var result = sampleCoarseCell(
          generator,
          worldX,
          worldY,
          worldZ,
          blockSize,
          threshold,
          samples,
          diagnostics
        );
        solidGrid[sampleIdx] = result.solid ? 1 : 0;
        if (result.solid) {
          cellTypes[sampleIdx] = result.voxelType;
          solidCells++;
        } else {
          emptyCells++;
        }
      }
    }
  }

  var positions = [];
  var normals = [];
  var colors = [];
  var indices = [];
  var vertexCount = 0;
  var faceCount = 0;
  var borderNeighborChecks = 0;
  var borderFacesEmitted = 0;

  var surfaceBiomeBand =
    generator.config && generator.config.surfaceBiomeBand
      ? generator.config.surfaceBiomeBand
      : 1;

  for (var cz = 0; cz < cellsZ; cz++) {
    for (var cy = 0; cy < cellsY; cy++) {
      for (var cx = 0; cx < cellsX; cx++) {
        var cellIdx = cx + 1 + (cy + 1) * haloSizeX + (cz + 1) * haloLayerSize;
        if (solidGrid[cellIdx] === 0) continue;

        var voxelType = cellTypes[cellIdx];
        var localBX = cx * blockSize;
        var localBY = cy * blockSize;
        var localBZ = cz * blockSize;

        for (var fi = 0; fi < 6; fi++) {
          var dir = NEIGHBOR_OFFSETS[fi];
          var ni = cx + 1 + dir.dx;
          var nj = cy + 1 + dir.dy;
          var nk = cz + 1 + dir.dz;
          var neighborIdx = ni + nj * haloSizeX + nk * haloLayerSize;

          var isBorder =
            cx + dir.dx < 0 ||
            cx + dir.dx >= cellsX ||
            cy + dir.dy < 0 ||
            cy + dir.dy >= cellsY ||
            cz + dir.dz < 0 ||
            cz + dir.dz >= cellsZ;
          if (isBorder) borderNeighborChecks++;

          if (solidGrid[neighborIdx] !== 0) continue;
          if (isBorder) borderFacesEmitted++;

          var faceDef = FACE_DEFS[fi];

          // Face center in world coordinates for color sampling
          var faceCenterX =
            regionMinX + localBX + half + faceDef.dir[0] * (half - 1);
          var faceCenterY =
            regionMinY + localBY + half + faceDef.dir[1] * (half - 1);
          var faceCenterZ =
            regionMinZ + localBZ + half + faceDef.dir[2] * (half - 1);
          var featureInfo = generator.getFeatureInfo(
            faceCenterX,
            faceCenterY,
            faceCenterZ
          );

          var color = getTerrainSurfaceColor({
            voxelType: voxelType,
            worldX: faceCenterX,
            worldY: faceCenterY,
            worldZ: faceCenterZ,
            normalX: faceDef.dir[0],
            normalY: faceDef.dir[1],
            normalZ: faceDef.dir[2],
            biomeId: featureInfo.biomeId,
            featureInfo: featureInfo,
            surfaceBiomeBand: surfaceBiomeBand,
          });

          for (var vi = 0; vi < 4; vi++) {
            var corner = faceDef.corners[vi];
            positions.push(
              localBX + corner[0] * blockSize,
              localBY + corner[1] * blockSize,
              localBZ + corner[2] * blockSize
            );
            normals.push(faceDef.dir[0], faceDef.dir[1], faceDef.dir[2]);
            colors.push(color[0], color[1], color[2]);
          }

          indices.push(
            vertexCount,
            vertexCount + 1,
            vertexCount + 2,
            vertexCount,
            vertexCount + 2,
            vertexCount + 3
          );
          vertexCount += 4;
          faceCount++;
        }
      }
    }
  }

  return {
    positions: positions,
    normals: normals,
    colors: colors,
    indices: indices,
    faceCount: faceCount,
    diagnostics: {
      solidCells: solidCells,
      emptyCells: emptyCells,
      cellsX: cellsX,
      cellsY: cellsY,
      cellsZ: cellsZ,
      borderNeighborChecks: borderNeighborChecks,
      borderFacesEmitted: borderFacesEmitted,
    },
  };
}
