// Worker interface for generating complete chunk data and mesh bundles.
import { debugWarn } from './debug.js';

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
  };
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
      task.resolve({
        lodKey: data.lodKey,
        positions: new Float32Array(data.positions),
        normals: new Float32Array(data.normals),
        colors: new Float32Array(data.colors),
        indices: new Uint32Array(data.indices),
        faceCount: data.faceCount,
        diagnostics: data.diagnostics,
      });
    } else {
      task.resolve(
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
            }
      );
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

  let task = workerInterface.taskQueue.shift();
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
    backgroundTaskQueue: [],
    pendingTasks: new Map(),
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
    config
  ) {
    const taskId = `generateChunkBundle:${getTaskId(chunkX, chunkY, chunkZ)}`;
    const existingTask = workerInterface.pendingTasks.get(taskId);

    if (existingTask) {
      return existingTask.promise;
    }

    const task = createTask('generateChunkBundle', chunkX, chunkY, chunkZ, {
      config,
    });
    workerInterface.pendingTasks.set(taskId, task);
    workerInterface.taskQueue.push(task);
    processQueue(workerInterface);

    return task.promise;
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
    workerInterface.pendingTasks.set(taskId, task);
    workerInterface.taskQueue.push(task);
    processQueue(workerInterface);

    return task.promise;
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
    };

    workerInterface.pendingTasks.set(taskId, task);
    if (queueOptions.priority === true) {
      workerInterface.taskQueue.push(task);
    } else if (queueOptions.front === true) {
      workerInterface.backgroundTaskQueue.unshift(task);
    } else {
      workerInterface.backgroundTaskQueue.push(task);
    }
    processQueue(workerInterface);

    return task.promise;
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
    workerInterface.taskQueue = [];
    workerInterface.pendingTasks.clear();
    workerInterface.initialized = false;
  };

  return workerInterface;
}

export async function initializeTerrainWorkers(options = {}) {
  const workerInterface = createTerrainWorkerInterface(options);
  await workerInterface.initialize();
  return workerInterface;
}
