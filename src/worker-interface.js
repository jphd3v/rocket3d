// Worker interface for generating complete chunk data and mesh bundles.
import { debugWarn } from './debug.js';
import {
  ENABLE_CHUNK_CACHE,
  ENABLE_LOD_CACHE,
  ENABLE_TERRAIN_CACHE,
  getCachedChunkBundle,
  getCachedLodGeometry,
  storeChunkBundleInTerrainCache,
  storeLodGeometryInTerrainCache,
} from './terrain-cache.js';

function getTaskId(chunkX, chunkY, chunkZ) {
  return `${chunkX},${chunkY},${chunkZ}`;
}

function createTask(type, chunkX, chunkY, chunkZ, data) {
  let resolveTask;
  let rejectTask;
  const promise = new Promise(function (resolve, reject) {
    resolveTask = resolve;
    rejectTask = reject;
  });

  return {
    taskId: `${type}:${getTaskId(chunkX, chunkY, chunkZ)}`,
    message: {
      type,
      data: { chunkX, chunkY, chunkZ, ...data },
    },
    promise,
    resolve: resolveTask,
    reject: rejectTask,
    cache: null,
  };
}

function warnCacheRead(error) {
  debugWarn('[TerrainCache] Cache read failed, generating normally:', error);
}

function notifyTerrainCacheLookup(workerInterface, persistentHit, cacheType) {
  if (typeof workerInterface.onTerrainCacheLookup === 'function') {
    workerInterface.onTerrainCacheLookup(persistentHit, cacheType);
  }
}

function deferTerrainCacheWrite(writeCache) {
  if (
    typeof window !== 'undefined' &&
    typeof window.requestIdleCallback === 'function'
  ) {
    window.requestIdleCallback(writeCache, { timeout: 1000 });
    return;
  }

  setTimeout(writeCache, 0);
}

function canUseChunkCache() {
  return ENABLE_TERRAIN_CACHE && ENABLE_CHUNK_CACHE;
}

function canUseLodCache() {
  return ENABLE_TERRAIN_CACHE && ENABLE_LOD_CACHE;
}

function processCacheLookupQueue(workerInterface) {
  while (workerInterface.activeCacheLookups < workerInterface.maxCacheLookups) {
    let task = workerInterface.cacheLookupQueue.shift();
    let isBackground = false;

    if (!task) {
      if (
        workerInterface.activeBackgroundCacheLookups >=
        workerInterface.maxBackgroundCacheLookups
      ) {
        return;
      }

      task = workerInterface.backgroundCacheLookupQueue.shift();
      isBackground = Boolean(task);
    }

    if (!task) {
      return;
    }

    workerInterface.activeCacheLookups++;
    if (isBackground) {
      workerInterface.activeBackgroundCacheLookups++;
    }

    task
      .lookup()
      .then(task.resolve)
      .catch(task.reject)
      .finally(function () {
        workerInterface.activeCacheLookups = Math.max(
          0,
          workerInterface.activeCacheLookups - 1
        );
        if (isBackground) {
          workerInterface.activeBackgroundCacheLookups = Math.max(
            0,
            workerInterface.activeBackgroundCacheLookups - 1
          );
        }
        processCacheLookupQueue(workerInterface);
      });
  }
}

function queueCacheLookup(workerInterface, lookup, background) {
  return new Promise(function (resolve, reject) {
    const task = {
      lookup,
      resolve,
      reject,
    };

    if (background) {
      workerInterface.backgroundCacheLookupQueue.push(task);
    } else {
      workerInterface.cacheLookupQueue.push(task);
    }

    processCacheLookupQueue(workerInterface);
  });
}

function queueTask(workerInterface, task, queueOptions) {
  const existingTask = workerInterface.pendingTasks.get(task.taskId);
  if (existingTask) {
    return existingTask.promise;
  }

  workerInterface.pendingTasks.set(task.taskId, task);
  if (queueOptions && queueOptions.urgent === true) {
    workerInterface.urgentTaskQueue.push(task);
  } else if (queueOptions && queueOptions.priority === true) {
    workerInterface.taskQueue.push(task);
  } else if (queueOptions && queueOptions.front === true) {
    workerInterface.backgroundTaskQueue.unshift(task);
  } else if (queueOptions && queueOptions.background === true) {
    workerInterface.backgroundTaskQueue.push(task);
  } else {
    workerInterface.taskQueue.push(task);
  }
  processQueue(workerInterface);

  return task.promise;
}

function handleWorkerMessage(workerInterface, workerInfo, message) {
  const { type, data } = message;

  if (
    type !== 'chunkBundleGenerated' &&
    type !== 'chunkRemeshed' &&
    type !== 'lodGeometryGenerated'
  ) {
    const errorMessage =
      type === 'error' && data && data.error
        ? data.error
        : `Unknown worker message: ${type}`;
    const currentTask = workerInfo.currentTaskId
      ? workerInterface.pendingTasks.get(workerInfo.currentTaskId)
      : null;

    if (currentTask) {
      currentTask.reject(new Error(errorMessage));
      workerInterface.pendingTasks.delete(currentTask.taskId);
    } else {
      debugWarn(errorMessage);
    }

    workerInfo.busy = false;
    workerInfo.currentTaskId = null;
    workerInfo.currentTaskType = null;
    processQueue(workerInterface);
    return;
  }

  let taskId;
  if (type === 'lodGeometryGenerated') {
    taskId = `generateLodGeometry:${data.lodKey}`;
  } else {
    const taskType =
      type === 'chunkBundleGenerated' ? 'generateChunkBundle' : 'remeshChunk';
    taskId = `${taskType}:${getTaskId(data.chunkX, data.chunkY, data.chunkZ)}`;
  }
  const task = workerInterface.pendingTasks.get(taskId);

  if (task) {
    if (type === 'lodGeometryGenerated') {
      const result = {
        lodKey: data.lodKey,
        positions: new Float32Array(data.positions),
        normals: new Float32Array(data.normals),
        colors: new Float32Array(data.colors),
        indices: new Uint32Array(data.indices),
        faceCount: data.faceCount,
        diagnostics: data.diagnostics,
      };

      task.resolve(result);
      if (task.cache) {
        deferTerrainCacheWrite(function () {
          storeLodGeometryInTerrainCache(
            task.cache.config,
            task.cache.lodKey,
            task.cache.geoOptions,
            result
          );
        });
      }
    } else {
      const result =
        type === 'chunkBundleGenerated'
          ? {
              chunkX: data.chunkX,
              chunkY: data.chunkY,
              chunkZ: data.chunkZ,
              chunkData: new Uint8Array(data.chunkData),
              meshData: {
                positions: new Float32Array(data.positions),
                normals: new Float32Array(data.normals),
                indices: new Uint32Array(data.indices),
                voxelTypes: new Uint8Array(data.voxelTypes),
              },
            }
          : {
              chunkX: data.chunkX,
              chunkY: data.chunkY,
              chunkZ: data.chunkZ,
              meshData: {
                positions: new Float32Array(data.positions),
                normals: new Float32Array(data.normals),
                indices: new Uint32Array(data.indices),
                voxelTypes: new Uint8Array(data.voxelTypes),
              },
            };

      task.resolve(result);
      if (type === 'chunkBundleGenerated' && task.cache) {
        deferTerrainCacheWrite(function () {
          storeChunkBundleInTerrainCache(
            task.cache.config,
            data.chunkX,
            data.chunkY,
            data.chunkZ,
            result.chunkData,
            result.meshData
          );
        });
      }
    }
    workerInterface.pendingTasks.delete(taskId);
  }

  workerInfo.busy = false;
  workerInfo.currentTaskId = null;
  workerInfo.currentTaskType = null;
  processQueue(workerInterface);
}

function handleWorkerError(workerInterface, workerInfo, error) {
  const task = workerInfo.currentTaskId
    ? workerInterface.pendingTasks.get(workerInfo.currentTaskId)
    : null;

  if (task) {
    task.reject(error instanceof Error ? error : new Error(String(error)));
    workerInterface.pendingTasks.delete(task.taskId);
  }

  workerInfo.busy = false;
  workerInfo.currentTaskId = null;
  workerInfo.currentTaskType = null;
  processQueue(workerInterface);
}

function processQueue(workerInterface) {
  if (
    workerInterface.urgentTaskQueue.length === 0 &&
    workerInterface.taskQueue.length === 0 &&
    workerInterface.backgroundTaskQueue.length === 0
  ) {
    return;
  }

  const availableWorker = workerInterface.workers.find(function (workerInfo) {
    return !workerInfo.busy;
  });
  if (!availableWorker) {
    return;
  }

  let task = workerInterface.urgentTaskQueue.shift();
  if (!task) {
    task = workerInterface.taskQueue.shift();
  }
  if (!task) {
    const availableWorkerCount = workerInterface.workers.filter(
      function (workerInfo) {
        return !workerInfo.busy;
      }
    ).length;

    if (availableWorkerCount <= workerInterface.backgroundWorkerReserve) {
      return;
    }

    task = workerInterface.backgroundTaskQueue.shift();
  }

  if (!task) {
    return;
  }

  availableWorker.busy = true;
  availableWorker.currentTaskId = task.taskId;
  availableWorker.currentTaskType = task.message.type;
  availableWorker.worker.postMessage(task.message);
}

function createTerrainWorkerInterface(options = {}) {
  const workerInterface = {
    workers: [],
    workerCount: options.workerCount || 2,
    backgroundWorkerReserve:
      typeof options.backgroundWorkerReserve === 'number'
        ? options.backgroundWorkerReserve
        : 1,
    taskQueue: [],
    urgentTaskQueue: [],
    backgroundTaskQueue: [],
    pendingTasks: new Map(),
    pendingCacheLookups: new Map(),
    cacheLookupQueue: [],
    backgroundCacheLookupQueue: [],
    activeCacheLookups: 0,
    activeBackgroundCacheLookups: 0,
    maxCacheLookups: 4,
    maxBackgroundCacheLookups: 1,
    onTerrainCacheLookup: options.onTerrainCacheLookup || null,
    initialized: false,
  };

  workerInterface.initialize = function () {
    if (workerInterface.initialized) {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      try {
        for (let i = 0; i < workerInterface.workerCount; i++) {
          const worker = new Worker(
            new URL('./terrain-worker.js', import.meta.url),
            { type: 'module' }
          );
          const workerInfo = {
            worker,
            busy: false,
            currentTaskId: null,
            currentTaskType: null,
          };

          worker.onmessage = function (event) {
            handleWorkerMessage(workerInterface, workerInfo, event.data);
          };
          worker.onerror = function (error) {
            handleWorkerError(workerInterface, workerInfo, error);
          };

          workerInterface.workers.push(workerInfo);
        }

        workerInterface.initialized = true;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  };

  workerInterface.generateChunkBundle = function (
    chunkX,
    chunkY,
    chunkZ,
    config,
    cacheOptions = {}
  ) {
    const taskId = `generateChunkBundle:${getTaskId(chunkX, chunkY, chunkZ)}`;
    const existingTask = workerInterface.pendingTasks.get(taskId);
    const shouldReadCache =
      canUseChunkCache() && cacheOptions.readCache !== false;
    const shouldWriteCache =
      canUseChunkCache() && cacheOptions.writeCache !== false;

    if (existingTask) {
      return existingTask.promise;
    }
    const existingLookup = workerInterface.pendingCacheLookups.get(taskId);

    if (shouldReadCache && existingLookup) {
      return existingLookup;
    }

    function enqueueChunkBundleTask(useCache) {
      const task = createTask('generateChunkBundle', chunkX, chunkY, chunkZ, {
        config,
      });
      if (useCache) {
        task.cache = { config };
      }
      return queueTask(workerInterface, task, {
        urgent: cacheOptions.urgent === true,
      });
    }

    if (!shouldReadCache) {
      return enqueueChunkBundleTask(shouldWriteCache);
    }

    const lookupPromise = queueCacheLookup(
      workerInterface,
      function () {
        return getCachedChunkBundle(config, chunkX, chunkY, chunkZ);
      },
      false
    )
      .then(function (cachedResult) {
        if (cachedResult) {
          notifyTerrainCacheLookup(
            workerInterface,
            cachedResult.persistentCacheHit,
            'chunk'
          );
          return cachedResult;
        }

        notifyTerrainCacheLookup(workerInterface, false, 'chunk');
        return enqueueChunkBundleTask(shouldWriteCache);
      })
      .catch(function (error) {
        warnCacheRead(error);
        notifyTerrainCacheLookup(workerInterface, false, 'chunk');
        return enqueueChunkBundleTask(shouldWriteCache);
      })
      .finally(function () {
        workerInterface.pendingCacheLookups.delete(taskId);
      });

    workerInterface.pendingCacheLookups.set(taskId, lookupPromise);
    return lookupPromise;
  };

  workerInterface.remeshChunk = function (
    chunkX,
    chunkY,
    chunkZ,
    config,
    chunkContexts = []
  ) {
    const taskId = `remeshChunk:${getTaskId(chunkX, chunkY, chunkZ)}`;
    const existingTask = workerInterface.pendingTasks.get(taskId);

    if (existingTask) {
      return existingTask.promise;
    }

    const task = createTask('remeshChunk', chunkX, chunkY, chunkZ, {
      config,
      chunkContexts,
    });
    return queueTask(workerInterface, task, { urgent: true });
  };

  workerInterface.generateLodGeometry = function (
    lodKey,
    config,
    geoOptions,
    queueOptions = {}
  ) {
    const taskId = `generateLodGeometry:${lodKey}`;
    const existingTask = workerInterface.pendingTasks.get(taskId);

    if (existingTask) {
      return existingTask.promise;
    }
    const existingLookup = workerInterface.pendingCacheLookups.get(taskId);

    if (existingLookup) {
      return existingLookup;
    }

    function enqueueLodGeometryTask(useCache) {
      let resolveTask;
      let rejectTask;
      const promise = new Promise(function (resolve, reject) {
        resolveTask = resolve;
        rejectTask = reject;
      });
      const task = {
        taskId,
        message: {
          type: 'generateLodGeometry',
          data: { lodKey, config, geoOptions },
        },
        promise,
        resolve: resolveTask,
        reject: rejectTask,
        cache: useCache ? { config, lodKey, geoOptions } : null,
      };

      return queueTask(workerInterface, task, {
        priority: queueOptions.priority,
        front: queueOptions.front,
        background: true,
      });
    }

    if (!canUseLodCache()) {
      return enqueueLodGeometryTask(false);
    }

    const lookupPromise = queueCacheLookup(
      workerInterface,
      function () {
        return getCachedLodGeometry(config, lodKey, geoOptions);
      },
      true
    )
      .then(function (cachedResult) {
        if (cachedResult) {
          notifyTerrainCacheLookup(
            workerInterface,
            cachedResult.persistentCacheHit,
            'lod'
          );
          return cachedResult;
        }

        notifyTerrainCacheLookup(workerInterface, false, 'lod');
        return enqueueLodGeometryTask(true);
      })
      .catch(function (error) {
        warnCacheRead(error);
        notifyTerrainCacheLookup(workerInterface, false, 'lod');
        return enqueueLodGeometryTask(true);
      })
      .finally(function () {
        workerInterface.pendingCacheLookups.delete(taskId);
      });

    workerInterface.pendingCacheLookups.set(taskId, lookupPromise);
    return lookupPromise;
  };

  workerInterface.unloadChunk = function (chunkX, chunkY, chunkZ, config) {
    const availableWorker = workerInterface.workers.find(function (workerInfo) {
      return !workerInfo.busy;
    });
    const targetWorker = availableWorker || workerInterface.workers[0];

    if (!targetWorker) {
      return;
    }

    targetWorker.worker.postMessage({
      type: 'unloadChunk',
      data: { chunkX, chunkY, chunkZ, config },
    });
  };

  workerInterface.terminate = function () {
    for (const workerInfo of workerInterface.workers) {
      workerInfo.worker.terminate();
    }
    workerInterface.workers = [];
    workerInterface.urgentTaskQueue = [];
    workerInterface.taskQueue = [];
    workerInterface.backgroundTaskQueue = [];
    workerInterface.pendingTasks.clear();
    workerInterface.pendingCacheLookups.clear();
    workerInterface.cacheLookupQueue = [];
    workerInterface.backgroundCacheLookupQueue = [];
    workerInterface.initialized = false;
  };

  return workerInterface;
}

export async function initializeTerrainWorkers(options = {}) {
  const workerInterface = createTerrainWorkerInterface(options);
  await workerInterface.initialize();
  return workerInterface;
}
