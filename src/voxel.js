import { isCrystalVoxelType } from './voxel-types.js';
import { isVoxelRenderable } from './voxel-materials.js';
import { CHUNK_SIZE_VOXELS, WORLD_UNITS_PER_VOXEL } from './world-units.js';

const PENDING_CLEAR_TO_BASE = 1;

function generateChunk(size) {
  return new Uint8Array(size * size * size);
}

function createChunkRecord(size, chunkX, chunkY, chunkZ, baseData = null) {
  return {
    chunkX,
    chunkY,
    chunkZ,
    baseData,
    deltaData: generateChunk(size),
    runtimeDeltaCount: 0,
    pendingData: null,
    pendingIndexFlags: null,
    pendingIndices: [],
    pendingReadIndex: 0,
    pendingEditCount: 0,
  };
}

function getChunkRecordAt(world, chunkX, chunkY, chunkZ) {
  const cache = world.chunkLookupCache;

  if (cache && cache.x === chunkX && cache.y === chunkY && cache.z === chunkZ) {
    return cache.record;
  }

  const xColumn = world.chunkColumns.get(chunkX);
  const yColumn = xColumn ? xColumn.get(chunkY) : null;
  const record = yColumn ? yColumn.get(chunkZ) || null : null;

  if (cache) {
    cache.x = chunkX;
    cache.y = chunkY;
    cache.z = chunkZ;
    cache.record = record;
  }

  return record;
}

function setChunkRecordAt(world, chunkX, chunkY, chunkZ, record) {
  let xColumn = world.chunkColumns.get(chunkX);
  if (!xColumn) {
    xColumn = new Map();
    world.chunkColumns.set(chunkX, xColumn);
  }

  let yColumn = xColumn.get(chunkY);
  if (!yColumn) {
    yColumn = new Map();
    xColumn.set(chunkY, yColumn);
  }

  yColumn.set(chunkZ, record);

  const cache = world.chunkLookupCache;
  if (cache) {
    cache.x = chunkX;
    cache.y = chunkY;
    cache.z = chunkZ;
    cache.record = record;
  }
}

function deleteChunkRecordAt(world, chunkX, chunkY, chunkZ) {
  const xColumn = world.chunkColumns.get(chunkX);
  if (!xColumn) {
    return;
  }

  const yColumn = xColumn.get(chunkY);
  if (!yColumn) {
    return;
  }

  yColumn.delete(chunkZ);
  if (yColumn.size === 0) {
    xColumn.delete(chunkY);
  }

  if (xColumn.size === 0) {
    world.chunkColumns.delete(chunkX);
  }

  const cache = world.chunkLookupCache;
  if (cache && cache.x === chunkX && cache.y === chunkY && cache.z === chunkZ) {
    cache.record = null;
  }
}

function chunkKey(x, y, z) {
  return `${x},${y},${z}`;
}

function parseChunkKey(key) {
  const parts = key.split(',').map(Number);
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function encodeDeltaValue(value) {
  return value + 1;
}

function decodeDeltaValue(value) {
  return value - 1;
}

function encodePendingValue(value) {
  return value + 2;
}

function decodePendingValue(value) {
  return value - 2;
}

function getChunkCoords(world, x, y, z) {
  return {
    x: Math.floor(x / world.chunkSize),
    y: Math.floor(y / world.chunkSize),
    z: Math.floor(z / world.chunkSize),
  };
}

function getLocalVoxelCoords(world, x, y, z) {
  const localX = Math.floor(x % world.chunkSize);
  const localY = Math.floor(y % world.chunkSize);
  const localZ = Math.floor(z % world.chunkSize);

  return {
    x: localX < 0 ? localX + world.chunkSize : localX,
    y: localY < 0 ? localY + world.chunkSize : localY,
    z: localZ < 0 ? localZ + world.chunkSize : localZ,
  };
}

function getVoxelOffset(world, localX, localY, localZ) {
  return (
    localX +
    localY * world.chunkSize +
    localZ * world.chunkSize * world.chunkSize
  );
}

function getLocalCoordsFromOffset(world, index) {
  const layerSize = world.chunkSize * world.chunkSize;
  const z = Math.floor(index / layerSize);
  const remainder = index - z * layerSize;
  const y = Math.floor(remainder / world.chunkSize);
  const x = remainder - y * world.chunkSize;

  return { x, y, z };
}

function ensureChunkRecord(world, chunkX, chunkY, chunkZ) {
  const key = chunkKey(chunkX, chunkY, chunkZ);
  let record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);

  if (!record) {
    record = createChunkRecord(world.chunkSize, chunkX, chunkY, chunkZ);
    setChunkRecordAt(world, chunkX, chunkY, chunkZ, record);
    world.chunks.set(key, record);
  }

  return record;
}

function ensurePendingEditBuffers(world, record) {
  if (record.pendingData && record.pendingIndexFlags) {
    return;
  }

  const chunkVolume = world.chunkSize * world.chunkSize * world.chunkSize;
  record.pendingData = new Uint8Array(chunkVolume);
  record.pendingIndexFlags = new Uint8Array(chunkVolume);
}

function getBaseVoxelValue(world, record, voxelX, voxelY, voxelZ, voxelOffset) {
  if (record && record.baseData) {
    return record.baseData[voxelOffset];
  }

  if (typeof world.fallbackVoxel === 'function') {
    return world.fallbackVoxel(voxelX, voxelY, voxelZ);
  }

  return 0;
}

function getEffectiveVoxelValue(
  world,
  record,
  voxelX,
  voxelY,
  voxelZ,
  voxelOffset,
  baseValue = null
) {
  const resolvedBaseValue =
    baseValue == null
      ? getBaseVoxelValue(world, record, voxelX, voxelY, voxelZ, voxelOffset)
      : baseValue;

  if (record && record.pendingData) {
    const pendingValue = record.pendingData[voxelOffset];

    if (pendingValue === PENDING_CLEAR_TO_BASE) {
      return resolvedBaseValue;
    }

    if (pendingValue !== 0) {
      return decodePendingValue(pendingValue);
    }
  }

  if (record) {
    const deltaValue = record.deltaData[voxelOffset];

    if (deltaValue !== 0) {
      return decodeDeltaValue(deltaValue);
    }
  }

  return resolvedBaseValue;
}

function maybeDeleteChunkRecord(world, key, record) {
  if (!record) {
    return;
  }

  if (record.baseData) {
    return;
  }

  if (record.runtimeDeltaCount > 0 || record.pendingEditCount > 0) {
    return;
  }

  world.chunks.delete(key);
  deleteChunkRecordAt(world, record.chunkX, record.chunkY, record.chunkZ);
}

function updateDirtyChunkCount(world) {
  if (!world.performanceStats) {
    return;
  }

  world.performanceStats.dirtyChunks =
    world.modifiedChunks.size + world.pendingEditChunkKeys.size;
}

function trackRuntimeVoxelEdit(world, key, voxelX, voxelY, voxelZ, value) {
  if (!world.runtimeEditsByChunk) {
    return;
  }

  let chunkEdits = world.runtimeEditsByChunk.get(key);
  if (!chunkEdits) {
    chunkEdits = new Map();
    world.runtimeEditsByChunk.set(key, chunkEdits);
  }

  chunkEdits.set(`${voxelX},${voxelY},${voxelZ}`, {
    x: voxelX,
    y: voxelY,
    z: voxelZ,
    value,
  });
}

function clearTrackedRuntimeVoxelEdit(world, key, voxelX, voxelY, voxelZ) {
  if (!world.runtimeEditsByChunk) {
    return;
  }

  const chunkEdits = world.runtimeEditsByChunk.get(key);
  if (!chunkEdits) {
    return;
  }

  chunkEdits.delete(`${voxelX},${voxelY},${voxelZ}`);
  if (chunkEdits.size === 0) {
    world.runtimeEditsByChunk.delete(key);
  }
}

function markModifiedChunk(world, chunkX, chunkY, chunkZ) {
  world.modifiedChunks.add(chunkKey(chunkX, chunkY, chunkZ));
  updateDirtyChunkCount(world);
}

function markModifiedVoxelChunks(world, chunkCoords, localCoords) {
  markModifiedChunk(world, chunkCoords.x, chunkCoords.y, chunkCoords.z);

  if (localCoords.x === 0) {
    markModifiedChunk(world, chunkCoords.x - 1, chunkCoords.y, chunkCoords.z);
  } else if (localCoords.x === world.chunkSize - 1) {
    markModifiedChunk(world, chunkCoords.x + 1, chunkCoords.y, chunkCoords.z);
  }

  if (localCoords.y === 0) {
    markModifiedChunk(world, chunkCoords.x, chunkCoords.y - 1, chunkCoords.z);
  } else if (localCoords.y === world.chunkSize - 1) {
    markModifiedChunk(world, chunkCoords.x, chunkCoords.y + 1, chunkCoords.z);
  }

  if (localCoords.z === 0) {
    markModifiedChunk(world, chunkCoords.x, chunkCoords.y, chunkCoords.z - 1);
  } else if (localCoords.z === world.chunkSize - 1) {
    markModifiedChunk(world, chunkCoords.x, chunkCoords.y, chunkCoords.z + 1);
  }
}

export function hasRuntimeVoxelDeltasInChunk(world, chunkX, chunkY, chunkZ) {
  const record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);

  return Boolean(
    record && (record.runtimeDeltaCount > 0 || record.pendingEditCount > 0)
  );
}

export function getVoxelSize(world) {
  return typeof world.voxelSize === 'number' ? world.voxelSize : 1;
}

export function voxelToWorldCoord(world, value) {
  return value * getVoxelSize(world);
}

export function worldToVoxelCoord(world, value) {
  return value / getVoxelSize(world);
}

export function getChunkWorldSize(world) {
  return world.chunkSize * getVoxelSize(world);
}

export function createSparseWorld(
  chunkSize = CHUNK_SIZE_VOXELS,
  voxelSize = WORLD_UNITS_PER_VOXEL
) {
  const world = {
    chunks: new Map(),
    chunkColumns: new Map(),
    chunkSize,
    voxelSize,
    chunkLookupCache: {
      x: null,
      y: null,
      z: null,
      record: null,
    },
    loadedChunks: new Set(),
    modifiedChunks: new Set(),
    pendingEditChunkKeys: new Set(),
    pendingEditChunkQueue: [],
    runtimeLimits: {
      maxVoxelEditsPerFrame: 96,
      maxRaycastsPerFrame: 220,
      maxCriticalRaycastsPerFrame: 160,
      maxLowPriorityRaycastsPerFrame: 48,
    },
    performanceStats: {
      activeProjectiles: 0,
      raycastsPerFrame: 0,
      voxelEditsPerFrame: 0,
      dirtyChunks: 0,
      remeshedChunksPerFrame: 0,
      particleCount: 0,
    },
    runtimeEditsByChunk: new Map(),
    fallbackVoxel: null,
    getBiomeType: null,
  };

  updateDirtyChunkCount(world);

  return world;
}

export function getChunk(world, chunkX, chunkY, chunkZ) {
  const record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);
  return record && record.baseData ? record.baseData : null;
}

export function setChunk(world, chunkX, chunkY, chunkZ, chunkData) {
  const key = chunkKey(chunkX, chunkY, chunkZ);
  const record = ensureChunkRecord(world, chunkX, chunkY, chunkZ);

  record.baseData = chunkData;
  world.loadedChunks.add(key);
}

export function hasChunk(world, chunkX, chunkY, chunkZ) {
  const record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);
  return Boolean(record && record.baseData);
}

export function removeChunk(world, chunkX, chunkY, chunkZ) {
  const key = chunkKey(chunkX, chunkY, chunkZ);
  const record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);

  if (record) {
    record.baseData = null;
    maybeDeleteChunkRecord(world, key, record);
  }

  world.loadedChunks.delete(key);
  world.modifiedChunks.delete(key);
  updateDirtyChunkCount(world);
}

export function getRuntimeVoxelEditsForChunk(world, chunkX, chunkY, chunkZ) {
  const chunkEdits = world.runtimeEditsByChunk.get(
    chunkKey(chunkX, chunkY, chunkZ)
  );

  if (!chunkEdits || chunkEdits.size === 0) {
    return [];
  }

  return Array.from(chunkEdits.values());
}

export function setVoxel(world, x, y, z, v) {
  const chunkCoords = getChunkCoords(world, x, y, z);
  const key = chunkKey(chunkCoords.x, chunkCoords.y, chunkCoords.z);
  const record = ensureChunkRecord(
    world,
    chunkCoords.x,
    chunkCoords.y,
    chunkCoords.z
  );

  if (!record.baseData) {
    record.baseData = generateChunk(world.chunkSize);
    world.loadedChunks.add(key);
  }

  const localCoords = getLocalVoxelCoords(world, x, y, z);
  const voxelOffset = getVoxelOffset(
    world,
    localCoords.x,
    localCoords.y,
    localCoords.z
  );

  const oldValue = getVoxel(world, x, y, z);
  record.baseData[voxelOffset] = v;

  const deltaValue = record.deltaData[voxelOffset];
  if (deltaValue !== 0 && decodeDeltaValue(deltaValue) === v) {
    record.deltaData[voxelOffset] = 0;
    record.runtimeDeltaCount = Math.max(0, record.runtimeDeltaCount - 1);
  }

  if (oldValue !== v) {
    markModifiedVoxelChunks(world, chunkCoords, localCoords);
  }
}

export function queueRuntimeVoxelEdit(world, x, y, z, v) {
  const voxelX = Math.floor(x);
  const voxelY = Math.floor(y);
  const voxelZ = Math.floor(z);
  const chunkCoords = getChunkCoords(world, voxelX, voxelY, voxelZ);
  const localCoords = getLocalVoxelCoords(world, voxelX, voxelY, voxelZ);
  const voxelOffset = getVoxelOffset(
    world,
    localCoords.x,
    localCoords.y,
    localCoords.z
  );
  const record = ensureChunkRecord(
    world,
    chunkCoords.x,
    chunkCoords.y,
    chunkCoords.z
  );
  const baseValue = getBaseVoxelValue(
    world,
    record,
    voxelX,
    voxelY,
    voxelZ,
    voxelOffset
  );
  const oldValue = getEffectiveVoxelValue(
    world,
    record,
    voxelX,
    voxelY,
    voxelZ,
    voxelOffset,
    baseValue
  );

  if (oldValue === v) {
    return false;
  }

  ensurePendingEditBuffers(world, record);

  if (record.pendingIndexFlags[voxelOffset] === 0) {
    record.pendingIndexFlags[voxelOffset] = 1;
    record.pendingIndices.push(voxelOffset);
    record.pendingEditCount++;
  }

  record.pendingData[voxelOffset] =
    v === baseValue ? PENDING_CLEAR_TO_BASE : encodePendingValue(v);

  const key = chunkKey(chunkCoords.x, chunkCoords.y, chunkCoords.z);

  if (!world.pendingEditChunkKeys.has(key)) {
    world.pendingEditChunkKeys.add(key);
    world.pendingEditChunkQueue.push(key);
  }

  updateDirtyChunkCount(world);
  return true;
}

export function setRuntimeVoxel(world, x, y, z, v) {
  return queueRuntimeVoxelEdit(world, x, y, z, v);
}

export function flushQueuedVoxelEdits(
  world,
  maxVoxelEditsPerFrame = world.runtimeLimits.maxVoxelEditsPerFrame
) {
  let appliedEdits = 0;

  while (
    appliedEdits < maxVoxelEditsPerFrame &&
    world.pendingEditChunkQueue.length > 0
  ) {
    const key = world.pendingEditChunkQueue[0];
    const chunkCoords = parseChunkKey(key);
    const record = getChunkRecordAt(
      world,
      chunkCoords.x,
      chunkCoords.y,
      chunkCoords.z
    );

    if (!record || record.pendingEditCount <= 0) {
      world.pendingEditChunkQueue.shift();
      world.pendingEditChunkKeys.delete(key);
      maybeDeleteChunkRecord(world, key, record);
      continue;
    }

    const pendingIndex = record.pendingIndices[record.pendingReadIndex];
    record.pendingReadIndex++;

    if (pendingIndex == null || record.pendingIndexFlags[pendingIndex] === 0) {
      continue;
    }

    const pendingValue = record.pendingData[pendingIndex];
    record.pendingData[pendingIndex] = 0;
    record.pendingIndexFlags[pendingIndex] = 0;
    record.pendingEditCount = Math.max(0, record.pendingEditCount - 1);

    const localCoords = getLocalCoordsFromOffset(world, pendingIndex);
    const voxelX = record.chunkX * world.chunkSize + localCoords.x;
    const voxelY = record.chunkY * world.chunkSize + localCoords.y;
    const voxelZ = record.chunkZ * world.chunkSize + localCoords.z;
    const nextDeltaValue =
      pendingValue === PENDING_CLEAR_TO_BASE
        ? 0
        : encodeDeltaValue(decodePendingValue(pendingValue));
    const previousDeltaValue = record.deltaData[pendingIndex];

    if (previousDeltaValue !== nextDeltaValue) {
      if (previousDeltaValue === 0) {
        record.runtimeDeltaCount++;
      } else if (nextDeltaValue === 0) {
        record.runtimeDeltaCount = Math.max(0, record.runtimeDeltaCount - 1);
      }

      record.deltaData[pendingIndex] = nextDeltaValue;
      if (nextDeltaValue === 0) {
        clearTrackedRuntimeVoxelEdit(world, key, voxelX, voxelY, voxelZ);
      } else {
        trackRuntimeVoxelEdit(
          world,
          key,
          voxelX,
          voxelY,
          voxelZ,
          decodeDeltaValue(nextDeltaValue)
        );
      }
      markModifiedVoxelChunks(
        world,
        getChunkCoords(world, voxelX, voxelY, voxelZ),
        localCoords
      );
      appliedEdits++;

      if (world.performanceStats) {
        world.performanceStats.voxelEditsPerFrame++;
      }
    }

    if (record.pendingEditCount > 0) {
      continue;
    }

    record.pendingIndices.length = 0;
    record.pendingReadIndex = 0;
    world.pendingEditChunkQueue.shift();
    world.pendingEditChunkKeys.delete(key);
    maybeDeleteChunkRecord(world, key, record);
  }

  updateDirtyChunkCount(world);
  return appliedEdits;
}

export function resetWorldPerformanceStats(world) {
  if (!world || !world.performanceStats) {
    return;
  }

  world.performanceStats.activeProjectiles = 0;
  world.performanceStats.raycastsPerFrame = 0;
  world.performanceStats.voxelEditsPerFrame = 0;
  world.performanceStats.dirtyChunks =
    world.modifiedChunks.size + world.pendingEditChunkKeys.size;
  world.performanceStats.remeshedChunksPerFrame = 0;
  world.performanceStats.particleCount = 0;
}

export function getVoxel(world, x, y, z) {
  const voxelX = Math.floor(x);
  const voxelY = Math.floor(y);
  const voxelZ = Math.floor(z);
  const chunkCoords = getChunkCoords(world, voxelX, voxelY, voxelZ);
  const record = getChunkRecordAt(
    world,
    chunkCoords.x,
    chunkCoords.y,
    chunkCoords.z
  );

  const localCoords = getLocalVoxelCoords(world, voxelX, voxelY, voxelZ);
  const voxelOffset = getVoxelOffset(
    world,
    localCoords.x,
    localCoords.y,
    localCoords.z
  );

  return getEffectiveVoxelValue(
    world,
    record,
    voxelX,
    voxelY,
    voxelZ,
    voxelOffset
  );
}

export function getChunkVoxel(
  world,
  chunkX,
  chunkY,
  chunkZ,
  localX,
  localY,
  localZ
) {
  const record = getChunkRecordAt(world, chunkX, chunkY, chunkZ);
  const voxelOffset = getVoxelOffset(world, localX, localY, localZ);
  const voxelX = chunkX * world.chunkSize + localX;
  const voxelY = chunkY * world.chunkSize + localY;
  const voxelZ = chunkZ * world.chunkSize + localZ;

  return getEffectiveVoxelValue(
    world,
    record,
    voxelX,
    voxelY,
    voxelZ,
    voxelOffset
  );
}

export function generateGeometryDataForChunk(world, chunkX, chunkY, chunkZ) {
  const { chunkSize } = world;
  const voxelSize = getVoxelSize(world);
  const positions = [];
  const normals = [];
  const indices = [];
  const voxelTypes = [];
  const startX = chunkX * chunkSize;
  const startY = chunkY * chunkSize;
  const startZ = chunkZ * chunkSize;
  const mask = new Int16Array(chunkSize * chunkSize);
  const meshQuery = {
    chunkX: null,
    chunkY: null,
    chunkZ: null,
    record: null,
  };

  function getVoxelForMeshing(voxelX, voxelY, voxelZ) {
    const voxelChunkX = Math.floor(voxelX / chunkSize);
    const voxelChunkY = Math.floor(voxelY / chunkSize);
    const voxelChunkZ = Math.floor(voxelZ / chunkSize);

    if (
      meshQuery.chunkX !== voxelChunkX ||
      meshQuery.chunkY !== voxelChunkY ||
      meshQuery.chunkZ !== voxelChunkZ
    ) {
      meshQuery.chunkX = voxelChunkX;
      meshQuery.chunkY = voxelChunkY;
      meshQuery.chunkZ = voxelChunkZ;
      meshQuery.record = getChunkRecordAt(
        world,
        voxelChunkX,
        voxelChunkY,
        voxelChunkZ
      );
    }

    const localCoords = getLocalVoxelCoords(world, voxelX, voxelY, voxelZ);
    const voxelOffset = getVoxelOffset(
      world,
      localCoords.x,
      localCoords.y,
      localCoords.z
    );

    return getEffectiveVoxelValue(
      world,
      meshQuery.record,
      voxelX,
      voxelY,
      voxelZ,
      voxelOffset
    );
  }

  function addQuad(origin, du, dv, normal, voxelType) {
    const ndx = positions.length / 3;
    const corners =
      normal.x + normal.y + normal.z > 0
        ? [
            origin,
            [origin[0] + du[0], origin[1] + du[1], origin[2] + du[2]],
            [origin[0] + dv[0], origin[1] + dv[1], origin[2] + dv[2]],
            [
              origin[0] + du[0] + dv[0],
              origin[1] + du[1] + dv[1],
              origin[2] + du[2] + dv[2],
            ],
          ]
        : [
            origin,
            [origin[0] + dv[0], origin[1] + dv[1], origin[2] + dv[2]],
            [origin[0] + du[0], origin[1] + du[1], origin[2] + du[2]],
            [
              origin[0] + du[0] + dv[0],
              origin[1] + du[1] + dv[1],
              origin[2] + du[2] + dv[2],
            ],
          ];

    for (const corner of corners) {
      positions.push(
        corner[0] * voxelSize,
        corner[1] * voxelSize,
        corner[2] * voxelSize
      );
      normals.push(normal.x, normal.y, normal.z);
    }

    indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
    voxelTypes.push(voxelType);
  }

  // Greedy meshing for normal terrain keeps chunk geometry compact.
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3;
    const v = (d + 2) % 3;
    const x = [0, 0, 0];
    const q = [0, 0, 0];
    q[d] = 1;

    for (x[d] = -1; x[d] < chunkSize; ) {
      let n = 0;

      for (x[v] = 0; x[v] < chunkSize; x[v]++) {
        for (x[u] = 0; x[u] < chunkSize; x[u]++) {
          let a = getVoxelForMeshing(
            startX + x[0],
            startY + x[1],
            startZ + x[2]
          );
          let b = getVoxelForMeshing(
            startX + x[0] + q[0],
            startY + x[1] + q[1],
            startZ + x[2] + q[2]
          );

          if (isCrystalVoxelType(a)) {
            a = 0;
          }
          if (isCrystalVoxelType(b)) {
            b = 0;
          }

          if (isVoxelRenderable(a) && !isVoxelRenderable(b)) {
            mask[n] = a;
          } else if (isVoxelRenderable(b) && !isVoxelRenderable(a)) {
            mask[n] = -b;
          } else {
            mask[n] = 0;
          }

          n++;
        }
      }

      x[d]++;
      n = 0;

      for (let j = 0; j < chunkSize; j++) {
        for (let i = 0; i < chunkSize; ) {
          const voxelType = mask[n];
          if (!voxelType) {
            i++;
            n++;
            continue;
          }

          let width = 1;
          while (i + width < chunkSize && mask[n + width] === voxelType) {
            width++;
          }

          let height = 1;
          let canGrow = true;
          while (j + height < chunkSize && canGrow) {
            for (let k = 0; k < width; k++) {
              if (mask[n + k + height * chunkSize] !== voxelType) {
                canGrow = false;
                break;
              }
            }

            if (canGrow) {
              height++;
            }
          }

          const origin = [x[0], x[1], x[2]];
          const du = [0, 0, 0];
          const dv = [0, 0, 0];
          const normal = { x: 0, y: 0, z: 0 };
          du[u] = width;
          dv[v] = height;
          normal[['x', 'y', 'z'][d]] = voxelType > 0 ? 1 : -1;
          origin[u] = i;
          origin[v] = j;

          addQuad(origin, du, dv, normal, Math.abs(voxelType));

          for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
              mask[n + col + row * chunkSize] = 0;
            }
          }

          i += width;
          n += width;
        }
      }
    }
  }

  // Keep crystal voxels face-by-face so their silhouettes stay chunky and
  // irregular instead of collapsing into large smooth quads.
  for (let y = 0; y < chunkSize; ++y) {
    const voxelY = startY + y;
    for (let z = 0; z < chunkSize; ++z) {
      const voxelZ = startZ + z;
      for (let x = 0; x < chunkSize; ++x) {
        const voxelX = startX + x;
        const voxel = getVoxelForMeshing(voxelX, voxelY, voxelZ);
        if (!isCrystalVoxelType(voxel)) {
          continue;
        }

        for (const { dir, corners } of faces) {
          const ndx = positions.length / 3;
          for (const pos of corners) {
            positions.push(
              (pos[0] + x) * voxelSize,
              (pos[1] + y) * voxelSize,
              (pos[2] + z) * voxelSize
            );
            normals.push(...dir);
          }
          indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
          voxelTypes.push(voxel);
        }
      }
    }
  }

  return {
    positions,
    normals,
    indices,
    voxelTypes,
  };
}

export const faces = [
  {
    // left
    dir: [-1, 0, 0],
    corners: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
  },
  {
    // right
    dir: [1, 0, 0],
    corners: [
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
  {
    // bottom
    dir: [0, -1, 0],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
  },
  {
    // top
    dir: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    // back
    dir: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    // front
    dir: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
  },
];
