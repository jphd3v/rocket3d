import { DEBUG, debugLog, debugWarn } from './debug.js';

export const TERRAIN_CACHE_VERSION = 'terrain-v2';
export const MESHER_CACHE_VERSION = 'mesh-v1';
export const COLOR_CACHE_VERSION = 'color-v1';
export const ENABLE_TERRAIN_CACHE = true;
export const ENABLE_CHUNK_CACHE = true;
export const ENABLE_LOD_CACHE = true;
export const ENABLE_CACHE_TOUCH = false;
export const ENABLE_RUNTIME_CACHE_EVICTION = false;

const TERRAIN_CACHE_DB_NAME = 'rocket3d-cache';
const TERRAIN_CACHE_STORE_NAME = 'terrainMeshes';
const TERRAIN_CACHE_DB_VERSION = 1;
const TERRAIN_CACHE_MAX_BYTES = 320 * 1024 * 1024;
const TERRAIN_CACHE_CLEANUP_INTERVAL_MS = 30000;
const CACHE_PREFIX = 'rocket3d';

var terrainCacheSessionStartedAt = Date.now();
var terrainCacheDbPromise = null;
var terrainCacheCleanupPromise = null;
var terrainCacheCleanupTimer = null;
var terrainCacheLastCleanupAt = 0;

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function warnCache(message, error) {
  if (DEBUG) {
    debugWarn(message, error);
  }
}

function openTerrainCacheDb() {
  if (!ENABLE_TERRAIN_CACHE || !canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  if (terrainCacheDbPromise) {
    return terrainCacheDbPromise;
  }

  terrainCacheDbPromise = new Promise(function (resolve, reject) {
    var request = indexedDB.open(
      TERRAIN_CACHE_DB_NAME,
      TERRAIN_CACHE_DB_VERSION
    );

    request.onupgradeneeded = function () {
      var db = request.result;
      var store;

      if (!db.objectStoreNames.contains(TERRAIN_CACHE_STORE_NAME)) {
        store = db.createObjectStore(TERRAIN_CACHE_STORE_NAME, {
          keyPath: 'key',
        });
      } else {
        store = request.transaction.objectStore(TERRAIN_CACHE_STORE_NAME);
      }

      if (!store.indexNames.contains('lastUsedAt')) {
        store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }
    };

    request.onsuccess = function () {
      resolve(request.result);
    };

    request.onerror = function () {
      reject(request.error || new Error('Failed to open terrain cache'));
    };
  }).catch(function (error) {
    terrainCacheDbPromise = null;
    warnCache('[TerrainCache] IndexedDB open failed', error);
    return null;
  });

  return terrainCacheDbPromise;
}

function runTerrainStore(mode, handler) {
  return openTerrainCacheDb().then(function (db) {
    if (!db) {
      return null;
    }

    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(TERRAIN_CACHE_STORE_NAME, mode);
      var store = transaction.objectStore(TERRAIN_CACHE_STORE_NAME);
      var settled = false;

      function finish(value) {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      }

      transaction.oncomplete = function () {
        finish(null);
      };
      transaction.onerror = function () {
        reject(
          transaction.error || new Error('Terrain cache transaction failed')
        );
      };
      transaction.onabort = function () {
        reject(
          transaction.error || new Error('Terrain cache transaction aborted')
        );
      };

      handler(store, finish);
    });
  });
}

function cloneBufferFromArray(array) {
  if (!array) {
    return new ArrayBuffer(0);
  }

  return array.buffer.slice(
    array.byteOffset,
    array.byteOffset + array.byteLength
  );
}

function getArrayBufferByteLength(buffer) {
  return buffer ? buffer.byteLength : 0;
}

function getPayloadByteSize(payload) {
  if (!payload) {
    return 0;
  }

  return (
    getArrayBufferByteLength(payload.positions) +
    getArrayBufferByteLength(payload.normals) +
    getArrayBufferByteLength(payload.colors) +
    getArrayBufferByteLength(payload.indices) +
    getArrayBufferByteLength(payload.voxelTypes) +
    getArrayBufferByteLength(payload.chunkData)
  );
}

function normalizeSeed(seed) {
  return String(seed == null ? 'default' : seed);
}

function getConfigCacheSeed(config) {
  return normalizeSeed(
    config && config.cacheSeed != null
      ? config.cacheSeed
      : config
        ? config.seed
        : null
  );
}

function normalizeLevelId(config) {
  return String((config && config.levelId) || 'default-level');
}

function getConfigChunkSize(config) {
  return config && typeof config.chunkSize === 'number' ? config.chunkSize : 0;
}

function getConfigVoxelSize(config) {
  return config && typeof config.voxelSize === 'number' ? config.voxelSize : 0;
}

function buildCommonKeyParts(config) {
  return [
    CACHE_PREFIX,
    TERRAIN_CACHE_VERSION,
    normalizeLevelId(config),
    'seed-' + getConfigCacheSeed(config),
  ];
}

function getIndexType(indices) {
  return indices instanceof Uint16Array ? 'uint16' : 'uint32';
}

function toIndexArray(buffer, indexType) {
  return indexType === 'uint16'
    ? new Uint16Array(buffer)
    : new Uint32Array(buffer);
}

function isArrayBuffer(value) {
  return value instanceof ArrayBuffer;
}

function isValidIndexType(indexType) {
  return indexType === 'uint16' || indexType === 'uint32';
}

function hasExpectedMetadata(record, config, lodLevel) {
  var metadata = record ? record.metadata : null;

  return Boolean(
    metadata &&
    metadata.schemaVersion === 1 &&
    metadata.levelId === normalizeLevelId(config) &&
    metadata.seed === getConfigCacheSeed(config) &&
    metadata.terrainVersion === TERRAIN_CACHE_VERSION &&
    metadata.meshVersion === MESHER_CACHE_VERSION &&
    metadata.colorVersion === COLOR_CACHE_VERSION &&
    metadata.chunkSize === getConfigChunkSize(config) &&
    metadata.voxelSize === getConfigVoxelSize(config) &&
    metadata.lodLevel === lodLevel
  );
}

function hasValidMeshPayload(payload, includeColors) {
  var positionCount;
  var normalCount;
  var colorCount;
  var indexBytes;

  if (
    !payload ||
    !isArrayBuffer(payload.positions) ||
    !isArrayBuffer(payload.normals) ||
    !isArrayBuffer(payload.indices) ||
    !isValidIndexType(payload.indexType)
  ) {
    return false;
  }

  if (
    payload.positions.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0 ||
    payload.normals.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
  ) {
    return false;
  }

  positionCount = payload.positions.byteLength / Float32Array.BYTES_PER_ELEMENT;
  normalCount = payload.normals.byteLength / Float32Array.BYTES_PER_ELEMENT;
  if (positionCount % 3 !== 0 || normalCount !== positionCount) {
    return false;
  }

  indexBytes =
    payload.indexType === 'uint16'
      ? Uint16Array.BYTES_PER_ELEMENT
      : Uint32Array.BYTES_PER_ELEMENT;
  if (payload.indices.byteLength % indexBytes !== 0) {
    return false;
  }

  if (includeColors) {
    if (!isArrayBuffer(payload.colors)) {
      return false;
    }
    if (payload.colors.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      return false;
    }
    colorCount = payload.colors.byteLength / Float32Array.BYTES_PER_ELEMENT;
    if (colorCount !== positionCount) {
      return false;
    }
  }

  return true;
}

function isValidChunkRecord(record, config) {
  var payload = record ? record.payload : null;
  var chunkSize = getConfigChunkSize(config);
  var expectedChunkDataLength = chunkSize * chunkSize * chunkSize;
  var positionCount =
    payload && isArrayBuffer(payload.positions)
      ? payload.positions.byteLength / Float32Array.BYTES_PER_ELEMENT
      : 0;
  var indexCount =
    payload && isArrayBuffer(payload.indices)
      ? payload.indices.byteLength /
        (payload.indexType === 'uint16'
          ? Uint16Array.BYTES_PER_ELEMENT
          : Uint32Array.BYTES_PER_ELEMENT)
      : 0;
  var faceCount = positionCount / 12;

  return Boolean(
    hasExpectedMetadata(record, config, 0) &&
    payload &&
    isArrayBuffer(payload.chunkData) &&
    payload.chunkData.byteLength === expectedChunkDataLength &&
    isArrayBuffer(payload.voxelTypes) &&
    hasValidMeshPayload(payload, false) &&
    (positionCount === 0
      ? indexCount === 0 && payload.voxelTypes.byteLength === 0
      : positionCount % 12 === 0 &&
        indexCount % 3 === 0 &&
        (payload.voxelTypes.byteLength === 0 ||
          payload.voxelTypes.byteLength === faceCount))
  );
}

function isValidLodRecord(record, config, geoOptions) {
  var payload = record ? record.payload : null;
  var lodLevel = geoOptions && geoOptions.blockSize ? geoOptions.blockSize : 1;

  return Boolean(
    hasExpectedMetadata(record, config, lodLevel) &&
    payload &&
    hasValidMeshPayload(payload, true)
  );
}

function isRecordFromPreviousSession(record) {
  return Boolean(
    record &&
    typeof record.createdAt === 'number' &&
    record.createdAt < terrainCacheSessionStartedAt
  );
}

function touchRecord(key) {
  if (!ENABLE_CACHE_TOUCH) {
    return Promise.resolve(false);
  }

  return runTerrainStore('readwrite', function (store) {
    var request = store.get(key);
    request.onsuccess = function () {
      var record = request.result;
      if (!record) {
        return;
      }
      record.lastUsedAt = Date.now();
      store.put(record);
    };
  }).catch(function (error) {
    warnCache('[TerrainCache] Failed to update lastUsedAt', error);
  });
}

function evictTerrainCacheIfNeeded() {
  if (!ENABLE_RUNTIME_CACHE_EVICTION) {
    return Promise.resolve(false);
  }

  if (terrainCacheCleanupPromise) {
    return terrainCacheCleanupPromise;
  }

  terrainCacheLastCleanupAt = Date.now();
  terrainCacheCleanupPromise = runTerrainStore('readwrite', function (store) {
    var totalBytes = 0;
    var records = [];
    var cursorRequest = store.openCursor();

    cursorRequest.onsuccess = function () {
      var cursor = cursorRequest.result;
      if (!cursor) {
        records.sort(function (a, b) {
          return a.lastUsedAt - b.lastUsedAt;
        });

        var deleteIndex = 0;
        while (
          totalBytes > TERRAIN_CACHE_MAX_BYTES &&
          deleteIndex < records.length
        ) {
          store.delete(records[deleteIndex].key);
          totalBytes -= records[deleteIndex].byteSize;
          deleteIndex++;
        }
        return;
      }

      var record = cursor.value;
      var byteSize = record.byteSize || 0;
      totalBytes += byteSize;
      records.push({
        key: record.key,
        lastUsedAt: record.lastUsedAt || record.createdAt || 0,
        byteSize: byteSize,
      });
      cursor.continue();
    };
  })
    .catch(function (error) {
      warnCache('[TerrainCache] Eviction failed', error);
    })
    .finally(function () {
      terrainCacheCleanupPromise = null;
    });

  return terrainCacheCleanupPromise;
}

function scheduleTerrainCacheCleanup() {
  if (!ENABLE_RUNTIME_CACHE_EVICTION) {
    return;
  }

  if (terrainCacheCleanupPromise || terrainCacheCleanupTimer) {
    return;
  }

  if (
    Date.now() - terrainCacheLastCleanupAt <
    TERRAIN_CACHE_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  terrainCacheCleanupTimer = setTimeout(function () {
    terrainCacheCleanupTimer = null;
    evictTerrainCacheIfNeeded();
  }, 1000);
}

function putTerrainRecord(record) {
  return runTerrainStore('readwrite', function (store) {
    store.put(record);
  })
    .then(function () {
      scheduleTerrainCacheCleanup();
    })
    .catch(function (error) {
      warnCache('[TerrainCache] Write failed', error);
    });
}

function getTerrainRecord(key) {
  return runTerrainStore('readonly', function (store, finish) {
    var request = store.get(key);

    request.onsuccess = function () {
      finish(request.result || null);
    };
    request.onerror = function () {
      finish(null);
    };
  }).catch(function (error) {
    warnCache('[TerrainCache] Read failed', error);
    return null;
  });
}

export function buildChunkTerrainCacheKey(config, chunkX, chunkY, chunkZ) {
  return buildCommonKeyParts(config)
    .concat([
      'lod0',
      'chunk',
      chunkX,
      chunkY,
      chunkZ,
      MESHER_CACHE_VERSION,
      COLOR_CACHE_VERSION,
    ])
    .join(':');
}

export function buildLodTerrainCacheKey(config, lodKey, geoOptions) {
  var blockSize = geoOptions && geoOptions.blockSize ? geoOptions.blockSize : 1;
  var region =
    geoOptions && geoOptions.regionMinX !== undefined
      ? [
          geoOptions.regionMinX,
          geoOptions.regionMinY,
          geoOptions.regionMinZ,
          geoOptions.cellsX || geoOptions.gridW || 0,
          geoOptions.cellsY || geoOptions.gridH || 0,
          geoOptions.cellsZ || geoOptions.gridD || 0,
        ].join(',')
      : 'region-main';

  return buildCommonKeyParts(config)
    .concat([
      'lod' + blockSize,
      String(lodKey),
      region,
      MESHER_CACHE_VERSION,
      COLOR_CACHE_VERSION,
    ])
    .join(':');
}

export function getCachedChunkBundle(config, chunkX, chunkY, chunkZ) {
  if (!ENABLE_TERRAIN_CACHE || !ENABLE_CHUNK_CACHE) {
    return Promise.resolve(null);
  }

  var key = buildChunkTerrainCacheKey(config, chunkX, chunkY, chunkZ);

  return getTerrainRecord(key).then(function (record) {
    if (!record || !isValidChunkRecord(record, config)) {
      return null;
    }

    touchRecord(key);

    return {
      chunkX: chunkX,
      chunkY: chunkY,
      chunkZ: chunkZ,
      chunkData: new Uint8Array(record.payload.chunkData),
      meshData: {
        positions: new Float32Array(record.payload.positions),
        normals: new Float32Array(record.payload.normals),
        indices: toIndexArray(record.payload.indices, record.payload.indexType),
        voxelTypes: new Uint8Array(record.payload.voxelTypes),
      },
      cacheHit: true,
      persistentCacheHit: isRecordFromPreviousSession(record),
    };
  });
}

export function storeChunkBundleInTerrainCache(
  config,
  chunkX,
  chunkY,
  chunkZ,
  chunkData,
  meshData
) {
  if (!ENABLE_TERRAIN_CACHE || !ENABLE_CHUNK_CACHE) {
    return Promise.resolve(false);
  }

  var key = buildChunkTerrainCacheKey(config, chunkX, chunkY, chunkZ);
  var now = Date.now();
  var payload = {
    chunkData: cloneBufferFromArray(chunkData),
    positions: cloneBufferFromArray(meshData.positions),
    normals: cloneBufferFromArray(meshData.normals),
    indices: cloneBufferFromArray(meshData.indices),
    voxelTypes: cloneBufferFromArray(meshData.voxelTypes),
    indexType: getIndexType(meshData.indices),
  };

  return putTerrainRecord({
    key: key,
    createdAt: now,
    lastUsedAt: now,
    byteSize: getPayloadByteSize(payload),
    payload: payload,
    metadata: {
      schemaVersion: 1,
      levelId: normalizeLevelId(config),
      seed: getConfigCacheSeed(config),
      lodLevel: 0,
      chunkKey: chunkX + ',' + chunkY + ',' + chunkZ,
      chunkSize: getConfigChunkSize(config),
      voxelSize: getConfigVoxelSize(config),
      terrainVersion: TERRAIN_CACHE_VERSION,
      meshVersion: MESHER_CACHE_VERSION,
      colorVersion: COLOR_CACHE_VERSION,
    },
  });
}

export function getCachedLodGeometry(config, lodKey, geoOptions) {
  if (!ENABLE_TERRAIN_CACHE || !ENABLE_LOD_CACHE) {
    return Promise.resolve(null);
  }

  var key = buildLodTerrainCacheKey(config, lodKey, geoOptions);

  return getTerrainRecord(key).then(function (record) {
    if (!record || !isValidLodRecord(record, config, geoOptions)) {
      return null;
    }

    touchRecord(key);

    return {
      lodKey: lodKey,
      positions: new Float32Array(record.payload.positions),
      normals: new Float32Array(record.payload.normals),
      colors: new Float32Array(record.payload.colors),
      indices: toIndexArray(record.payload.indices, record.payload.indexType),
      faceCount: record.metadata ? record.metadata.faceCount || 0 : 0,
      diagnostics: record.metadata ? record.metadata.diagnostics : null,
      cacheHit: true,
      persistentCacheHit: isRecordFromPreviousSession(record),
    };
  });
}

export function storeLodGeometryInTerrainCache(
  config,
  lodKey,
  geoOptions,
  result
) {
  if (!ENABLE_TERRAIN_CACHE || !ENABLE_LOD_CACHE) {
    return Promise.resolve(false);
  }

  var key = buildLodTerrainCacheKey(config, lodKey, geoOptions);
  var now = Date.now();
  var payload = {
    positions: cloneBufferFromArray(result.positions),
    normals: cloneBufferFromArray(result.normals),
    colors: cloneBufferFromArray(result.colors),
    indices: cloneBufferFromArray(result.indices),
    indexType: getIndexType(result.indices),
  };

  return putTerrainRecord({
    key: key,
    createdAt: now,
    lastUsedAt: now,
    byteSize: getPayloadByteSize(payload),
    payload: payload,
    metadata: {
      schemaVersion: 1,
      levelId: normalizeLevelId(config),
      seed: getConfigCacheSeed(config),
      lodLevel: geoOptions && geoOptions.blockSize ? geoOptions.blockSize : 1,
      chunkKey: String(lodKey),
      chunkSize: getConfigChunkSize(config),
      voxelSize: getConfigVoxelSize(config),
      lodBlockSize:
        geoOptions && geoOptions.blockSize ? geoOptions.blockSize : 1,
      terrainVersion: TERRAIN_CACHE_VERSION,
      meshVersion: MESHER_CACHE_VERSION,
      colorVersion: COLOR_CACHE_VERSION,
      faceCount: result.faceCount || 0,
      diagnostics: result.diagnostics || null,
    },
  });
}

export function clearTerrainCacheDatabase() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(false);
  }

  if (terrainCacheDbPromise) {
    terrainCacheDbPromise.then(function (db) {
      if (db) {
        db.close();
      }
    });
    terrainCacheDbPromise = null;
  }

  terrainCacheSessionStartedAt = Date.now();
  terrainCacheLastCleanupAt = 0;
  if (terrainCacheCleanupTimer) {
    clearTimeout(terrainCacheCleanupTimer);
    terrainCacheCleanupTimer = null;
  }

  return new Promise(function (resolve) {
    var request = indexedDB.deleteDatabase(TERRAIN_CACHE_DB_NAME);

    request.onsuccess = function () {
      if (DEBUG) {
        debugLog('[TerrainCache] Cleared terrain cache database');
      }
      resolve(true);
    };
    request.onerror = function () {
      warnCache('[TerrainCache] Failed to clear terrain cache', request.error);
      resolve(false);
    };
    request.onblocked = function () {
      warnCache('[TerrainCache] Clear blocked by an open connection');
      resolve(false);
    };
  });
}

export function clearTerrainCacheFromUrl() {
  if (typeof window === 'undefined' || !window.location) {
    return Promise.resolve(false);
  }

  var params = new URLSearchParams(window.location.search);
  if (params.get('clearTerrainCache') !== '1') {
    return Promise.resolve(false);
  }

  return clearTerrainCacheDatabase();
}
