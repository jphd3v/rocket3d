import * as THREE from 'three';
import {
  flushQueuedVoxelEdits,
  generateGeometryDataForChunk,
  getChunkVoxel,
  getChunkWorldSize,
  getRuntimeVoxelEditsForChunk,
  hasRuntimeVoxelDeltasInChunk,
  setChunk,
  getChunk,
  removeChunk,
  voxelToWorldCoord,
} from './voxel.js';
import { createTerrainGenerator } from './terrain-generation.js';
import { initializeTerrainWorkers } from './worker-interface.js';
import { VOXEL_TYPES, isLightVoxelType } from './voxel-types.js';
import { isVoxelTransparent } from './voxel-materials.js';
import { CHUNK_SIZE_VOXELS } from './world-units.js';
import { getTerrainSurfaceColor } from './lod/terrain-color.js';
import { debugError, debugWarn } from './debug.js';

// Chunk states
export const ChunkState = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  LOADED: 'loaded',
  MESHING: 'meshing',
  MESHED: 'meshed',
  UNLOADING: 'unloading',
  ERROR: 'error',
};

function noop() {}

// Helper functions for chunk keys
export function chunkKey(x, y, z) {
  return `${x},${y},${z}`;
}

export function parseChunkKey(key) {
  const parts = key.split(',').map(Number);
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function getBiomeAwareLightSettings(voxelType) {
  if (voxelType === VOXEL_TYPES.CRYSTAL_EMERALD) {
    return {
      color: 0x42ffd4,
      intensity: 3.8,
      distance: 18,
      amplitude: 0.55,
      speed: 1.1,
    };
  }

  if (voxelType === VOXEL_TYPES.CRYSTAL_SAPPHIRE) {
    return {
      color: 0x558cff,
      intensity: 3.5,
      distance: 17,
      amplitude: 0.45,
      speed: 0.9,
    };
  }

  if (voxelType === VOXEL_TYPES.CRYSTAL_AQUAMARINE) {
    return {
      color: 0x72e8ff,
      intensity: 3.6,
      distance: 18,
      amplitude: 0.5,
      speed: 1.0,
    };
  }

  if (voxelType === VOXEL_TYPES.CRYSTAL_AMETHYST) {
    return {
      color: 0xd982ff,
      intensity: 3.4,
      distance: 17,
      amplitude: 0.5,
      speed: 1.2,
    };
  }

  if (voxelType === VOXEL_TYPES.EMBER_VENT) {
    return {
      color: 0xff8c42,
      intensity: 7.5,
      distance: 26,
      amplitude: 1.8,
      speed: 3.2,
    };
  }

  if (voxelType === VOXEL_TYPES.LAMP) {
    return {
      color: 0xffe0a8,
      intensity: 6.5,
      distance: 24,
      amplitude: 0.8,
      speed: 1.8,
    };
  }

  return {
    color: 0x9affcc,
    intensity: 6.4,
    distance: 26,
    amplitude: 0.9,
    speed: 0.9,
  };
}

const BIOME_LIGHT_SELECTION_INTERVAL_MS = 200;

function updateAnimatedLights(chunkManager, playerPosition, timeSeconds) {
  if (chunkManager.biomeLightsEnabled === false) {
    return;
  }

  const currentTimeMs = performance.now();
  const shouldScan =
    !chunkManager.lastLightScanTime ||
    currentTimeMs - chunkManager.lastLightScanTime >=
      BIOME_LIGHT_SELECTION_INTERVAL_MS;

  if (shouldScan) {
    chunkManager.lastLightScanTime = currentTimeMs;

    const staleLights = [];
    const candidateLights = [];
    const maxDistanceSq =
      chunkManager.biomeLightRange * chunkManager.biomeLightRange;

    for (const light of chunkManager.animatedLights) {
      if (!light.parent || !light.parent.parent) {
        staleLights.push(light);
        continue;
      }

      const animation = light.userData.animation;
      if (!animation) {
        continue;
      }

      light.visible = false;
      light.intensity = 0;

      if (!playerPosition || !light.parent.visible) {
        continue;
      }

      const worldX = light.parent.position.x + light.position.x;
      const worldY = light.parent.position.y + light.position.y;
      const worldZ = light.parent.position.z + light.position.z;
      const dx = worldX - playerPosition.x;
      const dy = worldY - playerPosition.y;
      const dz = worldZ - playerPosition.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;

      if (distanceSq > maxDistanceSq) {
        continue;
      }

      candidateLights.push({
        light,
        distanceSq,
        animation,
      });
    }

    candidateLights.sort(function (a, b) {
      return a.distanceSq - b.distanceSq;
    });

    const activeLightCount = Math.min(
      chunkManager.biomeLightBudget,
      candidateLights.length
    );

    // Store active lights for per-frame animation
    chunkManager.activeAnimatedLights = [];
    for (let i = 0; i < activeLightCount; i++) {
      const candidate = candidateLights[i];
      candidate.light.visible = true;
      chunkManager.activeAnimatedLights.push(candidate);
    }

    for (const light of staleLights) {
      chunkManager.animatedLights.delete(light);
    }
  }

  // Animate active lights every frame
  if (chunkManager.activeAnimatedLights) {
    for (let i = 0; i < chunkManager.activeAnimatedLights.length; i++) {
      const active = chunkManager.activeAnimatedLights[i];
      active.light.intensity =
        active.animation.base +
        Math.sin(
          timeSeconds * active.animation.speed + active.animation.offset
        ) *
          active.animation.amplitude;
    }
  }
}

function addChunkBiomeLights(chunkManager, mesh, chunkCoords) {
  const chunkSize = chunkManager.world.chunkSize;
  const localLightPositions = [];
  const maxLightsPerChunk = 2;

  for (let y = 0; y < chunkSize; y++) {
    for (let z = 0; z < chunkSize; z++) {
      for (let x = 0; x < chunkSize; x++) {
        const voxelType = getChunkVoxel(
          chunkManager.world,
          chunkCoords.x,
          chunkCoords.y,
          chunkCoords.z,
          x,
          y,
          z
        );
        if (!isLightVoxelType(voxelType)) {
          continue;
        }

        if (localLightPositions.length >= maxLightsPerChunk) {
          return localLightPositions;
        }

        localLightPositions.push({ x, y, z, voxelType });
      }
    }
  }

  return localLightPositions;
}

function getChunkVoxelOrigin(world, chunkCoords) {
  return {
    x: chunkCoords.x * world.chunkSize,
    y: chunkCoords.y * world.chunkSize,
    z: chunkCoords.z * world.chunkSize,
  };
}

function toFloat32Array(values) {
  if (values instanceof Float32Array) {
    return values;
  }
  if (values instanceof ArrayBuffer) {
    return new Float32Array(values);
  }
  if (Array.isArray(values)) {
    return new Float32Array(values);
  }
  return null;
}

function toUint32Array(values) {
  if (values instanceof Uint32Array) {
    return values;
  }
  if (values instanceof Uint16Array) {
    return new Uint32Array(values);
  }
  if (values instanceof ArrayBuffer) {
    return new Uint32Array(values);
  }
  if (Array.isArray(values)) {
    return new Uint32Array(values);
  }
  return null;
}

function toUint8Array(values) {
  if (values instanceof Uint8Array) {
    return values;
  }
  if (values instanceof ArrayBuffer) {
    return new Uint8Array(values);
  }
  if (Array.isArray(values)) {
    return new Uint8Array(values);
  }
  return null;
}

function normalizeMeshData(meshData) {
  if (!meshData) {
    return null;
  }

  const positions = toFloat32Array(meshData.positions);
  const normals = toFloat32Array(meshData.normals);
  const indices = toUint32Array(meshData.indices);
  const voxelTypes = toUint8Array(meshData.voxelTypes || []);

  if (!positions || !normals || !indices || !voxelTypes) {
    return null;
  }

  if (positions.length === 0) {
    if (
      normals.length === 0 &&
      indices.length === 0 &&
      voxelTypes.length === 0
    ) {
      return {
        positions,
        normals,
        indices,
        voxelTypes,
      };
    }

    return null;
  }

  const faceCount = positions.length / 12;

  if (
    positions.length % 12 !== 0 ||
    normals.length !== positions.length ||
    indices.length % 3 !== 0 ||
    (voxelTypes.length !== 0 && voxelTypes.length !== faceCount)
  ) {
    return null;
  }

  return {
    positions,
    normals,
    indices,
    voxelTypes,
  };
}

// Create shared materials to avoid exceeding WebGL uniform limits
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function createSharedMaterials() {
  return {
    opaque: new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
    }),
    transparent: new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

function createChunkVertexColors(
  chunkManager,
  meshData,
  chunkVoxelOffsetX,
  chunkVoxelOffsetY,
  chunkVoxelOffsetZ,
  inverseVoxelSize
) {
  var colors = new Float32Array(meshData.positions.length);
  var positionsPerFace = 12;
  var surfaceBiomeBand =
    chunkManager.generator && chunkManager.generator.config
      ? chunkManager.generator.config.surfaceBiomeBand || 1
      : 1;

  for (
    var faceStart = 0;
    faceStart < meshData.positions.length;
    faceStart += positionsPerFace
  ) {
    var faceIndex = Math.floor(faceStart / positionsPerFace);
    var voxelType = meshData.voxelTypes ? meshData.voxelTypes[faceIndex] : 1;
    var worldX =
      ((meshData.positions[faceStart] +
        meshData.positions[faceStart + 3] +
        meshData.positions[faceStart + 6] +
        meshData.positions[faceStart + 9]) /
        4) *
        inverseVoxelSize +
      chunkVoxelOffsetX;
    var worldY =
      ((meshData.positions[faceStart + 1] +
        meshData.positions[faceStart + 4] +
        meshData.positions[faceStart + 7] +
        meshData.positions[faceStart + 10]) /
        4) *
        inverseVoxelSize +
      chunkVoxelOffsetY;
    var worldZ =
      ((meshData.positions[faceStart + 2] +
        meshData.positions[faceStart + 5] +
        meshData.positions[faceStart + 8] +
        meshData.positions[faceStart + 11]) /
        4) *
        inverseVoxelSize +
      chunkVoxelOffsetZ;
    var normalX = meshData.normals[faceStart];
    var normalY = meshData.normals[faceStart + 1];
    var normalZ = meshData.normals[faceStart + 2];
    var featureInfo =
      chunkManager.generator &&
      typeof chunkManager.generator.getFeatureInfo === 'function'
        ? chunkManager.generator.getFeatureInfo(worldX, worldY, worldZ)
        : null;
    var biomeId =
      typeof chunkManager.world.getBiomeType === 'function'
        ? chunkManager.world.getBiomeType(worldX, worldY, worldZ)
        : 'moss';

    var color = getTerrainSurfaceColor({
      voxelType: voxelType,
      worldX: worldX,
      worldY: worldY,
      worldZ: worldZ,
      normalX: normalX,
      normalY: normalY,
      normalZ: normalZ,
      biomeId: biomeId,
      featureInfo: featureInfo,
      surfaceBiomeBand: surfaceBiomeBand,
    });

    for (var vertex = 0; vertex < 4; vertex++) {
      var offset = faceStart + vertex * 3;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
    }
  }

  return colors;
}

function createEmptyMeshData() {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
    voxelTypes: new Uint8Array(0),
  };
}

function appendFaceToMeshData(target, source, faceIndex) {
  const sourceVertexStart = faceIndex * 12;
  const targetVertexIndex = target.positions.length / 3;
  const voxelType = source.voxelTypes ? source.voxelTypes[faceIndex] : 1;

  for (let i = 0; i < 12; i++) {
    target.positions.push(source.positions[sourceVertexStart + i]);
    target.normals.push(source.normals[sourceVertexStart + i]);
  }

  target.indices.push(
    targetVertexIndex,
    targetVertexIndex + 1,
    targetVertexIndex + 2,
    targetVertexIndex + 2,
    targetVertexIndex + 1,
    targetVertexIndex + 3
  );
  target.voxelTypes.push(voxelType);
}

function toTypedMeshData(meshData) {
  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    voxelTypes: new Uint8Array(meshData.voxelTypes),
  };
}

function splitMeshDataByTransparency(meshData) {
  const opaque = {
    positions: [],
    normals: [],
    indices: [],
    voxelTypes: [],
  };
  const transparent = {
    positions: [],
    normals: [],
    indices: [],
    voxelTypes: [],
  };
  const faceCount = meshData.voxelTypes
    ? meshData.voxelTypes.length
    : meshData.positions.length / 12;

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const voxelType = meshData.voxelTypes ? meshData.voxelTypes[faceIndex] : 1;
    appendFaceToMeshData(
      isVoxelTransparent(voxelType) ? transparent : opaque,
      meshData,
      faceIndex
    );
  }

  return {
    opaque:
      opaque.positions.length > 0
        ? toTypedMeshData(opaque)
        : createEmptyMeshData(),
    transparent:
      transparent.positions.length > 0
        ? toTypedMeshData(transparent)
        : createEmptyMeshData(),
  };
}

function createGeometryFromMeshData(meshData, colors) {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(meshData.positions, 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(meshData.normals, 3)
  );
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
  geometry.computeBoundingBox();

  return geometry;
}

// Create a chunk manager
export function createChunkManager(
  world,
  generator,
  crystalGenerator,
  featureGenerator,
  renderer,
  options = {}
) {
  // Create frustum for culling
  const frustum = new THREE.Frustum();
  const cameraMatrix = new THREE.Matrix4();

  const manager = {
    world,
    generator,
    crystalGenerator,
    featureGenerator,
    renderer,
    terrainWorkerConfig: options.terrainWorkerConfig || generator.config,

    // Worker interface for terrain generation
    workerInterface: null,
    workersInitialized: false,

    // Chunk tracking
    loadedChunks: new Map(), // chunkKey -> chunkData
    loadedChunkMeshData: new Map(), // chunkKey -> precomputed mesh buffers
    chunkStates: new Map(), // chunkKey -> ChunkState
    chunkMeshes: new Map(), // chunkKey -> THREE.Mesh
    chunkBoundaries: new Map(), // chunkKey -> THREE.LineSegments for chunk boundaries
    animatedLights: new Set(),
    activeAnimatedLights: [],
    lastLightScanTime: 0,
    pendingChunkLoads: [],
    pendingChunkLoadKeys: new Set(),
    activeChunkLoads: 0,
    pendingChunkMeshes: [],
    pendingChunkMeshKeys: new Set(),
    pendingChunkUnloads: [],
    pendingChunkUnloadKeys: new Set(),

    // Player tracking
    lastPlayerChunk: null, // Last known player chunk position
    lastStreamingChunk: null,

    // Frustum culling
    frustum,
    cameraMatrix,

    // Streaming and rendering configuration
    showChunkBoundaries: options.showChunkBoundaries === true, // Default to false (only show if explicitly requested)
    debugChunksVisible: true,
    loadRadius: typeof options.loadRadius === 'number' ? options.loadRadius : 3,
    unloadRadius:
      typeof options.unloadRadius === 'number'
        ? options.unloadRadius
        : (typeof options.loadRadius === 'number' ? options.loadRadius : 3) + 1,
    biomeLightBudget:
      typeof options.biomeLightBudget === 'number'
        ? options.biomeLightBudget
        : 2,
    biomeLightRange:
      typeof options.biomeLightRange === 'number'
        ? options.biomeLightRange
        : 56,
    biomeLightsEnabled: options.biomeLightsEnabled === true,
    sunlightShadowsEnabled: options.sunlightShadowsEnabled !== false,
    shadowChunkRadius:
      typeof options.shadowChunkRadius === 'number'
        ? options.shadowChunkRadius
        : 2,
    forwardBiasChunks:
      typeof options.forwardBiasChunks === 'number'
        ? options.forwardBiasChunks
        : 1.35,
    forwardBiasMinSpeed:
      typeof options.forwardBiasMinSpeed === 'number'
        ? options.forwardBiasMinSpeed
        : 0.2,
    forwardBiasFullSpeed:
      typeof options.forwardBiasFullSpeed === 'number'
        ? options.forwardBiasFullSpeed
        : 2.2,
    maxConcurrentChunkLoads:
      typeof options.maxConcurrentChunkLoads === 'number'
        ? options.maxConcurrentChunkLoads
        : 1,
    maxChunkMeshesPerFrame:
      typeof options.maxChunkMeshesPerFrame === 'number'
        ? options.maxChunkMeshesPerFrame
        : 1,
    maxChunkUnloadsPerFrame:
      typeof options.maxChunkUnloadsPerFrame === 'number'
        ? options.maxChunkUnloadsPerFrame
        : 2,
    maxModifiedChunksPerFrame:
      typeof options.maxModifiedChunksPerFrame === 'number'
        ? options.maxModifiedChunksPerFrame
        : 2,
    minChunkRemeshIntervalMs:
      typeof options.minChunkRemeshIntervalMs === 'number'
        ? options.minChunkRemeshIntervalMs
        : 75,
    maxVoxelEditsPerFrame:
      typeof options.maxVoxelEditsPerFrame === 'number'
        ? options.maxVoxelEditsPerFrame
        : 96,

    // Shared material
    materials: createSharedMaterials(),

    // Loading progress callbacks
    onChunkLoaded: options.onChunkLoaded || noop,
    onChunkMeshed: options.onChunkMeshed || noop,
    onChunkEmpty: options.onChunkEmpty || noop,
    onTerrainCacheLookup: options.onTerrainCacheLookup || noop,

    // Statistics
    stats: {
      loadedChunks: 0,
      meshedChunks: 0,
      loadTime: 0,
      meshTime: 0,
    },

    tempBox: new THREE.Box3(),
    lastRemeshTimeByChunk: new Map(),
  };

  manager.world.runtimeLimits.maxVoxelEditsPerFrame =
    manager.maxVoxelEditsPerFrame;

  // Bind methods to the manager instance
  manager.loadChunk = function (chunk) {
    return loadChunk(manager, chunk, { immediateMesh: true });
  };
  manager.queueChunkLoad = function (chunk) {
    return queueChunkLoad(manager, chunk);
  };
  manager.unloadChunk = function (chunkKey) {
    return unloadChunk(manager, chunkKey);
  };
  manager.meshChunk = async function (chunkKey) {
    return await meshChunk(manager, chunkKey);
  };
  manager.updateFrustumCulling = function (camera) {
    return updateFrustumCulling(manager, camera);
  };
  manager.initializeWorkers = async function () {
    return await initializeWorkers(manager);
  };
  manager.toggleChunkBoundaries = function () {
    return toggleChunkBoundaries(manager);
  };
  manager.setDebugChunksVisible = function (enabled) {
    manager.debugChunksVisible = enabled;
    if (!enabled) {
      for (const [, mesh] of manager.chunkMeshes) {
        mesh.visible = false;
      }
      for (const [, boundary] of manager.chunkBoundaries) {
        boundary.visible = false;
      }
    }
  };

  return manager;
}

// Initialize workers for terrain generation
async function initializeWorkers(chunkManager) {
  if (chunkManager.workersInitialized) return;

  try {
    chunkManager.workerInterface = await initializeTerrainWorkers({
      workerCount: 3,
      backgroundWorkerReserve: 1,
      onTerrainCacheLookup: chunkManager.onTerrainCacheLookup,
    });
    chunkManager.workersInitialized = true;
  } catch (error) {
    debugError('Failed to initialize terrain workers:', error);
    // Fall back to synchronous generation if workers fail
    chunkManager.workersInitialized = false;
  }
}

function isChunkUnavailableState(state) {
  return !state || state === ChunkState.UNLOADED || state === ChunkState.ERROR;
}

function queueChunkMesh(chunkManager, chunkKey) {
  if (!chunkKey || chunkManager.pendingChunkMeshKeys.has(chunkKey)) {
    return;
  }

  const state = chunkManager.chunkStates.get(chunkKey);
  if (state !== ChunkState.LOADED) {
    return;
  }

  chunkManager.pendingChunkMeshKeys.add(chunkKey);
  chunkManager.pendingChunkMeshes.push(chunkKey);
}

function processChunkMeshQueue(chunkManager) {
  let processedChunks = 0;

  while (
    processedChunks < chunkManager.maxChunkMeshesPerFrame &&
    chunkManager.pendingChunkMeshes.length > 0
  ) {
    const chunkKey = chunkManager.pendingChunkMeshes.shift();
    chunkManager.pendingChunkMeshKeys.delete(chunkKey);

    const state = chunkManager.chunkStates.get(chunkKey);
    if (state !== ChunkState.LOADED) {
      continue;
    }

    meshChunk(chunkManager, chunkKey);
    processedChunks++;
  }
}

function processChunkUnloadQueue(chunkManager) {
  let processedUnloads = 0;
  const playerChunk = chunkManager.lastPlayerChunk;
  const streamChunk = chunkManager.lastStreamingChunk;
  const unloadRadius = chunkManager.unloadRadius;

  while (
    processedUnloads < chunkManager.maxChunkUnloadsPerFrame &&
    chunkManager.pendingChunkUnloads.length > 0
  ) {
    const chunkKey = chunkManager.pendingChunkUnloads.shift();
    chunkManager.pendingChunkUnloadKeys.delete(chunkKey);

    // Re-validate: is the chunk still outside the unload radius?
    // If player moved back, we should abort the unload.
    if (playerChunk && streamChunk) {
      const coords = parseChunkKey(chunkKey);
      const playerDistance = getChunkDistanceInChunks(coords, playerChunk);
      const streamDistance = getChunkDistanceInChunks(coords, streamChunk);

      if (Math.min(playerDistance, streamDistance) <= unloadRadius) {
        continue; // Chunk is needed again, skip unload
      }
    }

    unloadChunk(chunkManager, chunkKey);
    processedUnloads++;
  }
}

function collectChunkRemeshContexts(chunkManager, chunkCoords) {
  const contexts = [];
  const seenKeys = new Set();

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const contextChunkX = chunkCoords.x + dx;
        const contextChunkY = chunkCoords.y + dy;
        const contextChunkZ = chunkCoords.z + dz;
        const key = chunkKey(contextChunkX, contextChunkY, contextChunkZ);

        if (seenKeys.has(key)) {
          continue;
        }

        seenKeys.add(key);

        const chunkData = getChunk(
          chunkManager.world,
          contextChunkX,
          contextChunkY,
          contextChunkZ
        );
        const voxelEdits = getRuntimeVoxelEditsForChunk(
          chunkManager.world,
          contextChunkX,
          contextChunkY,
          contextChunkZ
        );

        if (!chunkData && voxelEdits.length === 0) {
          continue;
        }

        contexts.push({
          chunkX: contextChunkX,
          chunkY: contextChunkY,
          chunkZ: contextChunkZ,
          chunkData,
          voxelEdits,
        });
      }
    }
  }

  return contexts;
}

async function prepareChunkMeshData(chunkManager, chunkKey, chunkCoords) {
  const cachedMeshData = normalizeMeshData(
    chunkManager.loadedChunkMeshData.get(chunkKey)
  );

  if (cachedMeshData) {
    return cachedMeshData;
  }

  const chunkData = getChunk(
    chunkManager.world,
    chunkCoords.x,
    chunkCoords.y,
    chunkCoords.z
  );

  if (!chunkData) {
    return null;
  }

  if (chunkManager.workersInitialized && chunkManager.workerInterface) {
    try {
      const result = await chunkManager.workerInterface.remeshChunk(
        chunkCoords.x,
        chunkCoords.y,
        chunkCoords.z,
        chunkManager.terrainWorkerConfig,
        collectChunkRemeshContexts(chunkManager, chunkCoords)
      );
      const meshData = normalizeMeshData(result.meshData);

      if (meshData) {
        chunkManager.loadedChunkMeshData.set(chunkKey, meshData);
        return meshData;
      }
    } catch (error) {
      debugWarn(`Worker remesh failed for chunk ${chunkKey}:`, error);
    }
  }

  return normalizeMeshData(
    generateGeometryDataForChunk(
      chunkManager.world,
      chunkCoords.x,
      chunkCoords.y,
      chunkCoords.z
    )
  );
}

function queueChunkLoad(chunkManager, chunk, options = {}) {
  if (
    !chunk ||
    chunk.x === undefined ||
    chunk.y === undefined ||
    chunk.z === undefined
  ) {
    return;
  }

  const key = chunkKey(chunk.x, chunk.y, chunk.z);
  const existingState = chunkManager.chunkStates.get(key);
  if (
    !isChunkUnavailableState(existingState) ||
    chunkManager.pendingChunkLoadKeys.has(key)
  ) {
    return;
  }

  chunkManager.pendingChunkLoadKeys.add(key);
  chunkManager.pendingChunkLoads.push({
    x: chunk.x,
    y: chunk.y,
    z: chunk.z,
    useTerrainCache: options.useTerrainCache === true,
  });
}

function processChunkLoadQueue(chunkManager) {
  while (
    chunkManager.activeChunkLoads < chunkManager.maxConcurrentChunkLoads &&
    chunkManager.pendingChunkLoads.length > 0
  ) {
    const chunk = chunkManager.pendingChunkLoads.shift();
    const key = chunkKey(chunk.x, chunk.y, chunk.z);
    chunkManager.pendingChunkLoadKeys.delete(key);

    const existingState = chunkManager.chunkStates.get(key);
    if (!isChunkUnavailableState(existingState)) {
      continue;
    }

    chunkManager.activeChunkLoads++;
    loadChunk(chunkManager, chunk, {
      immediateMesh: false,
      useTerrainCache: chunk.useTerrainCache === true,
    })
      .catch(function () {})
      .finally(function () {
        chunkManager.activeChunkLoads = Math.max(
          0,
          chunkManager.activeChunkLoads - 1
        );
        processChunkLoadQueue(chunkManager);
      });
  }
}

async function loadChunk(chunkManager, chunk, options = {}) {
  if (
    !chunk ||
    chunk.x === undefined ||
    chunk.y === undefined ||
    chunk.z === undefined
  ) {
    return;
  }

  const key = chunkKey(chunk.x, chunk.y, chunk.z);

  const existingState = chunkManager.chunkStates.get(key);
  if (
    existingState === ChunkState.LOADING ||
    existingState === ChunkState.LOADED ||
    existingState === ChunkState.MESHING ||
    existingState === ChunkState.MESHED
  ) {
    return;
  }

  // Set state to loading
  chunkManager.chunkStates.set(key, ChunkState.LOADING);

  try {
    // Use workers if available and initialized
    let chunkData;
    let meshData = null;
    if (chunkManager.workersInitialized && chunkManager.workerInterface) {
      try {
        const result = await chunkManager.workerInterface.generateChunkBundle(
          chunk.x,
          chunk.y,
          chunk.z,
          chunkManager.terrainWorkerConfig,
          {
            // Runtime streaming skips cache reads so nearby full chunks do not
            // wait behind IndexedDB. Startup/warmup may opt into reads.
            readCache: options.useTerrainCache === true,
            writeCache: true,
            urgent: options.useTerrainCache !== true,
          }
        );
        chunkData = result.chunkData;
        meshData = result.meshData;
      } catch (workerError) {
        debugWarn(
          'Worker failed, falling back to synchronous generation:',
          workerError
        );
        // Fall back to synchronous generation
        chunkData = chunkManager.generator.generateChunk(
          chunk.x,
          chunk.y,
          chunk.z
        );
      }
    } else {
      // Fallback to synchronous generation
      chunkData = chunkManager.generator.generateChunk(
        chunk.x,
        chunk.y,
        chunk.z
      );
    }
    // Store chunk data in chunk manager
    chunkManager.loadedChunks.set(key, chunkData);
    const usedWorkerBundle = Boolean(meshData);
    if (meshData) {
      chunkManager.loadedChunkMeshData.set(key, meshData);
    }

    // Also store chunk data in the world's chunk storage
    // This ensures getVoxel() can access the terrain data
    setChunk(chunkManager.world, chunk.x, chunk.y, chunk.z, chunkData);
    if (
      meshData &&
      hasRuntimeVoxelDeltasInChunk(
        chunkManager.world,
        chunk.x,
        chunk.y,
        chunk.z
      )
    ) {
      meshData = null;
      chunkManager.loadedChunkMeshData.delete(key);
    }

    if (!meshData && !usedWorkerBundle) {
      if (chunkManager.featureGenerator) {
        chunkManager.featureGenerator.generateFeatures(
          chunkManager.world,
          chunk.x,
          chunk.y,
          chunk.z
        );
      }

      if (chunkManager.crystalGenerator) {
        chunkManager.crystalGenerator.generateCrystals(
          chunkManager.world,
          chunk.x,
          chunk.y,
          chunk.z
        );
      }
    }

    chunkManager.chunkStates.set(key, ChunkState.LOADED);

    // Call progress callback BEFORE meshing
    chunkManager.onChunkLoaded();

    // Update stats
    chunkManager.stats.loadedChunks++;

    if (options.immediateMesh) {
      await meshChunk(chunkManager, key);
      chunkManager.world.modifiedChunks.delete(key);
    } else {
      queueChunkMesh(chunkManager, key);
    }
  } catch (error) {
    chunkManager.chunkStates.set(key, ChunkState.ERROR);
    debugError(`Error loading chunk ${key}:`, error);
  }
}

function removeChunkMesh(chunkManager, chunkKey) {
  const mesh = chunkManager.chunkMeshes.get(chunkKey);
  if (!mesh) {
    return;
  }

  for (const child of mesh.children) {
    if (child.userData && child.userData.isAnimatedBiomeLight) {
      chunkManager.animatedLights.delete(child);
    }
  }

  for (const child of mesh.children) {
    if (child.geometry) {
      child.geometry.dispose();
    }
  }

  chunkManager.renderer.scene.remove(mesh);
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  chunkManager.chunkMeshes.delete(chunkKey);
  chunkManager.pendingChunkMeshKeys.delete(chunkKey);
}

// Unload a chunk
function unloadChunk(chunkManager, chunkKey) {
  const state = chunkManager.chunkStates.get(chunkKey);
  if (!state) return;

  // Remove mesh from scene
  const mesh = chunkManager.chunkMeshes.get(chunkKey);
  if (mesh) {
    removeChunkMesh(chunkManager, chunkKey);
  }

  // Remove chunk boundary visualization
  const boundary = chunkManager.chunkBoundaries.get(chunkKey);
  if (boundary) {
    chunkManager.renderer.scene.remove(boundary);
    if (boundary.geometry) {
      boundary.geometry.dispose();
    }
    if (boundary.material) {
      boundary.material.dispose();
    }
    chunkManager.chunkBoundaries.delete(chunkKey);
  }

  // Remove chunk data
  chunkManager.loadedChunks.delete(chunkKey);
  chunkManager.loadedChunkMeshData.delete(chunkKey);
  chunkManager.chunkStates.delete(chunkKey);
  chunkManager.pendingChunkLoadKeys.delete(chunkKey);
  chunkManager.pendingChunkMeshKeys.delete(chunkKey);
  const coords = parseChunkKey(chunkKey);

  if (chunkManager.workersInitialized && chunkManager.workerInterface) {
    chunkManager.workerInterface.unloadChunk(
      coords.x,
      coords.y,
      coords.z,
      chunkManager.terrainWorkerConfig
    );
  }

  removeChunk(chunkManager.world, coords.x, coords.y, coords.z);

  // Update stats
  if (state === ChunkState.MESHED) {
    chunkManager.stats.meshedChunks = Math.max(
      0,
      chunkManager.stats.meshedChunks - 1
    );
  }
  chunkManager.stats.loadedChunks = Math.max(
    0,
    chunkManager.stats.loadedChunks - 1
  );
}

function refreshModifiedChunks(chunkManager, maxChunksPerFrame = 1) {
  if (
    !chunkManager.world.modifiedChunks ||
    chunkManager.world.modifiedChunks.size === 0
  ) {
    return;
  }

  let processedChunks = 0;

  for (const key of Array.from(chunkManager.world.modifiedChunks)) {
    if (processedChunks >= maxChunksPerFrame) {
      break;
    }

    chunkManager.world.modifiedChunks.delete(key);

    if (typeof chunkManager.world.pruneUnsupportedDetailProps === 'function') {
      chunkManager.world.pruneUnsupportedDetailProps(new Set([key]));
    }

    if (!chunkManager.loadedChunks.has(key)) {
      continue;
    }

    const state = chunkManager.chunkStates.get(key);
    if (state === ChunkState.LOADING || state === ChunkState.MESHING) {
      chunkManager.world.modifiedChunks.add(key);
      continue;
    }

    const lastRemeshTime = chunkManager.lastRemeshTimeByChunk.get(key);
    if (
      typeof lastRemeshTime === 'number' &&
      performance.now() - lastRemeshTime < chunkManager.minChunkRemeshIntervalMs
    ) {
      chunkManager.world.modifiedChunks.add(key);
      continue;
    }

    chunkManager.chunkStates.set(key, ChunkState.LOADED);
    queueChunkMesh(chunkManager, key);
    processedChunks++;
  }
}

// Generate mesh for a chunk
async function meshChunk(chunkManager, chunkKey) {
  const state = chunkManager.chunkStates.get(chunkKey);
  if (state !== ChunkState.LOADED) return;

  // Set state to meshing
  chunkManager.chunkStates.set(chunkKey, ChunkState.MESHING);

  try {
    const chunkCoords = parseChunkKey(chunkKey);
    const chunkVoxelOrigin = getChunkVoxelOrigin(
      chunkManager.world,
      chunkCoords
    );
    const chunkOffsetX = voxelToWorldCoord(
      chunkManager.world,
      chunkVoxelOrigin.x
    );
    const chunkOffsetY = voxelToWorldCoord(
      chunkManager.world,
      chunkVoxelOrigin.y
    );
    const chunkOffsetZ = voxelToWorldCoord(
      chunkManager.world,
      chunkVoxelOrigin.z
    );
    const chunkVoxelOffsetX = chunkVoxelOrigin.x;
    const chunkVoxelOffsetY = chunkVoxelOrigin.y;
    const chunkVoxelOffsetZ = chunkVoxelOrigin.z;
    const inverseVoxelSize = 1 / chunkManager.world.voxelSize;

    // Debug: Check if chunk exists in world before meshing
    const chunkData = getChunk(
      chunkManager.world,
      chunkCoords.x,
      chunkCoords.y,
      chunkCoords.z
    );
    if (!chunkData) {
      return;
    }

    const meshData = await prepareChunkMeshData(
      chunkManager,
      chunkKey,
      chunkCoords
    );
    if (!meshData) {
      throw new Error(`Missing mesh data for chunk ${chunkKey}`);
    }

    if (!meshData) {
      throw new Error(`Invalid mesh data for chunk ${chunkKey}`);
    }

    const hadExistingMesh = chunkManager.chunkMeshes.has(chunkKey);

    if (meshData.positions.length === 0) {
      if (hadExistingMesh) {
        removeChunkMesh(chunkManager, chunkKey);
        chunkManager.stats.meshedChunks = Math.max(
          0,
          chunkManager.stats.meshedChunks - 1
        );
      }
      chunkManager.chunkStates.set(chunkKey, ChunkState.LOADED);
      chunkManager.onChunkEmpty();
      return;
    }

    const meshParts = splitMeshDataByTransparency(meshData);
    const opaqueColors = createChunkVertexColors(
      chunkManager,
      meshParts.opaque,
      chunkVoxelOffsetX,
      chunkVoxelOffsetY,
      chunkVoxelOffsetZ,
      inverseVoxelSize
    );
    const transparentColors = createChunkVertexColors(
      chunkManager,
      meshParts.transparent,
      chunkVoxelOffsetX,
      chunkVoxelOffsetY,
      chunkVoxelOffsetZ,
      inverseVoxelSize
    );

    const primaryMeshData =
      meshParts.opaque.positions.length > 0
        ? meshParts.opaque
        : meshParts.transparent;
    const primaryColors =
      meshParts.opaque.positions.length > 0 ? opaqueColors : transparentColors;
    const primaryMaterial =
      meshParts.opaque.positions.length > 0
        ? chunkManager.materials.opaque
        : chunkManager.materials.transparent;
    const geometry = createGeometryFromMeshData(primaryMeshData, primaryColors);

    const mesh = new THREE.Mesh(geometry, primaryMaterial);

    mesh.position.set(chunkOffsetX, chunkOffsetY, chunkOffsetZ);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;

    if (
      meshParts.opaque.positions.length > 0 &&
      meshParts.transparent.positions.length > 0
    ) {
      const transparentGeometry = createGeometryFromMeshData(
        meshParts.transparent,
        transparentColors
      );
      const transparentMesh = new THREE.Mesh(
        transparentGeometry,
        chunkManager.materials.transparent
      );
      transparentMesh.receiveShadow = false;
      transparentMesh.castShadow = false;
      mesh.add(transparentMesh);
    }

    if (chunkManager.biomeLightsEnabled) {
      const chunkLightVoxels = addChunkBiomeLights(
        chunkManager,
        mesh,
        chunkCoords
      );
      for (const lightVoxel of chunkLightVoxels) {
        const voxelX = chunkVoxelOffsetX + lightVoxel.x;
        const voxelY = chunkVoxelOffsetY + lightVoxel.y;
        const voxelZ = chunkVoxelOffsetZ + lightVoxel.z;
        const lightSettings = getBiomeAwareLightSettings(lightVoxel.voxelType);
        const light = new THREE.PointLight(
          lightSettings.color,
          lightSettings.intensity,
          lightSettings.distance,
          2
        );

        light.position.set(
          voxelToWorldCoord(chunkManager.world, lightVoxel.x + 0.5),
          voxelToWorldCoord(chunkManager.world, lightVoxel.y + 0.5),
          voxelToWorldCoord(chunkManager.world, lightVoxel.z + 0.5)
        );
        light.userData = {
          isAnimatedBiomeLight: true,
          animation: {
            base: lightSettings.intensity,
            amplitude: lightSettings.amplitude,
            speed: lightSettings.speed,
            offset: (voxelX * 13.1 + voxelY * 7.3 + voxelZ * 11.7) % Math.PI,
          },
        };
        light.castShadow = false;
        light.visible = false;
        mesh.add(light);
        chunkManager.animatedLights.add(light);
      }
    }

    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);

    if (hadExistingMesh) {
      removeChunkMesh(chunkManager, chunkKey);
      chunkManager.stats.meshedChunks = Math.max(
        0,
        chunkManager.stats.meshedChunks - 1
      );
    }

    // Add to scene
    chunkManager.renderer.scene.add(mesh);
    chunkManager.chunkMeshes.set(chunkKey, mesh);

    // Respect debug chunks visibility
    if (chunkManager.debugChunksVisible === false) {
      mesh.visible = false;
    }

    // Add chunk boundary visualization if enabled
    if (chunkManager.showChunkBoundaries) {
      addChunkBoundary(chunkManager, chunkCoords);
    }

    // Update state
    chunkManager.chunkStates.set(chunkKey, ChunkState.MESHED);
    chunkManager.lastRemeshTimeByChunk.set(chunkKey, performance.now());

    // Update stats
    chunkManager.stats.meshedChunks++;
    if (chunkManager.world.performanceStats) {
      chunkManager.world.performanceStats.remeshedChunksPerFrame++;
    }

    // Call progress callback
    chunkManager.onChunkMeshed();
    chunkManager.loadedChunkMeshData.delete(chunkKey);
  } catch (error) {
    chunkManager.chunkStates.set(chunkKey, ChunkState.ERROR);
    debugError(`Error meshing chunk ${chunkKey}:`, error);
  }
}

// Add chunk boundary visualization - only the outer edges of the chunk
function addChunkBoundary(chunkManager, chunkCoords) {
  const { world } = chunkManager;
  const chunkWorldSize = getChunkWorldSize(world);

  // Create lines for the outer edges of the chunk only
  const points = [];

  // Calculate chunk origin (corner) position
  const originX = chunkCoords.x * chunkWorldSize;
  const originY = chunkCoords.y * chunkWorldSize;
  const originZ = chunkCoords.z * chunkWorldSize;

  // Define the 8 corners of the chunk
  const corners = [
    // Bottom face
    new THREE.Vector3(originX, originY, originZ),
    new THREE.Vector3(originX + chunkWorldSize, originY, originZ),
    new THREE.Vector3(
      originX + chunkWorldSize,
      originY,
      originZ + chunkWorldSize
    ),
    new THREE.Vector3(originX, originY, originZ + chunkWorldSize),
    // Top face
    new THREE.Vector3(originX, originY + chunkWorldSize, originZ),
    new THREE.Vector3(
      originX + chunkWorldSize,
      originY + chunkWorldSize,
      originZ
    ),
    new THREE.Vector3(
      originX + chunkWorldSize,
      originY + chunkWorldSize,
      originZ + chunkWorldSize
    ),
    new THREE.Vector3(
      originX,
      originY + chunkWorldSize,
      originZ + chunkWorldSize
    ),
  ];

  // Bottom face edges
  points.push(corners[0], corners[1]);
  points.push(corners[1], corners[2]);
  points.push(corners[2], corners[3]);
  points.push(corners[3], corners[0]);

  // Top face edges
  points.push(corners[4], corners[5]);
  points.push(corners[5], corners[6]);
  points.push(corners[6], corners[7]);
  points.push(corners[7], corners[4]);

  // Vertical edges connecting top and bottom
  points.push(corners[0], corners[4]);
  points.push(corners[1], corners[5]);
  points.push(corners[2], corners[6]);
  points.push(corners[3], corners[7]);

  // Create geometry from points
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  // Create material with subtle color and transparency
  const material = new THREE.LineBasicMaterial({
    color: 0x4444ff, // Blue color for visibility
    transparent: true,
    opacity: 0.3, // Semi-transparent for minimal obstruction
    depthWrite: false, // Don't write to depth buffer so it appears behind other objects
  });

  // Create line segments
  const boundaryLines = new THREE.LineSegments(geometry, material);

  // Add to scene
  chunkManager.renderer.scene.add(boundaryLines);
  chunkManager.chunkBoundaries.set(
    chunkKey(chunkCoords.x, chunkCoords.y, chunkCoords.z),
    boundaryLines
  );
}

// Toggle chunk boundary visualization
function toggleChunkBoundaries(chunkManager) {
  chunkManager.showChunkBoundaries = !chunkManager.showChunkBoundaries;

  if (chunkManager.showChunkBoundaries) {
    // Add boundaries to all existing chunks
    for (const [chunkKey] of chunkManager.chunkMeshes) {
      const chunkCoords = parseChunkKey(chunkKey);
      addChunkBoundary(chunkManager, chunkCoords);
    }
  } else {
    // Remove all existing boundaries
    for (const [, boundary] of chunkManager.chunkBoundaries) {
      chunkManager.renderer.scene.remove(boundary);
    }
    chunkManager.chunkBoundaries.clear();
  }

  return chunkManager.showChunkBoundaries;
}

// Create a chunk manager with terrain generation
export function createChunkManagerWithTerrain(world, renderer, options = {}) {
  // Use a fixed seed if not provided to ensure deterministic generation
  const {
    seed = 54321,
    chunkSize = world.chunkSize || CHUNK_SIZE_VOXELS,
    level,
  } = options;
  // Keep this as the raw authoring config. createTerrainGenerator converts
  // world-unit dimensions into voxel-grid coordinates internally; passing
  // generator.config back into another generator would apply that conversion
  // twice and make worker chunks disagree with main-thread chunks.
  const terrainWorkerConfig = {
    seed,
    chunkSize,
    voxelSize: world.voxelSize,
    levelId: level && level.id ? level.id : 'default-level',
  };

  // Build generator config, optionally with custom level graph
  var generatorConfig = terrainWorkerConfig;

  if (level && level.graph) {
    generatorConfig = {
      ...terrainWorkerConfig,
      startingChamber: level.startingChamber,
      graph: level.graph,
      skyOpenings: level.skyOpenings || undefined,
    };

    // Also propagate to worker config so workers see same graph
    terrainWorkerConfig.startingChamber = level.startingChamber;
    terrainWorkerConfig.graph = level.graph;
    terrainWorkerConfig.skyOpenings = level.skyOpenings || undefined;
  }

  // Create terrain generator
  const terrainGenerator = createTerrainGenerator(generatorConfig);

  world.fallbackVoxel = function (x, y, z) {
    return terrainGenerator.generateVoxel(x, y, z);
  };
  world.getBiomeType = function (x, y, z) {
    return terrainGenerator.getBiomeType(x, y, z);
  };

  // Decorative cave accents now come from the detail-prop layer instead of
  // terrain-side crystal/feature generators.
  const chunkManager = createChunkManager(
    world,
    terrainGenerator,
    null,
    null,
    renderer,
    {
      ...options,
      terrainWorkerConfig,
    }
  );

  return chunkManager;
}

function getChunkCoordsFromPosition(world, position) {
  const chunkWorldSize = getChunkWorldSize(world);
  return {
    x: Math.floor(position.x / chunkWorldSize),
    y: Math.floor(position.y / chunkWorldSize),
    z: Math.floor(position.z / chunkWorldSize),
  };
}

function getChunkDistanceInChunks(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const dz = Math.abs(a.z - b.z);
  return Math.max(dx, dy, dz);
}

function getVelocityBiasedChunkCenter(
  chunkManager,
  playerPosition,
  playerChunk,
  playerVelocity
) {
  if (!playerVelocity || playerVelocity.lengthSq() <= 1e-4) {
    return {
      streamChunk: playerChunk,
      streamDirection: null,
    };
  }

  const speed = playerVelocity.length();
  if (speed < chunkManager.forwardBiasMinSpeed) {
    return {
      streamChunk: playerChunk,
      streamDirection: null,
    };
  }

  const speedRange = Math.max(
    0.001,
    chunkManager.forwardBiasFullSpeed - chunkManager.forwardBiasMinSpeed
  );
  const biasStrength = clamp01(
    (speed - chunkManager.forwardBiasMinSpeed) / speedRange
  );
  if (biasStrength <= 0) {
    return {
      streamChunk: playerChunk,
      streamDirection: null,
    };
  }

  const chunkWorldSize = getChunkWorldSize(chunkManager.world);
  const streamDirection = playerVelocity.clone().normalize();
  const biasedPosition = playerPosition
    .clone()
    .addScaledVector(
      streamDirection,
      chunkWorldSize * chunkManager.forwardBiasChunks * biasStrength
    );

  return {
    streamChunk: getChunkCoordsFromPosition(chunkManager.world, biasedPosition),
    streamDirection,
  };
}

function getChunkLoadPriority(chunkCoords, streamChunk, streamDirection) {
  const dx = chunkCoords.x - streamChunk.x;
  const dy = chunkCoords.y - streamChunk.y;
  const dz = chunkCoords.z - streamChunk.z;
  const chebyshevDistance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const euclideanDistanceSq = dx * dx + dy * dy + dz * dz;

  if (!streamDirection) {
    return chebyshevDistance * 100 + euclideanDistanceSq;
  }

  const forwardProgress =
    dx * streamDirection.x + dy * streamDirection.y + dz * streamDirection.z;
  return chebyshevDistance * 100 + euclideanDistanceSq - forwardProgress * 12;
}

function getSortedChunkCoordsAround(centerChunk, radius, streamDirection) {
  const chunkCoords = [];

  for (let x = centerChunk.x - radius; x <= centerChunk.x + radius; x++) {
    for (let y = centerChunk.y - radius; y <= centerChunk.y + radius; y++) {
      for (let z = centerChunk.z - radius; z <= centerChunk.z + radius; z++) {
        chunkCoords.push({ x, y, z });
      }
    }
  }

  chunkCoords.sort(function (a, b) {
    return (
      getChunkLoadPriority(a, centerChunk, streamDirection) -
      getChunkLoadPriority(b, centerChunk, streamDirection)
    );
  });

  return chunkCoords;
}

function applyTemporaryStartupBudgets(chunkManager, options) {
  if (!options) {
    return null;
  }

  const originalBudgets = {
    maxConcurrentChunkLoads: chunkManager.maxConcurrentChunkLoads,
    maxChunkMeshesPerFrame: chunkManager.maxChunkMeshesPerFrame,
  };

  if (typeof options.maxConcurrentChunkLoads === 'number') {
    chunkManager.maxConcurrentChunkLoads = options.maxConcurrentChunkLoads;
  }

  if (typeof options.maxChunkMeshesPerFrame === 'number') {
    chunkManager.maxChunkMeshesPerFrame = options.maxChunkMeshesPerFrame;
  }

  return originalBudgets;
}

function restoreStartupBudgets(chunkManager, originalBudgets) {
  if (!originalBudgets) {
    return;
  }

  chunkManager.maxConcurrentChunkLoads =
    originalBudgets.maxConcurrentChunkLoads;
  chunkManager.maxChunkMeshesPerFrame = originalBudgets.maxChunkMeshesPerFrame;
}

function reprioritizePendingChunkLoads(
  chunkManager,
  streamChunk,
  streamDirection
) {
  chunkManager.pendingChunkLoads.sort(function (a, b) {
    return (
      getChunkLoadPriority(a, streamChunk, streamDirection) -
      getChunkLoadPriority(b, streamChunk, streamDirection)
    );
  });
}

function updateStreaming(
  chunkManager,
  playerChunk,
  streamChunk,
  streamDirection
) {
  const loadRadius = chunkManager.loadRadius;
  const unloadRadius = chunkManager.unloadRadius;
  const loadCandidates = [];

  for (
    let x = streamChunk.x - loadRadius;
    x <= streamChunk.x + loadRadius;
    x++
  ) {
    for (
      let y = streamChunk.y - loadRadius;
      y <= streamChunk.y + loadRadius;
      y++
    ) {
      for (
        let z = streamChunk.z - loadRadius;
        z <= streamChunk.z + loadRadius;
        z++
      ) {
        const key = chunkKey(x, y, z);
        const state = chunkManager.chunkStates.get(key);
        if (isChunkUnavailableState(state)) {
          loadCandidates.push({ x, y, z });
        }
      }
    }
  }

  loadCandidates.sort(function (a, b) {
    return (
      getChunkLoadPriority(a, streamChunk, streamDirection) -
      getChunkLoadPriority(b, streamChunk, streamDirection)
    );
  });

  for (const chunk of loadCandidates) {
    queueChunkLoad(chunkManager, chunk);
  }

  reprioritizePendingChunkLoads(chunkManager, streamChunk, streamDirection);

  for (const [key, state] of chunkManager.chunkStates) {
    if (state === ChunkState.LOADING || state === ChunkState.MESHING) {
      continue;
    }
    const coords = parseChunkKey(key);
    const playerDistance = getChunkDistanceInChunks(coords, playerChunk);
    const streamDistance = getChunkDistanceInChunks(coords, streamChunk);
    if (Math.min(playerDistance, streamDistance) > unloadRadius) {
      if (!chunkManager.pendingChunkUnloadKeys.has(key)) {
        chunkManager.pendingChunkUnloadKeys.add(key);
        chunkManager.pendingChunkUnloads.push(key);
      }
    }
  }
}

function updateChunkShadowCasting(chunkManager, playerChunk) {
  if (!playerChunk || chunkManager.sunlightShadowsEnabled === false) {
    return;
  }

  for (const [key, mesh] of chunkManager.chunkMeshes) {
    const coords = parseChunkKey(key);
    const distance = getChunkDistanceInChunks(coords, playerChunk);
    mesh.castShadow = distance <= chunkManager.shadowChunkRadius;
  }
}

export async function loadChunksAround(
  chunkManager,
  centerPosition,
  radius,
  options = {}
) {
  const chunkRadius =
    typeof radius === 'number' ? radius : chunkManager.loadRadius;
  const centerChunk = getChunkCoordsFromPosition(
    chunkManager.world,
    centerPosition
  );
  const startupBudgets = applyTemporaryStartupBudgets(chunkManager, options);

  try {
    const chunkCoords = getSortedChunkCoordsAround(
      centerChunk,
      chunkRadius,
      options.streamDirection
    );
    const chunkKeys = [];

    for (const coords of chunkCoords) {
      chunkKeys.push(chunkKey(coords.x, coords.y, coords.z));
      queueChunkLoad(chunkManager, coords, { useTerrainCache: true });
    }

    while (!areChunksLoadedForStartup(chunkManager, chunkKeys)) {
      const failedChunkKey = getFailedStartupChunkKey(chunkManager, chunkKeys);
      if (failedChunkKey) {
        throw new Error(`Failed to load startup chunk ${failedChunkKey}`);
      }

      processChunkLoadQueue(chunkManager);
      processChunkMeshQueue(chunkManager);
      await waitForNextStartupLoadTick();
    }
  } catch (error) {
    debugError('Failed to load initial chunks:', error);
  } finally {
    restoreStartupBudgets(chunkManager, startupBudgets);
  }
}

export async function warmupChunksAround(
  chunkManager,
  centerPosition,
  radius,
  budgetMs,
  options = {}
) {
  const chunkRadius =
    typeof radius === 'number' ? radius : chunkManager.loadRadius;
  const deadline =
    performance.now() + (typeof budgetMs === 'number' ? budgetMs : 0);
  const centerChunk = getChunkCoordsFromPosition(
    chunkManager.world,
    centerPosition
  );
  const startupBudgets = applyTemporaryStartupBudgets(chunkManager, options);

  try {
    const chunkCoords = getSortedChunkCoordsAround(
      centerChunk,
      chunkRadius,
      options.streamDirection
    );

    for (const coords of chunkCoords) {
      queueChunkLoad(chunkManager, coords, { useTerrainCache: true });
    }

    while (performance.now() < deadline) {
      if (typeof options.onProgress === 'function') {
        options.onProgress(
          1 -
            Math.max(0, deadline - performance.now()) /
              Math.max(1, typeof budgetMs === 'number' ? budgetMs : 1)
        );
      }

      if (
        chunkManager.pendingChunkLoads.length === 0 &&
        chunkManager.activeChunkLoads === 0 &&
        chunkManager.pendingChunkMeshes.length === 0
      ) {
        break;
      }

      processChunkLoadQueue(chunkManager);
      processChunkMeshQueue(chunkManager);
      await waitForNextStartupLoadTick();
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress(1);
    }
  } catch (error) {
    debugWarn('Failed to warm up startup chunks:', error);
  } finally {
    restoreStartupBudgets(chunkManager, startupBudgets);
  }
}

function waitForNextStartupLoadTick() {
  return new Promise(function (resolve) {
    setTimeout(resolve, 16);
  });
}

function getFailedStartupChunkKey(chunkManager, chunkKeys) {
  for (const key of chunkKeys) {
    if (chunkManager.chunkStates.get(key) === ChunkState.ERROR) {
      return key;
    }
  }

  return null;
}

function areChunksLoadedForStartup(chunkManager, chunkKeys) {
  for (const key of chunkKeys) {
    const state = chunkManager.chunkStates.get(key);
    if (state === ChunkState.MESHED) {
      continue;
    }

    if (
      state === ChunkState.LOADED &&
      !chunkManager.pendingChunkMeshKeys.has(key)
    ) {
      continue;
    }

    return false;
  }

  return true;
}

// Update frustum culling based on camera
function updateFrustumCulling(chunkManager, camera) {
  // Update frustum from camera
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  chunkManager.cameraMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  chunkManager.frustum.setFromProjectionMatrix(chunkManager.cameraMatrix);

  // Check each chunk mesh against frustum
  const tempBox = chunkManager.tempBox;
  for (const [, mesh] of chunkManager.chunkMeshes) {
    if (!chunkManager.debugChunksVisible) {
      mesh.visible = false;
      continue;
    }
    if (mesh.geometry) {
      // Create a bounding box for the chunk if it doesn't exist
      if (!mesh.geometry.boundingBox) {
        mesh.geometry.computeBoundingBox();
      }

      // Check if bounding box intersects with frustum
      tempBox.copy(mesh.geometry.boundingBox);
      tempBox.applyMatrix4(mesh.matrixWorld);
      mesh.visible = chunkManager.frustum.intersectsBox(tempBox);
    }
  }
}

// Main update function for streaming, culling, lights, and remeshing.
export function updateChunkManager(
  chunkManager,
  playerPosition,
  camera,
  playerVelocity
) {
  let playerChunk = null;

  if (playerPosition) {
    playerChunk = getChunkCoordsFromPosition(
      chunkManager.world,
      playerPosition
    );
    const streamingInfo = getVelocityBiasedChunkCenter(
      chunkManager,
      playerPosition,
      playerChunk,
      playerVelocity
    );
    const streamChunk = streamingInfo.streamChunk;
    const streamDirection = streamingInfo.streamDirection;
    const lastChunk = chunkManager.lastPlayerChunk;
    const lastStreamingChunk = chunkManager.lastStreamingChunk;
    const hasMovedChunks =
      !lastChunk ||
      lastChunk.x !== playerChunk.x ||
      lastChunk.y !== playerChunk.y ||
      lastChunk.z !== playerChunk.z;
    const hasMovedStreamingCenter =
      !lastStreamingChunk ||
      lastStreamingChunk.x !== streamChunk.x ||
      lastStreamingChunk.y !== streamChunk.y ||
      lastStreamingChunk.z !== streamChunk.z;

    if (hasMovedChunks || hasMovedStreamingCenter) {
      chunkManager.lastPlayerChunk = playerChunk;
      chunkManager.lastStreamingChunk = streamChunk;
      updateStreaming(chunkManager, playerChunk, streamChunk, streamDirection);
    } else if (streamDirection && chunkManager.pendingChunkLoads.length > 1) {
      reprioritizePendingChunkLoads(chunkManager, streamChunk, streamDirection);
    }
  }

  // Update frustum culling if camera is provided
  if (camera) {
    updateFrustumCulling(chunkManager, camera);
  }

  updateChunkShadowCasting(chunkManager, playerChunk);
  processChunkLoadQueue(chunkManager);
  processChunkMeshQueue(chunkManager);
  processChunkUnloadQueue(chunkManager);
  flushQueuedVoxelEdits(chunkManager.world, chunkManager.maxVoxelEditsPerFrame);
  refreshModifiedChunks(chunkManager, chunkManager.maxModifiedChunksPerFrame);

  updateAnimatedLights(chunkManager, playerPosition, performance.now() * 0.001);
}
