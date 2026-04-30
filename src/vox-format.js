import * as THREE from 'three';

function readChunkHeader(dataView, offset) {
  const id = String.fromCharCode(
    dataView.getUint8(offset),
    dataView.getUint8(offset + 1),
    dataView.getUint8(offset + 2),
    dataView.getUint8(offset + 3)
  );
  const contentSize = dataView.getUint32(offset + 4, true);
  const childrenSize = dataView.getUint32(offset + 8, true);

  return {
    id,
    contentSize,
    childrenSize,
    contentOffset: offset + 12,
    nextOffset: offset + 12 + contentSize + childrenSize,
    childrenOffset: offset + 12 + contentSize,
  };
}

function parsePalette(dataView, offset) {
  const palette = new Array(256).fill(null);
  let cursor = offset;

  for (let i = 1; i < 256; i++) {
    const r = dataView.getUint8(cursor++);
    const g = dataView.getUint8(cursor++);
    const b = dataView.getUint8(cursor++);
    const a = dataView.getUint8(cursor++);
    palette[i] = new THREE.Color(r / 255, g / 255, b / 255);
    palette[i].userData = { alpha: a / 255 };
  }

  return palette;
}

function createDefaultPalette() {
  const palette = new Array(256).fill(null);

  palette[1] = new THREE.Color(1, 1, 1);
  palette[2] = new THREE.Color(0.75, 0.75, 0.75);
  palette[3] = new THREE.Color(0.5, 0.5, 0.5);
  palette[4] = new THREE.Color(0.2, 0.2, 0.2);
  palette[5] = new THREE.Color(0.24, 0.8, 0.72);
  palette[6] = new THREE.Color(1.0, 0.64, 0.28);
  palette[7] = new THREE.Color(0.56, 1.0, 0.78);
  palette[8] = new THREE.Color(0.62, 0.88, 1.0);

  return palette;
}

function mapPaletteColorToMaterial(color) {
  if (!color) {
    return 'metal';
  }

  const hsl = {};
  color.getHSL(hsl);

  if (hsl.l < 0.18) {
    return 'dark';
  }

  if (hsl.s < 0.12 && hsl.l > 0.56) {
    return 'paleCyan';
  }

  if (hsl.s < 0.16) {
    return 'metal';
  }

  if (hsl.h > 0.08 && hsl.h < 0.14) {
    return hsl.l > 0.62 ? 'amberGlow' : 'amber';
  }

  if (hsl.h > 0.32 && hsl.h < 0.43) {
    return hsl.l > 0.62 ? 'mossGlow' : 'moss';
  }

  if (hsl.h > 0.46 && hsl.h < 0.6) {
    return hsl.l > 0.72 ? 'paleCyan' : 'cyan';
  }

  if (hsl.h > 0.56 && hsl.h < 0.67) {
    return 'crystal';
  }

  return hsl.l > 0.55 ? 'paleCyan' : 'metal';
}

function normalizeVoxels(voxels, size) {
  const minX = 0;
  const minZ = 0;
  const maxX = Math.max(0, size.x - 1);
  const maxZ = Math.max(0, size.z - 1);
  const centerX = Math.round((minX + maxX) * 0.5);
  const centerZ = Math.round((minZ + maxZ) * 0.5);

  return voxels.map(function (voxel) {
    return {
      x: voxel.x - centerX,
      y: voxel.z,
      z: voxel.y - centerZ,
      materialKey: voxel.materialKey,
      color: voxel.color,
    };
  });
}

export function parseMagicaVoxel(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);

  if (
    String.fromCharCode(
      dataView.getUint8(0),
      dataView.getUint8(1),
      dataView.getUint8(2),
      dataView.getUint8(3)
    ) !== 'VOX '
  ) {
    throw new Error('Unsupported VOX file header');
  }

  const version = dataView.getUint32(4, true);
  if (version < 150) {
    throw new Error(`Unsupported VOX version: ${version}`);
  }

  const mainChunk = readChunkHeader(dataView, 8);
  if (mainChunk.id !== 'MAIN') {
    throw new Error('VOX file is missing MAIN chunk');
  }

  let cursor = mainChunk.childrenOffset;
  let palette = createDefaultPalette();
  let size = { x: 1, y: 1, z: 1 };
  let voxels = [];

  while (cursor < mainChunk.nextOffset) {
    const chunk = readChunkHeader(dataView, cursor);

    if (chunk.id === 'SIZE') {
      size = {
        x: dataView.getUint32(chunk.contentOffset, true),
        y: dataView.getUint32(chunk.contentOffset + 4, true),
        z: dataView.getUint32(chunk.contentOffset + 8, true),
      };
    } else if (chunk.id === 'XYZI') {
      const count = dataView.getUint32(chunk.contentOffset, true);
      let voxelOffset = chunk.contentOffset + 4;
      voxels = [];

      for (let i = 0; i < count; i++) {
        const x = dataView.getUint8(voxelOffset++);
        const y = dataView.getUint8(voxelOffset++);
        const z = dataView.getUint8(voxelOffset++);
        const colorIndex = dataView.getUint8(voxelOffset++);
        const color = palette[colorIndex] || new THREE.Color(1, 1, 1);

        voxels.push({
          x,
          y,
          z,
          materialKey: mapPaletteColorToMaterial(color),
          color: color.clone(),
        });
      }
    } else if (chunk.id === 'RGBA') {
      palette = parsePalette(dataView, chunk.contentOffset);
    }

    cursor = chunk.nextOffset;
  }

  return {
    voxelSize: null,
    anchor: 'bottomCenter',
    voxels: normalizeVoxels(voxels, size),
  };
}
