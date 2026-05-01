import { LoadingManager } from './loading-manager.js';
import { initRenderer, setupWindowing, toggleFullscreen } from './renderer.js';
import { initCamera } from './camera.js';
import { initScene } from './scene.js';
import { createRocket } from './rocket.js';
import { initControls } from './controls.js';
import { initGameLoop } from './game-loop.js';
import { createDetailProps } from './detail-props.js';
import { createSparseWorld } from './voxel.js';
import { createSoundtrackController } from './soundtrack.js';
import { createAudioSystem } from './audio-system.js';
import { soundtrackTracks } from 'virtual:music-tracks';
import * as THREE from 'three';
import * as Tone from 'tone';
import {
  createChunkManagerWithTerrain,
  loadChunksAround,
  warmupChunksAround,
} from './chunk-streaming.js';
import { CHUNK_SIZE_VOXELS, WORLD_UNITS_PER_VOXEL } from './world-units.js';
import { getChunkWorldSize } from './voxel.js';
import {
  INITIAL_LOAD_RADIUS,
  SOUNDTRACK_VOLUME,
  START_POSITION,
  STARTUP_FAR_SHELL_BUDGET_MS,
  STARTUP_FAR_SHELL_PRIORITY_SHELLS,
  STARTUP_MID_LOD_BUDGET_MS,
  STARTUP_MID_LOD_PRIORITY_CHUNKS,
  STARTUP_WARMUP_BUDGET_MS,
  STARTUP_WARMUP_RADIUS,
  STREAM_LOAD_RADIUS,
} from './game-config.js';
import { getActiveLevel } from './levels/index.js';
import {
  createFarShellSystemAsync,
  createMidLodSystemAsync,
} from './lod/far-visual-shell.js';
import { DEBUG, debugLog, debugWarn, debugError } from './debug.js';

var DEFAULT_LEVEL_SEED = 'rocket3d-dev-seed-01';

function hashLevelSeed(str) {
  var h = 1779033703 ^ str.length;
  for (var i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function setupWorld({ chunkSize = CHUNK_SIZE_VOXELS }) {
  // Create sparse world with chunk streaming
  const world = createSparseWorld(chunkSize, WORLD_UNITS_PER_VOXEL);

  return world;
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitForStartupBudget(
  promise,
  budgetMs,
  loadingManager,
  startPercent,
  endPercent,
  details
) {
  var complete = false;
  promise.then(function () {
    complete = true;
  });

  var startTime = performance.now();
  var deadline = startTime + budgetMs;

  while (!complete && performance.now() < deadline) {
    var progress = (performance.now() - startTime) / Math.max(1, budgetMs);
    loadingManager.setManualProgress(
      startPercent + (endPercent - startPercent) * progress,
      details
    );
    await delay(100);
  }

  loadingManager.setManualProgress(endPercent, details + ' complete');
}

function getStartupPosition(activeLevel) {
  if (activeLevel && activeLevel.startingChamber) {
    return activeLevel.startingChamber.center;
  }

  return START_POSITION;
}

function getStartupDirection(activeLevel) {
  if (!activeLevel || !activeLevel.graph || !activeLevel.startingChamber) {
    return null;
  }

  var from = activeLevel.startingChamber.center;
  var to = null;

  for (var i = 0; i < activeLevel.graph.tunnels.length; i++) {
    var tunnel = activeLevel.graph.tunnels[i];
    if (tunnel.from !== 'spawn') {
      continue;
    }

    for (var j = 0; j < activeLevel.graph.chambers.length; j++) {
      var chamber = activeLevel.graph.chambers[j];
      if (chamber.id === tunnel.to) {
        to = chamber.center;
        break;
      }
    }
    break;
  }

  if (!to) {
    return null;
  }

  var direction = new THREE.Vector3(
    to.x - from.x,
    to.y - from.y,
    to.z - from.z
  );

  if (direction.lengthSq() === 0) {
    return null;
  }

  return direction.normalize();
}

async function main() {
  try {
    // Initialize loading manager
    const loadingManager = new LoadingManager();
    const soundtrack = createSoundtrackController({
      tracks: soundtrackTracks,
      volume: SOUNDTRACK_VOLUME,
    });
    const audioSystem = createAudioSystem();

    soundtrack.installUnlockHandlers(window);
    soundtrack.load();
    audioSystem.installUnlockHandlers(window);

    function handleVisibilityChange() {
      if (document.hidden) {
        audioSystem.suspendAll();
        soundtrack.suspend();
      }
    }

    function handleBlur() {
      audioSystem.suspendAll();
      soundtrack.suspend();
    }

    function handleFocus() {
      if (Tone.context.state === 'suspended') {
        Tone.start();
      }
      if (soundtrack.getUiState().isEnabled) {
        soundtrack.load();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    const renderer = initRenderer();
    const world = setupWorld({ chunkSize: CHUNK_SIZE_VOXELS });
    const camera = initCamera(renderer.domElement);
    const scene = initScene();
    const rocket = createRocket(0xff0000); // Player = red

    const aiRockets = [
      createRocket(0xffd400), // AI 1 = yellow
      createRocket(0x4488ff), // AI 2 = blue
    ];

    var engineLight = new THREE.PointLight(0xff5500, 0.6, 22, 2);
    engineLight.position.set(0, 0, -5);
    rocket.add(engineLight);

    const aiEngineLightColors = [0xffaa00, 0x6699ff];
    for (let i = 0; i < aiRockets.length; i++) {
      var light = new THREE.PointLight(aiEngineLightColors[i], 0.35, 16, 2);
      light.position.set(0, 0, -5);
      aiRockets[i].add(light);
    }

    const totalChunks = Math.pow(INITIAL_LOAD_RADIUS * 2 + 1, 3);

    // Determine active level and derive seed
    var activeLevel = getActiveLevel();
    var startupPosition = getStartupPosition(activeLevel);
    var startupDirection = getStartupDirection(activeLevel);
    var levelSeedString = DEFAULT_LEVEL_SEED + ':' + activeLevel.seed;
    var levelSeedNumber = hashLevelSeed(levelSeedString);
    scene.userData.levelLoadStartTime = performance.now();
    scene.userData.levelLoadCompleteTime = null;

    // Create chunk manager with terrain generation
    const chunkManager = createChunkManagerWithTerrain(
      world,
      { scene },
      {
        seed: levelSeedNumber,
        showChunkBoundaries: false, // Disable chunk boundary visualization for better performance
        loadRadius: STREAM_LOAD_RADIUS,
        unloadRadius: STREAM_LOAD_RADIUS + 1,
        biomeLightsEnabled: false,
        biomeLightBudget: 3,
        biomeLightRange: 42,
        forwardBiasChunks: 2.6,
        maxConcurrentChunkLoads: 3,
        maxChunkMeshesPerFrame: 1,
        maxModifiedChunksPerFrame: 1,
        level: activeLevel,
        onChunkLoaded: function () {
          loadingManager.chunkLoaded();
        },
        onChunkMeshed: function () {
          loadingManager.chunkMeshed();
        },
        onChunkEmpty: function () {
          loadingManager.chunkEmpty();
        },
      }
    );

    await chunkManager.initializeWorkers();
    loadingManager.setTotalChunks(totalChunks);

    if (activeLevel.fog) {
      scene.fog = new THREE.Fog(
        activeLevel.fog.color || 0x6b8a7e,
        activeLevel.fog.near != null ? activeLevel.fog.near : 40,
        activeLevel.fog.far != null ? activeLevel.fog.far : 220
      );
      scene.background = new THREE.Color(activeLevel.fog.color || 0x8eaaa0);
    }

    var chunkWorldSize = getChunkWorldSize(world);
    var fullChunkWorldRadius = chunkManager.loadRadius * chunkWorldSize;
    var midLodOuterWorldRadius = 384;
    var safetyMargin = 0;
    var minimumFarShellDistance =
      Math.max(fullChunkWorldRadius, midLodOuterWorldRadius) + safetyMargin;
    var farShell4Start = 384;
    var farShell8Start = 768;

    // Note: LOD systems will be initialized after loading screen is hidden to prevent blocking startup.

    debugLog('[LODArchitecture]', {
      lod0: {
        name: 'full chunks',
        blockSize: 1,
        start: 0,
        end: fullChunkWorldRadius,
        renderer: 'chunk-streaming',
      },
      lod1: {
        name: 'mid chunks',
        blockSize: 2,
        start: fullChunkWorldRadius,
        end: midLodOuterWorldRadius,
        renderer: 'midLodSystem',
      },
      lod2: {
        name: 'far shell',
        blockSize: 4,
        start: farShell4Start,
        end: farShell8Start,
        renderer: 'farShellSystem',
      },
      lod3: {
        name: 'ultra far shell',
        blockSize: 8,
        start: farShell8Start,
        end: Infinity,
        renderer: 'farShellSystem',
      },
      farShellControlsMidLod: false,
    });

    function validateLodBands(bands) {
      for (var i = 0; i < bands.length - 1; i++) {
        var current = bands[i];
        var next = bands[i + 1];
        if (current.end < next.start) {
          debugWarn('[LODGap]', {
            from: current.name,
            to: next.name,
            gapStart: current.end,
            gapEnd: next.start,
            gapSize: next.start - current.end,
          });
        }
        if (current.end > next.start) {
          debugWarn('[LODOverlap]', {
            from: current.name,
            to: next.name,
            overlapStart: next.start,
            overlapEnd: current.end,
            overlapSize: current.end - next.start,
          });
        }
      }
    }

    validateLodBands([
      { name: 'LOD0 full chunks', start: 0, end: fullChunkWorldRadius },
      {
        name: 'LOD1 mid chunks',
        start: fullChunkWorldRadius,
        end: midLodOuterWorldRadius,
      },
      { name: 'LOD2 far shell', start: farShell4Start, end: farShell8Start },
      { name: 'LOD3 ultra far shell', start: farShell8Start, end: Infinity },
    ]);

    debugLog('[LODTransitions]', {
      lod0End: fullChunkWorldRadius,
      lod1Start: fullChunkWorldRadius,
      lod1End: 400,
      lod2Start: 384,
      lod2End: 784,
      lod3Start: 768,
      lod0Lod1Overlap: fullChunkWorldRadius - fullChunkWorldRadius,
      lod1Lod2Overlap: 400 - 384,
      lod2Lod3Overlap: 784 - 768,
    });

    loadingManager.setManualProgress(2, 'Initializing terrain workers...');
    await loadChunksAround(chunkManager, startupPosition, INITIAL_LOAD_RADIUS, {
      maxConcurrentChunkLoads: 8,
      maxChunkMeshesPerFrame: 8,
      streamDirection: startupDirection,
    });
    loadingManager.setManualProgress(25, 'Core launch area complete');

    var lodSystems = {
      startupPreview: null,
      midLod: null,
    };
    var startupMidLodSystem = createMidLodSystemAsync(
      chunkManager,
      chunkWorldSize,
      chunkManager.generator.playfieldBounds,
      midLodOuterWorldRadius,
      startupPosition,
      {
        priorityChunkCount: STARTUP_MID_LOD_PRIORITY_CHUNKS,
        priorityDirection: startupDirection,
      }
    );
    if (startupMidLodSystem) {
      lodSystems.midLod = startupMidLodSystem;
      await waitForStartupBudget(
        startupMidLodSystem.priorityChunksReady,
        STARTUP_MID_LOD_BUDGET_MS,
        loadingManager,
        25,
        80,
        'Building near LOD'
      );
    }

    var fogOptions = scene.fog
      ? {
          color: scene.fog.color.getHex(),
          near: scene.fog.near,
          far: scene.fog.far,
        }
      : null;
    var startupFarShellGroup = null;
    if (
      activeLevel.farShell &&
      activeLevel.farShell.enabled &&
      activeLevel.farShell.shells
    ) {
      startupFarShellGroup = createFarShellSystemAsync(
        chunkManager,
        activeLevel.farShell.shells,
        fogOptions,
        minimumFarShellDistance,
        {
          priorityShellCount: STARTUP_FAR_SHELL_PRIORITY_SHELLS,
        }
      );
      await waitForStartupBudget(
        startupFarShellGroup.userData.priorityShellsReady,
        STARTUP_FAR_SHELL_BUDGET_MS,
        loadingManager,
        80,
        88,
        'Building far terrain shell'
      );
    }

    loadingManager.setManualProgress(88, 'Warming outer terrain...');
    await warmupChunksAround(
      chunkManager,
      startupPosition,
      STARTUP_WARMUP_RADIUS,
      STARTUP_WARMUP_BUDGET_MS,
      {
        maxConcurrentChunkLoads: 8,
        maxChunkMeshesPerFrame: 8,
        streamDirection: startupDirection,
        onProgress: function (progress) {
          loadingManager.setManualProgress(
            88 + 6 * progress,
            'Warming outer terrain...'
          );
        },
      }
    );
    loadingManager.setManualProgress(94, 'Outer terrain warmup complete');

    const detailProps = await createDetailProps(chunkManager.generator, world);
    loadingManager.setManualProgress(98, 'Preparing launch...');
    scene.add(detailProps);
    if (startupMidLodSystem) {
      scene.add(startupMidLodSystem.group);
      startupMidLodSystem.syncVisibility(chunkManager, rocket.position);
    }
    if (startupFarShellGroup) {
      scene.add(startupFarShellGroup);
    }
    scene.add(rocket);
    for (let i = 0; i < aiRockets.length; i++) {
      scene.add(aiRockets[i]);
    }
    setupWindowing(renderer, camera);
    const pollInputs = initControls(window);
    const { gameLoop } = initGameLoop(
      renderer,
      scene,
      camera,
      rocket,
      aiRockets,
      detailProps,
      pollInputs,
      world,
      chunkManager,
      soundtrack,
      audioSystem,
      lodSystems,
      function () {
        toggleFullscreen();
      },
      activeLevel
    );

    // Periodic terrain LOD distance debug logging
    var farShellBands;
    if (
      activeLevel.farShell &&
      activeLevel.farShell.enabled &&
      activeLevel.farShell.shells
    ) {
      farShellBands = activeLevel.farShell.shells.map(function (s) {
        return { blockSize: s.blockSize, fadeNear: s.fadeNear };
      });
    } else {
      farShellBands = [];
    }

    if (DEBUG) {
      setInterval(function () {
        var pos = rocket.position;
        debugLog('[TerrainLOD]', {
          playerPosition: {
            x: Math.round(pos.x),
            y: Math.round(pos.y),
            z: Math.round(pos.z),
          },
          chunkSize: chunkWorldSize,
          chunkLoadRadius: chunkManager.loadRadius,
          fullChunkWorldRadius: fullChunkWorldRadius,
          farShellEnabled: activeLevel.farShell
            ? activeLevel.farShell.enabled
            : false,
          farShellNearestVisibleDistance: minimumFarShellDistance,
          farShellBands: farShellBands,
        });
      }, 5000);
    }

    // Hide loading screen and start the game
    setTimeout(function () {
      loadingManager.setManualProgress(100, 'Launch ready');
      loadingManager.hideLoadingScreen();
      gameLoop();
    }, 100);
  } catch (error) {
    debugError('Failed to start game:', error);
  }
}

if (typeof window !== 'undefined') {
  main();
}

export { main };
