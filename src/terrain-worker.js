// Web Worker for terrain generation
// This worker handles terrain generation in a separate thread to avoid blocking the main thread

// Import the terrain generation module
import { createTerrainGenerator } from './terrain-generation.js';
import {
  createSparseWorld,
  setChunk,
  getChunk,
  generateGeometryDataForChunk,
  queueRuntimeVoxelEdit,
  flushQueuedVoxelEdits,
  removeChunk,
} from './voxel.js';
import { buildCoarseLodGeometry } from './lod/lod-worker-logic.js';
import { debugWarn } from './debug.js';

const workerWorlds = new Map();

function getWorkerWorldKey(config) {
  return `${config.seed}:${config.chunkSize}:${config.voxelSize}`;
}

function getOrCreateWorkerWorld(config) {
  const key = getWorkerWorldKey(config);
  let workerState = workerWorlds.get(key);

  if (workerState) {
    return workerState;
  }

  const generator = createTerrainGenerator(config);
  const world = createSparseWorld(config.chunkSize, config.voxelSize);

  world.fallbackVoxel = function (x, y, z) {
    return generator.generateVoxel(x, y, z);
  };
  world.getBiomeType = function (x, y, z) {
    return generator.getBiomeType(x, y, z);
  };

  workerState = { generator, world };
  workerWorlds.set(key, workerState);
  return workerState;
}

function toMeshBuffers(meshData) {
  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    voxelTypes: new Uint8Array(meshData.voxelTypes),
  };
}

function createChunkBundle(chunkX, chunkY, chunkZ, config) {
  const workerState = getOrCreateWorkerWorld(config);
  const { generator, world } = workerState;
  const chunkData = generator.generateChunk(chunkX, chunkY, chunkZ);

  setChunk(world, chunkX, chunkY, chunkZ, chunkData);

  const finalChunkData = getChunk(world, chunkX, chunkY, chunkZ) || chunkData;
  const meshData = generateGeometryDataForChunk(world, chunkX, chunkY, chunkZ);

  return {
    chunkData: finalChunkData,
    meshData: toMeshBuffers(meshData),
  };
}

function remeshChunk(chunkX, chunkY, chunkZ, config, chunkContexts = []) {
  const workerState = getOrCreateWorkerWorld(config);
  const generator = workerState.generator;
  const world = createSparseWorld(config.chunkSize, config.voxelSize);
  let pendingEditCount = 0;

  world.fallbackVoxel = function (x, y, z) {
    return generator.generateVoxel(x, y, z);
  };
  world.getBiomeType = function (x, y, z) {
    return generator.getBiomeType(x, y, z);
  };

  for (const chunkContext of chunkContexts) {
    if (chunkContext.chunkData) {
      setChunk(
        world,
        chunkContext.chunkX,
        chunkContext.chunkY,
        chunkContext.chunkZ,
        new Uint8Array(chunkContext.chunkData)
      );
    }

    if (!Array.isArray(chunkContext.voxelEdits)) {
      continue;
    }

    for (const edit of chunkContext.voxelEdits) {
      queueRuntimeVoxelEdit(world, edit.x, edit.y, edit.z, edit.value);
      pendingEditCount++;
    }
  }

  if (pendingEditCount > 0) {
    flushQueuedVoxelEdits(world, pendingEditCount);
  }

  return {
    meshData: toMeshBuffers(
      generateGeometryDataForChunk(world, chunkX, chunkY, chunkZ)
    ),
  };
}

function unloadWorkerChunk(chunkX, chunkY, chunkZ, config) {
  const workerState = getOrCreateWorkerWorld(config);
  removeChunk(workerState.world, chunkX, chunkY, chunkZ);
}

// Handle messages from the main thread
self.onmessage = function (e) {
  const { type, data } = e.data;

  switch (type) {
    case 'generateChunkBundle': {
      const { chunkX, chunkY, chunkZ, config } = data;

      try {
        const result = createChunkBundle(chunkX, chunkY, chunkZ, config);

        self.postMessage(
          {
            type: 'chunkBundleGenerated',
            data: {
              chunkX,
              chunkY,
              chunkZ,
              chunkData: result.chunkData.buffer,
              positions: result.meshData.positions.buffer,
              normals: result.meshData.normals.buffer,
              indices: result.meshData.indices.buffer,
              voxelTypes: result.meshData.voxelTypes.buffer,
            },
          },
          [
            result.chunkData.buffer,
            result.meshData.positions.buffer,
            result.meshData.normals.buffer,
            result.meshData.indices.buffer,
            result.meshData.voxelTypes.buffer,
          ]
        );
      } catch (error) {
        self.postMessage({
          type: 'error',
          data: {
            error: error.message,
            chunkX,
            chunkY,
            chunkZ,
          },
        });
      }
      break;
    }

    case 'remeshChunk': {
      const { chunkX, chunkY, chunkZ, config, chunkContexts } = data;

      try {
        const result = remeshChunk(
          chunkX,
          chunkY,
          chunkZ,
          config,
          chunkContexts
        );

        self.postMessage(
          {
            type: 'chunkRemeshed',
            data: {
              chunkX,
              chunkY,
              chunkZ,
              positions: result.meshData.positions.buffer,
              normals: result.meshData.normals.buffer,
              indices: result.meshData.indices.buffer,
              voxelTypes: result.meshData.voxelTypes.buffer,
            },
          },
          [
            result.meshData.positions.buffer,
            result.meshData.normals.buffer,
            result.meshData.indices.buffer,
            result.meshData.voxelTypes.buffer,
          ]
        );
      } catch (error) {
        self.postMessage({
          type: 'error',
          data: {
            error: error.message,
            chunkX,
            chunkY,
            chunkZ,
          },
        });
      }
      break;
    }

    case 'generateLodGeometry': {
      const { config, geoOptions } = data;

      try {
        const workerState = getOrCreateWorkerWorld(config);
        const { generator } = workerState;

        const result = buildCoarseLodGeometry({
          ...geoOptions,
          generator,
        });

        // Convert result to transferables
        const positions = new Float32Array(result.positions);
        const normals = new Float32Array(result.normals);
        const colors = new Float32Array(result.colors);
        const indices = new Uint32Array(result.indices);

        self.postMessage(
          {
            type: 'lodGeometryGenerated',
            data: {
              lodKey: data.lodKey,
              positions: positions.buffer,
              normals: normals.buffer,
              colors: colors.buffer,
              indices: indices.buffer,
              faceCount: result.faceCount,
              diagnostics: result.diagnostics,
            },
          },
          [positions.buffer, normals.buffer, colors.buffer, indices.buffer]
        );
      } catch (error) {
        self.postMessage({
          type: 'error',
          data: {
            error: error.message,
            lodKey: data.lodKey,
          },
        });
      }
      break;
    }

    case 'unloadChunk': {
      const { chunkX, chunkY, chunkZ, config } = data;

      try {
        unloadWorkerChunk(chunkX, chunkY, chunkZ, config);
      } catch (error) {
        debugWarn('Failed to unload worker chunk:', error);
      }
      break;
    }

    default:
      debugWarn('Unknown message type in terrain worker:', type);
  }
};
