import * as THREE from 'three';
import { initPhysics } from './physics.js';
import { initFlameSystem, initControlThrusters } from './flames.js';
import { initWeaponSystem } from './weapon-system.js';
import { resetGlobalWeaponBudgets } from './weapon-system.js';
import { initAiPlayer } from './ai-player.js';
import {
  addStats,
  createUI,
  updateUI,
  updateOptions,
  updateSpatialLocatorHud,
  setDevMode,
  showToast,
} from './ui.js';
import { updateChunkManager } from './chunk-streaming.js';
import { raycastVoxelSegmentBudgeted } from './voxel-ray-traversal.js';
import { resetWorldPerformanceStats } from './voxel.js';
import {
  ROCKET_BACKWARD_LOCAL,
  ROCKET_FORWARD_LOCAL,
  transformRocketLocalVector,
  transformRocketLocalPoint,
  getRocketBackwardVector,
  getRocketForwardVector,
  getRocketUpVector,
} from './rocket-orientation.js';
import { ROCKET_TARGET_ANCHOR } from './rocket-voxels.js';
import {
  PERSPECTIVE_THIRD_PERSON,
  PERSPECTIVE_OBSERVER,
  initCameraState,
  updateCameraState,
  calculateCameraPosition,
  switchPerspective,
  updateCameraReset,
  updatePerspectiveTransition,
} from './camera-controls.js';
import { START_POSITION } from './game-config.js';
import {
  refreshDetailPropsVisibility,
  updateDetailPropsAnimation,
} from './detail-props.js';
import { LOD_DEBUG_COLORS } from './lod/lod-constants.js';
import { applyLodDistanceFade } from './lod/far-visual-shell.js';
import { DEBUG } from './debug.js';
import { initWindField } from './wind-field.js';
import { initWindParticles } from './wind-particles.js';

function initGameLoop(
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
  toggleFullscreen,
  activeLevel,
  gameConfig,
  gameMenu
) {
  const INV_MAX_FPS = 1 / 60;
  let frameDelta = 0;
  const timer = new THREE.Timer();

  const stats = addStats(document.body);
  stats.dom.style.display = 'none';
  const { hud } = createUI();

  let inputs;
  let physicsState = {};
  let rocketDestroyed = false;
  let hudEnabled = true;
  let crosshairEnabled = true;
  let devMode = false;
  let gamePaused = false;
  let pauseOverlayMode = 'pause';
  let debugLod0ChunksEnabled = true;
  var farShellDebugMode = 0;
  var fullChunkDebugMaterial = new THREE.MeshBasicMaterial({
    color: LOD_DEBUG_COLORS.FULL_CHUNKS,
    vertexColors: false,
    fog: false,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    side: THREE.FrontSide,
  });
  var lodOwnershipLogCounter = 0;
  var farShellState = {
    enabled: true,
    debugColors: false,
    visibleMeshes: 0,
    visibleTriangles: 0,
    opacity: 0.85,
    nearestVisibleDistance: 96,
    blockSizes: [2, 4, 8],
  };

  function updatePauseOverlay() {
    var pauseOverlay = document.getElementById('menus');

    if (pauseOverlay) {
      pauseOverlay.style.display =
        gamePaused && pauseOverlayMode === 'pause' ? 'block' : 'none';
    }

    if (!gameMenu) {
      return;
    }

    if (gamePaused && pauseOverlayMode === 'menu') {
      gameMenu.openPauseMenu(gameConfig);
      return;
    }

    gameMenu.close();
  }

  function setPauseState(nextPaused, overlayMode) {
    if (!nextPaused) {
      if (!gamePaused) {
        return;
      }

      gamePaused = false;
      updatePauseOverlay();
      timer.update();
      if (audioSystem && typeof audioSystem.playUnpause === 'function') {
        audioSystem.playUnpause();
      }
      if (soundtrack && soundtrack.getUiState().isEnabled) {
        soundtrack.load();
      }
      return;
    }

    pauseOverlayMode = overlayMode || 'pause';

    if (!gamePaused) {
      gamePaused = true;
      frameDelta = 0;
      if (audioSystem && typeof audioSystem.playPause === 'function') {
        audioSystem.playPause();
      }
      if (audioSystem && typeof audioSystem.suspendAll === 'function') {
        audioSystem.suspendAll();
      }
      if (soundtrack && typeof soundtrack.suspend === 'function') {
        soundtrack.suspend();
      }
    }

    updatePauseOverlay();
  }

  if (gameMenu && typeof gameMenu.setResumeHandler === 'function') {
    gameMenu.setResumeHandler(function () {
      setPauseState(false);
    });
  }

  setDevMode(devMode);
  stats.dom.style.display = devMode ? 'block' : 'none';
  let frameCount = 0;
  let fpsUpdateTime = 0;
  let currentFPS = 0;
  let lastUiUpdateTime = 0;
  let lastShadowUpdateTime = 0;
  let lastLodVisibilityUpdateTime = 0;
  let lastDetailPropVisibilityUpdateTime = 0;
  const UI_UPDATE_INTERVAL_MS = 125;
  const LOD_VISIBILITY_INTERVAL_MS = 150;
  const DETAIL_PROP_VISIBILITY_INTERVAL_MS = 250;
  const SHADOW_UPDATE_INTERVAL_MS = 100;
  const OBSERVER_RECUT_COOLDOWN_MS = 300;
  const OBSERVER_FOCUS_RADIUS = 18;
  const OBSERVER_FOCUS_RADIUS_SQ =
    OBSERVER_FOCUS_RADIUS * OBSERVER_FOCUS_RADIUS;
  const AI_NEAR_AUDIO_RADIUS = 250;
  const AI_NEAR_AUDIO_RADIUS_SQ = AI_NEAR_AUDIO_RADIUS * AI_NEAR_AUDIO_RADIUS;
  const LANDING_PAD_QUERY_RADIUS = 28;
  const LANDING_PAD_HEAL_PER_SECOND = 9;
  const LANDING_PAD_STILL_SPEED = 0.45;
  const LANDING_PAD_TAIL_ALIGN_THRESHOLD = 0.2;
  const LANDING_PAD_CAPTURE_ALIGNMENT = 0.72;
  const LANDING_PAD_VERTICAL_ALIGN_MIN = 0.78;
  const LANDING_PAD_VERTICAL_PULL_HEIGHT = 44;
  const LANDING_PAD_VERTICAL_PULL_FALLOFF = 18;
  const LANDING_PAD_SOFT_CAPTURE_DISTANCE = 26;
  const LANDING_PAD_CAPTURE_DISTANCE = 12;
  const LANDING_PAD_SETTLE_DISTANCE = 12;
  const LANDING_PAD_TAIL_CLEARANCE = 7.2;
  const LANDING_PAD_RELEASE_THRUST = 0.78;
  const LANDING_PAD_RELEASE_SPEED = 1.25;
  const LANDING_PAD_RELEASE_COOLDOWN_MS = 420;
  const LANDING_PAD_RELEASE_RECOVERY_MS = 1800;
  const LANDING_PAD_RELEASE_HOLD_MS = 180;
  const LANDING_PAD_RELEASE_CHARGE_RATE = 0.5;
  const LANDING_CAMERA_LOST_GRACE_MS = 360;
  const LANDING_CAMERA_TRANSITION_SPEED = 0.022;
  const LANDING_CAMERA_RETURN_SPEED = 0.026;
  const THIRD_PERSON_CAMERA_LERP_MIN = 0.026;
  const THIRD_PERSON_CAMERA_LERP_MAX = 0.16;
  const THIRD_PERSON_CAMERA_EASE_DISTANCE = 18;
  const THIRD_PERSON_ROTATION_LERP_MIN = 0.055;
  const THIRD_PERSON_ROTATION_LERP_MAX = 0.18;
  const THIRD_PERSON_ROTATION_EASE_ANGLE = Math.PI * 0.75;
  const THIRD_PERSON_ROTATION_SNAP_ANGLE = 0.22;
  const THIRD_PERSON_ROTATION_SNAP_BOOST = 0.22;
  const THIRD_PERSON_ROTATION_LOCK_ANGLE = 0.006;
  const THIRD_PERSON_SPEED_LAG = 0.85;
  const CAMERA_BLAST_OFFSET_MAX = 8.5;
  const CAMERA_BLAST_DECAY = 0.984;
  const CAMERA_BLAST_SHAKE_MAX = 3.8;
  const CAMERA_BLAST_SHAKE_DECAY = 0.975;
  const DEATH_CAMERA_BLEND_MS = 1500;
  const ROCKET_SPAWN_FADE_DURATION_MS = 1650;
  const ROCKET_RESPAWN_DELAY_MS = 9750;
  const AI_RESPAWN_DELAY_MS = 5200;
  const EXPLOSION_FLARE_COUNT = 170;
  const EXPLOSION_SMOKE_COUNT = 180;
  const EXPLOSION_FLARE_MAX_LIFE = 7.875;
  const EXPLOSION_SMOKE_MAX_LIFE = 12.375;
  const EXPLOSION_FLARE_DRAG = 0.992;
  const EXPLOSION_SMOKE_DRAG = 0.996;
  const EXPLOSION_SMOKE_LIFT = 0.0018;
  const EXPLOSION_FLASH_MAX_SCALE = 10.5;
  const EXPLOSION_FLASH_GROWTH = 2.2;
  const LANDING_PAD_LIGHT_BASE_INTENSITY = 1.35;
  const LANDING_PAD_LIGHT_PULSE_INTENSITY = 1.85;
  const LANDING_PAD_LIGHT_DISTANCE = 26;

  if (activeLevel && activeLevel.startingChamber) {
    const center = activeLevel.startingChamber.center;
    rocket.position.set(center.x, center.y, center.z);
  } else {
    rocket.position.set(START_POSITION.x, START_POSITION.y, START_POSITION.z);
  }

  if (activeLevel && activeLevel.startingRotation) {
    rocket.rotation.set(
      activeLevel.startingRotation.x || 0,
      activeLevel.startingRotation.y || 0,
      activeLevel.startingRotation.z || 0
    );
  }

  const updatePhysics = initPhysics(
    INV_MAX_FPS,
    rocket,
    scene,
    world,
    audioSystem
  );
  const updateFlames = initFlameSystem(rocket, scene);
  const updateControlThrusters = initControlThrusters(rocket, scene);
  const windField = initWindField(activeLevel);
  const windParticles = initWindParticles(scene);
  function applyPlayerDamage(amount, impactStrength) {
    if (playerSpawnProtected) {
      return null;
    }

    return updatePhysics.applySelfDamage(amount, impactStrength);
  }

  function getTargetIdFromRocket(rocketObj) {
    for (let i = 0; i < aiData.length; i++) {
      if (rocketObj === aiData[i].rocket) {
        return 'ai' + i;
      }
    }
    return null;
  }

  function getAiEntryFromTargetId(targetId) {
    if (targetId && targetId.startsWith('ai')) {
      const index = parseInt(targetId.slice(2), 10);
      if (index >= 0 && index < aiData.length) {
        return aiData[index];
      }
    }
    return null;
  }

  const aiData = aiRockets.map(function (aiRocket, index) {
    const updateAiPhysics = initPhysics(
      INV_MAX_FPS,
      aiRocket,
      scene,
      world,
      null
    );
    const updateAiFlames = initFlameSystem(aiRocket, scene);
    const updateAiControlThrusters = initControlThrusters(aiRocket, scene);

    const entry = {
      rocket: aiRocket,
      physics: updateAiPhysics,
      flames: updateAiFlames,
      controlThrusters: updateAiControlThrusters,
      index: index,
      destroyed: true,
      respawnAtTime: 0,
      spawnFadeActive: false,
      previousHealth: 100,
      spawnPosition: new THREE.Vector3(),
      spawnFadeStartTime: performance.now(),
    };

    function getAiAudioMix(soundPosition) {
      if (!audioSystem || !aiEnabled || entry.destroyed || !aiRocket.visible) {
        return 0;
      }

      var sourcePos = soundPosition || aiRocket.position;
      var distanceSq = rocket.position.distanceToSquared(sourcePos);

      if (distanceSq >= AI_NEAR_AUDIO_RADIUS_SQ) {
        return 0;
      }

      var normalizedDistance = Math.sqrt(distanceSq) / AI_NEAR_AUDIO_RADIUS;
      var proximity = 1 - normalizedDistance;

      return proximity * proximity;
    }

    const aiAudioProxy = audioSystem
      ? {
          playImpact: function () {
            var mix = getAiAudioMix();

            if (mix <= 0 || typeof audioSystem.playImpact !== 'function') {
              return;
            }

            audioSystem.playImpact(mix * 0.6);
          },
          playMissileExplosion: function () {
            var mix = getAiAudioMix();

            if (
              mix <= 0 ||
              typeof audioSystem.playMissileExplosion !== 'function'
            ) {
              return;
            }

            audioSystem.playMissileExplosion(false, mix * 0.7);
          },
          playMissileLaunch: function () {
            var mix = getAiAudioMix();

            if (
              mix <= 0 ||
              typeof audioSystem.playMissileLaunch !== 'function'
            ) {
              return;
            }

            audioSystem.playMissileLaunch(mix * 0.65);
          },
          playShot: function () {
            var mix = getAiAudioMix();

            if (mix <= 0 || typeof audioSystem.playShot !== 'function') {
              return;
            }

            audioSystem.playShot(mix * 0.5);
          },
          playShotgun: function () {
            var mix = getAiAudioMix();

            if (mix <= 0 || typeof audioSystem.playShotgun !== 'function') {
              return;
            }

            audioSystem.playShotgun(mix * 0.55);
          },
        }
      : null;

    const aiWeaponSystem = initWeaponSystem(
      aiRocket,
      scene,
      world,
      aiAudioProxy,
      updateAiPhysics.applyImpulse,
      updateAiPhysics.applySelfDamage,
      null,
      {
        rocket,
        applyDamage: applyPlayerDamage,
        applyImpulse: updatePhysics.applyImpulse,
        isActive: function () {
          return rocket.visible && !rocketDestroyed;
        },
      },
      function () {
        const aiLockInfo = aiPlayer.getLockInfo();
        return {
          isLocked: aiLockInfo.isLocked,
          targetId: aiLockInfo.isLocked ? 'player' : null,
        };
      },
      function (targetId) {
        if (targetId === 'player' && rocket.visible && !rocketDestroyed) {
          const targetAnchor = new THREE.Vector3();
          transformRocketLocalPoint(
            rocket,
            new THREE.Vector3(
              ROCKET_TARGET_ANCHOR.x,
              ROCKET_TARGET_ANCHOR.y,
              ROCKET_TARGET_ANCHOR.z
            ),
            targetAnchor
          );
          return targetAnchor;
        }
        return null;
      },
      true
    );
    const updateAiWeaponSystem = aiWeaponSystem.update;
    const aiPlayer = initAiPlayer(
      aiRocket,
      rocket,
      world,
      chunkManager.generator ? chunkManager.generator.graph : null,
      index
    );

    entry.weaponSystem = aiWeaponSystem;
    entry.updateWeaponSystem = updateAiWeaponSystem;
    entry.player = aiPlayer;
    entry.audioMix = getAiAudioMix;
    entry.audioProxy = aiAudioProxy;

    return entry;
  });

  const weaponSystem = initWeaponSystem(
    rocket,
    scene,
    world,
    audioSystem,
    updatePhysics.applyImpulse,
    applyPlayerDamage,
    triggerCameraBlast,
    aiData.map(function (entry) {
      return {
        rocket: entry.rocket,
        applyDamage: entry.physics.applySelfDamage,
        applyImpulse: entry.physics.applyImpulse,
        isActive: function () {
          return entry.rocket.visible && !entry.destroyed;
        },
      };
    }),
    function () {
      const isLocked =
        hud.lockState === 'locked' || hud.lockState === 'decaying';
      var targetId = null;
      if (isLocked && hud.lockedTargetRocket) {
        targetId = getTargetIdFromRocket(hud.lockedTargetRocket);
      }
      return {
        isLocked: isLocked,
        targetId: targetId,
      };
    },
    function (targetId) {
      const entry = getAiEntryFromTargetId(targetId);
      if (entry && entry.rocket.visible && !entry.destroyed) {
        const targetAnchor = new THREE.Vector3();
        transformRocketLocalPoint(
          entry.rocket,
          new THREE.Vector3(
            ROCKET_TARGET_ANCHOR.x,
            ROCKET_TARGET_ANCHOR.y,
            ROCKET_TARGET_ANCHOR.z
          ),
          targetAnchor
        );
        return targetAnchor;
      }
      return null;
    }
  );
  const updateWeaponSystem = weaponSystem.update;

  const rocketMaterial = rocket.material;
  const rocketBaseEmissive = rocketMaterial.emissive.clone();
  const rocketBaseEmissiveIntensity = rocketMaterial.emissiveIntensity;
  const rocketBaseColor = rocketMaterial.color.clone();
  for (let i = 0; i < aiData.length; i++) {
    const entry = aiData[i];
    const mat = entry.rocket.material;
    entry.baseEmissive = mat.emissive.clone();
    entry.baseEmissiveIntensity = mat.emissiveIntensity;
    entry.baseColor = mat.color.clone();
    mat.transparent = true;
    mat.opacity = 0;
    entry.physics.setInvulnerable(true);
  }
  const rocketFadeColor = new THREE.Color(0xffffff);
  const rocketFadeEmissive = new THREE.Color(0xffddaa);
  const neutralInputs = {
    rollLeft: 0,
    rollRight: 0,
    pitchDown: 0,
    pitchUp: 0,
    thrust: 0,
    brake: 0,
    fire: 0,
  };

  rocketMaterial.transparent = true;
  rocketMaterial.opacity = 0;
  updatePhysics.setInvulnerable(true);
  for (let i = 0; i < aiData.length; i++) {
    const entry = aiData[i];
    entry.rocket.material.transparent = true;
    entry.rocket.material.opacity = 0;
    entry.physics.setInvulnerable(true);
  }

  // Initialize camera state
  const cameraState = initCameraState();

  camera.position.set(0, 1, 10);

  // Store previous up vector for smoothing
  const previousUp = new THREE.Vector3(0, 1, 0);
  const desiredCameraPosition = new THREE.Vector3();
  const cameraAnchor = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const cameraLagOffset = new THREE.Vector3();
  const cameraLookTarget = new THREE.Vector3();
  const cameraChaseQuaternion = new THREE.Quaternion();
  const landingPadTargetQuaternion = new THREE.Quaternion();
  const rocketUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const firstPersonLookDirection = new THREE.Vector3();
  const chaseLookDirection = new THREE.Vector3();
  const rocketViewTarget = new THREE.Vector3();
  const observerFocusPoint = new THREE.Vector3();
  const observerOffset = new THREE.Vector3();
  const observerCandidatePosition = new THREE.Vector3();
  const observerBestPosition = new THREE.Vector3();
  const observerBestDirection = new THREE.Vector3();
  const observerPosition = new THREE.Vector3();
  const rocketTailPosition = new THREE.Vector3();
  const rocketTailDirection = new THREE.Vector3();
  const landingPadDockDirection = new THREE.Vector3();
  const landingPadOffset = new THREE.Vector3();
  const landingPadPull = new THREE.Vector3();
  const landingPadClosestPoint = new THREE.Vector3();
  const landingPadApproachPoint = new THREE.Vector3();
  const landingPadCenterOffset = new THREE.Vector3();
  const sunPosition = new THREE.Vector3();
  const sunTargetPosition = new THREE.Vector3();
  const activeOpeningPosition = new THREE.Vector3();
  const activeOpeningOffset = new THREE.Vector3();
  const detailWindDirection = new THREE.Vector3();
  const actionInputs = {};
  const observerAngleOffsets = [0, -0.7, 0.7, -1.35, 1.35];
  const observerDistanceFactors = [1, 0.82, 0.68];
  const observerHeightFactors = [1, 0.82];
  let observerHasShot = false;
  let observerShotAngle = cameraState.horizontalAngle;
  let observerShotDistance = cameraState.distance;
  let observerShotHeight = cameraState.heightOffset;
  let lastObserverCutTime = Number.NEGATIVE_INFINITY;
  let previousPerspective = cameraState.currentPerspective;
  let observerDidCut = false;
  let respawnAtTime = Number.POSITIVE_INFINITY;
  let spawnFadeStartTime = performance.now();
  let spawnFadeActive = true;
  let playerSpawnProtected = true;
  let deathCameraActive = false;
  let deathCameraStartTime = Number.NEGATIVE_INFINITY;
  let cameraBlastShakeStrength = 0;
  let cameraBlastShakeTime = 0;
  let previousHealth = 100;
  let aiEnabled = false;

  const explosionFlareParticles = [];
  const explosionSmokeParticles = [];
  const flareVelocity = new THREE.Vector3();
  const smokeVelocity = new THREE.Vector3();
  const flareOffset = new THREE.Vector3();
  const smokeOffset = new THREE.Vector3();
  const deathCameraStartPosition = new THREE.Vector3();
  const deathCameraPosition = new THREE.Vector3();
  const deathCameraTargetPosition = new THREE.Vector3();
  const deathCameraLookTarget = new THREE.Vector3();
  const cameraBlastDirection = new THREE.Vector3();
  const cameraBlastOffset = new THREE.Vector3();
  const cameraBlastPosition = new THREE.Vector3();
  const cameraBlastShakeOffset = new THREE.Vector3();
  const landingPadLightOffset = new THREE.Vector3();
  const targetAnchorLocal = new THREE.Vector3(
    ROCKET_TARGET_ANCHOR.x,
    ROCKET_TARGET_ANCHOR.y,
    ROCKET_TARGET_ANCHOR.z
  );
  const targetLosStart = new THREE.Vector3();
  const targetLosEnd = new THREE.Vector3();
  let landingCameraActive = false;
  let landingCameraWasAutoActivated = false;
  let landingCameraPadLostAt = Number.NEGATIVE_INFINITY;
  let activeDockedPad = null;
  let landingPadReleaseUntil = Number.NEGATIVE_INFINITY;
  let landingPadReleaseChargeMs = 0;
  let landingPadReleaseSuppression = 0;
  const spawnPosition =
    activeLevel && activeLevel.startingChamber
      ? new THREE.Vector3(
          activeLevel.startingChamber.center.x,
          activeLevel.startingChamber.center.y,
          activeLevel.startingChamber.center.z
        )
      : new THREE.Vector3(START_POSITION.x, START_POSITION.y, START_POSITION.z);

  const landingPadLight = new THREE.PointLight(
    0xff7a1f,
    0,
    LANDING_PAD_LIGHT_DISTANCE,
    2
  );
  landingPadLight.visible = false;
  scene.add(landingPadLight);

  rocket.position.copy(spawnPosition);
  rocket.visible = true;
  for (let i = 0; i < aiData.length; i++) {
    const entry = aiData[i];
    getNextAiSpawnPosition(entry.spawnPosition);
    if (i > 0) {
      entry.spawnPosition.x += 15 * i;
      entry.spawnPosition.z += 15 * i;
    }
    entry.rocket.position.copy(entry.spawnPosition);
    entry.rocket.visible = false;
  }

  cameraChaseQuaternion.copy(rocket.quaternion);
  observerFocusPoint.copy(rocket.position);

  for (let i = 0; i < aiData.length; i++) {
    const entry = aiData[i];
    entry.physics.setActive(false);
    entry.physics.setInvulnerable(false);
    entry.destroyed = true;
    entry.respawnAtTime = 0;
    entry.spawnFadeActive = false;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  function updateLandingPadInteraction(deltaSeconds) {
    landingCameraActive = false;
    const currentTime = performance.now();

    landingPadLight.visible = false;
    landingPadLight.intensity = 0;

    if (
      activeDockedPad &&
      activeDockedPad.userData &&
      activeDockedPad.userData.landingPad
    ) {
      activeDockedPad.userData.landingPad.landingActive = false;
    }

    if (landingPadReleaseSuppression > 0) {
      landingPadReleaseSuppression = Math.max(
        0,
        landingPadReleaseSuppression -
          (deltaSeconds * 1000) / LANDING_PAD_RELEASE_RECOVERY_MS
      );
    }

    if (!playerSpawnProtected) {
      updatePhysics.setInvulnerable(false);
    }

    if (
      rocketDestroyed ||
      !physicsState ||
      !physicsState.active ||
      typeof world.getLandingPadsNearPoint !== 'function'
    ) {
      return;
    }

    if (currentTime < landingPadReleaseUntil) {
      landingPadReleaseChargeMs = 0;
    }

    rocketTailPosition.set(0, 0, -6.4);
    transformRocketLocalPoint(rocket, rocketTailPosition, rocketTailPosition);
    getRocketBackwardVector(rocket, rocketTailDirection);

    const nearbyPads = world.getLandingPadsNearPoint(
      rocket.position,
      LANDING_PAD_QUERY_RADIUS
    );

    for (const pad of nearbyPads) {
      if (pad && pad.userData && pad.userData.landingPad) {
        pad.userData.landingPad.landingActive = false;
      }
    }

    let bestPad = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const pad of nearbyPads) {
      if (!pad || !pad.userData || !pad.userData.landingPad) {
        continue;
      }

      const padData = pad.userData.landingPad;
      const padCaptureRadius = padData.captureRadius || 10;
      const verticalOffset = landingPadCenterOffset.subVectors(
        rocket.position,
        pad.position
      );
      const heightAbovePad = verticalOffset.dot(padData.normal);

      if (
        heightAbovePad <= 0 ||
        heightAbovePad > LANDING_PAD_VERTICAL_PULL_HEIGHT
      ) {
        continue;
      }

      landingPadPull
        .copy(verticalOffset)
        .addScaledVector(padData.normal, -heightAbovePad);
      const horizontalDistance = landingPadPull.length();

      if (horizontalDistance > padCaptureRadius) {
        continue;
      }

      landingPadClosestPoint
        .copy(pad.position)
        .addScaledVector(
          padData.normal,
          LANDING_PAD_TAIL_CLEARANCE + (padData.deckHeight || 0)
        );
      landingPadApproachPoint
        .copy(landingPadClosestPoint)
        .addScaledVector(padData.normal, 7);
      landingPadOffset.subVectors(landingPadApproachPoint, rocketTailPosition);
      const distance = landingPadOffset.length();
      if (distance > padData.magnetRadius) {
        continue;
      }

      const score =
        horizontalDistance * 1.4 + heightAbovePad * 0.32 + distance * 0.08;

      if (score < bestScore) {
        bestScore = score;
        bestPad = pad;
      }
    }

    if (!bestPad) {
      if (activeDockedPad) {
        activeDockedPad = null;
      }

      if (
        landingCameraWasAutoActivated &&
        landingCameraPadLostAt === Number.NEGATIVE_INFINITY
      ) {
        landingCameraPadLostAt = currentTime;
      }

      if (
        landingCameraWasAutoActivated &&
        cameraState.currentPerspective === PERSPECTIVE_OBSERVER &&
        !cameraState.isTransitioning &&
        currentTime - landingCameraPadLostAt >= LANDING_CAMERA_LOST_GRACE_MS
      ) {
        switchPerspective(
          cameraState,
          PERSPECTIVE_THIRD_PERSON,
          LANDING_CAMERA_RETURN_SPEED
        );
        landingCameraWasAutoActivated = false;
        landingCameraPadLostAt = Number.NEGATIVE_INFINITY;
      }

      return;
    }

    landingCameraPadLostAt = Number.NEGATIVE_INFINITY;

    if (bestPad.userData && bestPad.userData.landingPad) {
      bestPad.userData.landingPad.landingActive = true;
    }

    const padData = bestPad.userData.landingPad;
    const padCaptureRadius = padData.captureRadius || 10;
    const verticalOffset = landingPadCenterOffset.subVectors(
      rocket.position,
      bestPad.position
    );
    const heightAbovePad = Math.max(0, verticalOffset.dot(padData.normal));
    landingPadPull
      .copy(verticalOffset)
      .addScaledVector(padData.normal, -heightAbovePad);
    const horizontalDistance = landingPadPull.length();
    landingPadClosestPoint
      .copy(bestPad.position)
      .addScaledVector(
        padData.normal,
        LANDING_PAD_TAIL_CLEARANCE + (padData.deckHeight || 0)
      );
    landingPadApproachPoint
      .copy(landingPadClosestPoint)
      .addScaledVector(padData.normal, 7);
    landingPadOffset.subVectors(landingPadApproachPoint, rocketTailPosition);

    const distance = landingPadOffset.length();
    const softMagnetRadius = Math.min(
      padData.magnetRadius,
      LANDING_PAD_SOFT_CAPTURE_DISTANCE
    );
    const magnetRadius = Math.min(
      padData.magnetRadius,
      LANDING_PAD_CAPTURE_DISTANCE
    );
    const softMagnetStrength = clamp01(1 - distance / softMagnetRadius);
    const magnetStrength = clamp01(1 - distance / magnetRadius);
    const settleStrength = clamp01(1 - distance / LANDING_PAD_SETTLE_DISTANCE);
    const tailAlignment = -rocketTailDirection.dot(padData.normal);
    const speed = physicsState.velocity ? physicsState.velocity.length() : 0;
    const horizontalCaptureStrength = clamp01(
      1 - horizontalDistance / padCaptureRadius
    );
    const verticalPullStrength =
      horizontalCaptureStrength *
      Math.exp(-heightAbovePad / LANDING_PAD_VERTICAL_PULL_FALLOFF) *
      clamp01(1 - heightAbovePad / LANDING_PAD_VERTICAL_PULL_HEIGHT);
    const redockReady =
      distance <= LANDING_PAD_SETTLE_DISTANCE * 0.92 &&
      tailAlignment >= LANDING_PAD_CAPTURE_ALIGNMENT - 0.14 &&
      speed <= 1.35 &&
      inputs.thrust < LANDING_PAD_RELEASE_THRUST;
    let releaseSuppression =
      currentTime < landingPadReleaseUntil ? 1 : landingPadReleaseSuppression;

    if (redockReady) {
      landingPadReleaseUntil = Number.NEGATIVE_INFINITY;
      landingPadReleaseSuppression = 0;
      landingPadReleaseChargeMs = 0;
      releaseSuppression = 0;
    }

    const padInfluence = 1 - releaseSuppression;
    const canSnapToPad =
      distance <= LANDING_PAD_SETTLE_DISTANCE * 0.92 &&
      tailAlignment >= LANDING_PAD_CAPTURE_ALIGNMENT - 0.14 &&
      releaseSuppression < 0.08;
    const isSettledOnPad =
      canSnapToPad &&
      (!physicsState.velocity || physicsState.velocity.length() <= 1.35);
    const isDockedOnPad = activeDockedPad === bestPad;

    if (
      inputs.thrust >= LANDING_PAD_RELEASE_THRUST &&
      (verticalPullStrength > 0.0001 || magnetStrength > 0)
    ) {
      landingPadReleaseSuppression = Math.max(
        landingPadReleaseSuppression,
        0.5 + magnetStrength * 0.32 + verticalPullStrength * 0.14
      );
    }

    if (
      heightAbovePad > 0.001 &&
      verticalPullStrength > 0.0001 &&
      padInfluence > 0.001 &&
      !isSettledOnPad
    ) {
      const verticalPullAmount =
        (0.0009 + verticalPullStrength * verticalPullStrength * 0.03) *
        padInfluence;

      landingPadPull.copy(padData.normal).multiplyScalar(-verticalPullAmount);
      updatePhysics.applyImpulse(landingPadPull);
    }

    if (
      (verticalPullStrength > 0.0001 || magnetStrength > 0) &&
      padInfluence > 0.001 &&
      !isSettledOnPad
    ) {
      landingPadDockDirection.copy(padData.normal).multiplyScalar(-1);
      landingPadTargetQuaternion.setFromUnitVectors(
        ROCKET_BACKWARD_LOCAL,
        landingPadDockDirection
      );
      rocket.quaternion.slerp(
        landingPadTargetQuaternion,
        Math.min(
          0.16,
          (0.01 + verticalPullStrength * 0.045 + magnetStrength * 0.12) *
            padInfluence
        )
      );
      rocket.rotation.setFromQuaternion(
        rocket.quaternion,
        rocket.rotation.order
      );
    }

    if (
      distance > 0.001 &&
      softMagnetStrength > 0 &&
      tailAlignment >= LANDING_PAD_VERTICAL_ALIGN_MIN &&
      padInfluence > 0.001 &&
      !isSettledOnPad
    ) {
      const closeAlignmentStrength = clamp01(
        (tailAlignment - LANDING_PAD_VERTICAL_ALIGN_MIN) /
          Math.max(
            0.001,
            LANDING_PAD_CAPTURE_ALIGNMENT - LANDING_PAD_VERTICAL_ALIGN_MIN
          )
      );
      const pullStrength =
        (softMagnetStrength * softMagnetStrength * 0.004 +
          magnetStrength * magnetStrength * closeAlignmentStrength * 0.02) *
        padInfluence;

      landingPadPull
        .copy(landingPadOffset)
        .normalize()
        .multiplyScalar(pullStrength);
      updatePhysics.applyImpulse(landingPadPull);
    }

    landingCameraActive =
      (canSnapToPad || isDockedOnPad) && currentTime >= landingPadReleaseUntil;

    landingPadLightOffset
      .copy(padData.normal)
      .multiplyScalar((padData.deckHeight || 0) + 3.2);
    landingPadLight.position.copy(bestPad.position).add(landingPadLightOffset);
    landingPadLight.distance = LANDING_PAD_LIGHT_DISTANCE;
    landingPadLight.intensity = landingCameraActive
      ? LANDING_PAD_LIGHT_BASE_INTENSITY +
        (0.5 + 0.5 * Math.sin(currentTime * 0.008)) *
          LANDING_PAD_LIGHT_PULSE_INTENSITY
      : LANDING_PAD_LIGHT_BASE_INTENSITY * 0.45;
    landingPadLight.visible = true;

    if (landingCameraActive && !landingCameraWasAutoActivated) {
      if (
        cameraState.currentPerspective === PERSPECTIVE_THIRD_PERSON &&
        !cameraState.isTransitioning
      ) {
        switchPerspective(
          cameraState,
          PERSPECTIVE_OBSERVER,
          LANDING_CAMERA_TRANSITION_SPEED
        );
        landingCameraWasAutoActivated = true;
        observerHasShot = false;
      } else if (
        cameraState.isTransitioning &&
        cameraState.targetPerspective === PERSPECTIVE_THIRD_PERSON
      ) {
        switchPerspective(
          cameraState,
          PERSPECTIVE_OBSERVER,
          LANDING_CAMERA_TRANSITION_SPEED
        );
        landingCameraWasAutoActivated = true;
        observerHasShot = false;
      }
    }

    const releaseReady =
      inputs.thrust >= LANDING_PAD_RELEASE_THRUST &&
      tailAlignment >= LANDING_PAD_TAIL_ALIGN_THRESHOLD &&
      speed <= LANDING_PAD_RELEASE_SPEED &&
      (isDockedOnPad || tailAlignment >= LANDING_PAD_CAPTURE_ALIGNMENT - 0.08);

    if (releaseReady) {
      landingPadReleaseChargeMs +=
        deltaSeconds * 1000 * LANDING_PAD_RELEASE_CHARGE_RATE;
    } else {
      landingPadReleaseChargeMs = 0;
    }

    if (landingPadReleaseChargeMs >= LANDING_PAD_RELEASE_HOLD_MS) {
      activeDockedPad = null;
      landingPadReleaseUntil = currentTime + LANDING_PAD_RELEASE_COOLDOWN_MS;
      landingPadReleaseChargeMs = 0;
      landingPadReleaseSuppression = 1;
      if (landingCameraWasAutoActivated) {
        switchPerspective(
          cameraState,
          PERSPECTIVE_THIRD_PERSON,
          LANDING_CAMERA_RETURN_SPEED
        );
        landingCameraWasAutoActivated = false;
        landingCameraPadLostAt = Number.NEGATIVE_INFINITY;
      }
      landingPadPull.copy(padData.normal).multiplyScalar(0.34);
      updatePhysics.applyImpulse(landingPadPull);
      updatePhysics.setInvulnerable(false);
      return;
    }

    if (isDockedOnPad) {
      landingPadDockDirection.copy(padData.normal).multiplyScalar(-1);
      landingPadTargetQuaternion.setFromUnitVectors(
        ROCKET_BACKWARD_LOCAL,
        landingPadDockDirection
      );
      physicsState = updatePhysics.stabilizeDockedState(
        landingPadClosestPoint,
        landingPadTargetQuaternion
      );
      rocket.rotation.setFromQuaternion(
        rocket.quaternion,
        rocket.rotation.order
      );

      if (!playerSpawnProtected) {
        updatePhysics.setInvulnerable(true);
      }

      physicsState = updatePhysics.restoreHealth(
        LANDING_PAD_HEAL_PER_SECOND * deltaSeconds
      );
      return;
    }

    if (
      distance <= LANDING_PAD_SETTLE_DISTANCE &&
      speed <= 1.8 &&
      tailAlignment >= LANDING_PAD_CAPTURE_ALIGNMENT - 0.14 &&
      releaseSuppression < 0.18
    ) {
      landingPadDockDirection.copy(padData.normal).multiplyScalar(-1);
      landingPadTargetQuaternion.setFromUnitVectors(
        ROCKET_BACKWARD_LOCAL,
        landingPadDockDirection
      );
      if (canSnapToPad) {
        activeDockedPad = bestPad;
        physicsState = updatePhysics.stabilizeDockedState(
          landingPadClosestPoint,
          landingPadTargetQuaternion
        );
        physicsState = updatePhysics.suppressCollisionFeedback(140);
        if (audioSystem && typeof audioSystem.playDock === 'function') {
          audioSystem.playDock(0.9);
        }
      } else {
        rocket.position.lerp(
          landingPadClosestPoint,
          0.05 + settleStrength * 0.14
        );
        rocket.quaternion.slerp(
          landingPadTargetQuaternion,
          0.11 + settleStrength * 0.18
        );
      }
      rocket.rotation.setFromQuaternion(
        rocket.quaternion,
        rocket.rotation.order
      );

      if (physicsState.velocity && !isSettledOnPad) {
        if (physicsState.velocity.lengthSq() > 0.00001) {
          physicsState.velocity.multiplyScalar(0.32 - settleStrength * 0.12);
          if (physicsState.velocity.lengthSq() < 0.0006) {
            physicsState.velocity.set(0, 0, 0);
          }
        }
      }
    }

    if (
      distance <= padData.healRadius &&
      speed <= LANDING_PAD_STILL_SPEED &&
      tailAlignment >= LANDING_PAD_TAIL_ALIGN_THRESHOLD &&
      releaseSuppression < 0.08
    ) {
      if (!playerSpawnProtected) {
        updatePhysics.setInvulnerable(true);
      }
      physicsState = updatePhysics.restoreHealth(
        LANDING_PAD_HEAL_PER_SECOND * deltaSeconds
      );
    }
  }

  function computeAiSeparation(rocket1, rocket2) {
    if (!rocket1.visible || !rocket2.visible) {
      return null;
    }

    const separationDistance = 25;
    const separationStrength = 0.15;

    const offset = new THREE.Vector3().subVectors(
      rocket1.position,
      rocket2.position
    );
    const distance = offset.length();

    if (distance < 0.001 || distance > separationDistance) {
      return null;
    }

    const separationForce = offset
      .divideScalar(distance)
      .multiplyScalar(separationStrength * (1 - distance / separationDistance));

    return {
      ai1Separation: { x: separationForce.x, y: separationForce.y },
      ai2Separation: { x: -separationForce.x, y: -separationForce.y },
    };
  }

  function getNextAiSpawnPosition(target) {
    const graph =
      chunkManager && chunkManager.generator
        ? chunkManager.generator.graph
        : null;

    if (
      !graph ||
      !Array.isArray(graph.chambers) ||
      !Array.isArray(graph.tunnels)
    ) {
      return target.set(
        START_POSITION.x - 28,
        START_POSITION.y + 8,
        START_POSITION.z + 34
      );
    }

    let firstChamberId = null;
    let secondChamberId = null;

    for (const tunnel of graph.tunnels) {
      if (!tunnel) {
        continue;
      }

      if (tunnel.from === 'spawn') {
        firstChamberId = tunnel.to;
        break;
      }

      if (tunnel.to === 'spawn') {
        firstChamberId = tunnel.from;
        break;
      }
    }

    if (!firstChamberId) {
      return target.copy(spawnPosition);
    }

    for (const tunnel of graph.tunnels) {
      if (!tunnel) {
        continue;
      }

      if (tunnel.from === firstChamberId && tunnel.to !== 'spawn') {
        secondChamberId = tunnel.to;
        if (tunnel.isMainRoute) {
          break;
        }
      }

      if (tunnel.to === firstChamberId && tunnel.from !== 'spawn') {
        secondChamberId = tunnel.from;
        if (tunnel.isMainRoute) {
          break;
        }
      }
    }

    const spawnChamberId = secondChamberId || firstChamberId;

    for (const chamber of graph.chambers) {
      if (!chamber || !chamber.center || chamber.id !== spawnChamberId) {
        continue;
      }

      return target.set(chamber.center.x, chamber.center.y, chamber.center.z);
    }

    return target.copy(spawnPosition);
  }

  function triggerCameraBlast(origin, strength) {
    if (cameraState.currentPerspective !== PERSPECTIVE_THIRD_PERSON) {
      return;
    }

    const blastStrength = clamp01(strength);

    if (blastStrength <= 0) {
      return;
    }

    cameraBlastDirection.subVectors(camera.position, origin);
    if (cameraBlastDirection.lengthSq() <= 0.0001) {
      cameraBlastDirection.copy(camera.position).sub(rocket.position);
    }
    if (cameraBlastDirection.lengthSq() <= 0.0001) {
      cameraBlastDirection.set(0, 0.4, 1);
    }

    cameraBlastDirection.normalize();
    cameraBlastOffset.addScaledVector(
      cameraBlastDirection,
      CAMERA_BLAST_OFFSET_MAX * blastStrength
    );
    cameraBlastShakeStrength = Math.max(
      cameraBlastShakeStrength,
      CAMERA_BLAST_SHAKE_MAX * blastStrength
    );
  }

  function createExplosionParticle(geometry, material) {
    const particle = new THREE.Mesh(geometry, material.clone());
    particle.visible = false;
    particle.userData = {
      velocity: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      age: 0,
      life: 1,
      baseScale: 1,
      opacity: 1,
    };
    scene.add(particle);
    return particle;
  }

  function createExplosionFlareParticle() {
    return createExplosionParticle(
      new THREE.OctahedronGeometry(0.18, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffb866,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
  }

  function createExplosionSmokeParticle() {
    return createExplosionParticle(
      new THREE.SphereGeometry(0.24, 7, 7),
      new THREE.MeshBasicMaterial({
        color: 0x5e4a43,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
  }

  function createExplosionFlash() {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffc875,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flash.visible = false;
    flash.userData = {
      age: 0,
      life: 0.585,
    };
    scene.add(flash);
    return flash;
  }

  const explosionFlash = createExplosionFlash();

  for (let i = 0; i < EXPLOSION_FLARE_COUNT; i++) {
    explosionFlareParticles.push(createExplosionFlareParticle());
  }

  for (let i = 0; i < EXPLOSION_SMOKE_COUNT; i++) {
    explosionSmokeParticles.push(createExplosionSmokeParticle());
  }

  function getAdaptiveLerp(error, minValue, maxValue, fullError) {
    const t = smoothstep(clamp01(error / fullError));
    return minValue + (maxValue - minValue) * t;
  }

  function getThirdPersonRotationLerp(rotationError) {
    const baseLerp = getAdaptiveLerp(
      rotationError,
      THIRD_PERSON_ROTATION_LERP_MIN,
      THIRD_PERSON_ROTATION_LERP_MAX,
      THIRD_PERSON_ROTATION_EASE_ANGLE
    );
    const snapT =
      1 - smoothstep(clamp01(rotationError / THIRD_PERSON_ROTATION_SNAP_ANGLE));

    return clamp01(baseLerp + snapT * THIRD_PERSON_ROTATION_SNAP_BOOST);
  }

  function chooseExternalCameraPosition(
    cameraState,
    focusPoint,
    outputPosition
  ) {
    let bestScore = Number.NEGATIVE_INFINITY;

    outputPosition.copy(focusPoint);
    cameraAnchor.copy(focusPoint);
    cameraAnchor.y += 1.6;

    for (const angleOffset of observerAngleOffsets) {
      for (const distanceFactor of observerDistanceFactors) {
        for (const heightFactor of observerHeightFactors) {
          const candidateAngle = cameraState.horizontalAngle + angleOffset;
          const candidateDistance = cameraState.distance * distanceFactor;

          observerOffset.set(
            Math.sin(candidateAngle) * candidateDistance,
            cameraState.heightOffset * heightFactor,
            Math.cos(candidateAngle) * candidateDistance
          );
          observerCandidatePosition.copy(focusPoint).add(observerOffset);
          observerBestDirection.subVectors(
            observerCandidatePosition,
            cameraAnchor
          );

          const desiredDistance = observerBestDirection.length();
          if (desiredDistance <= 0.001) {
            continue;
          }

          const cameraHit = raycastVoxelSegmentBudgeted(
            world,
            cameraAnchor,
            observerCandidatePosition,
            0.15,
            'low'
          );

          let score = distanceFactor * 3 - Math.abs(angleOffset) * 0.6;
          if (!cameraHit) {
            outputPosition.copy(observerCandidatePosition);
            return true;
          }

          score += (cameraHit.distance / desiredDistance) * 2;
          if (score <= bestScore) {
            continue;
          }

          observerBestDirection.normalize();
          observerBestPosition
            .copy(cameraAnchor)
            .addScaledVector(
              observerBestDirection,
              Math.max(1.6, cameraHit.distance - 0.85)
            );
          outputPosition.copy(observerBestPosition);
          bestScore = score;
        }
      }
    }

    return bestScore > Number.NEGATIVE_INFINITY;
  }

  function hasDirectorCameraSettingsChanged(cameraState) {
    return (
      Math.abs(cameraState.horizontalAngle - observerShotAngle) > 0.12 ||
      Math.abs(cameraState.distance - observerShotDistance) > 0.4 ||
      Math.abs(cameraState.heightOffset - observerShotHeight) > 0.3
    );
  }

  function cutObserverCamera(cameraState, currentTime) {
    observerFocusPoint.copy(rocketViewTarget);
    chooseExternalCameraPosition(
      cameraState,
      observerFocusPoint,
      observerPosition
    );
    observerHasShot = true;
    observerShotAngle = cameraState.horizontalAngle;
    observerShotDistance = cameraState.distance;
    observerShotHeight = cameraState.heightOffset;
    lastObserverCutTime = currentTime;
    observerDidCut = true;
  }

  function setSpawnFade(
    material,
    baseEmissive,
    baseEmissiveIntensity,
    baseColor,
    progress
  ) {
    const clampedProgress = clamp01(progress);
    material.opacity = clampedProgress;
    material.emissive
      .copy(baseEmissive)
      .lerp(rocketFadeEmissive, 1 - clampedProgress);
    material.emissiveIntensity = lerp(
      2.1,
      baseEmissiveIntensity,
      clampedProgress
    );
    material.color
      .copy(baseColor)
      .lerp(rocketFadeColor, (1 - clampedProgress) * 0.55);
  }

  function setRocketSpawnFade(progress) {
    setSpawnFade(
      rocketMaterial,
      rocketBaseEmissive,
      rocketBaseEmissiveIntensity,
      rocketBaseColor,
      progress
    );
  }

  function setAiSpawnFade(entry, progress) {
    setSpawnFade(
      entry.rocket.material,
      entry.baseEmissive,
      entry.baseEmissiveIntensity,
      entry.baseColor,
      progress
    );
  }

  function resetSpawnFadeMaterial(
    material,
    baseEmissive,
    baseEmissiveIntensity,
    baseColor
  ) {
    material.opacity = 1;
    material.emissive.copy(baseEmissive);
    material.emissiveIntensity = baseEmissiveIntensity;
    material.color.copy(baseColor);
  }

  function startSpawnFade(currentTime) {
    spawnFadeStartTime = currentTime;
    spawnFadeActive = true;
    playerSpawnProtected = true;
    updatePhysics.setInvulnerable(true);
    rocket.visible = true;
    setRocketSpawnFade(0);
  }

  function startAiSpawnFade(entry, currentTime) {
    entry.spawnFadeStartTime = currentTime;
    entry.spawnFadeActive = true;
    entry.physics.setInvulnerable(true);
    entry.rocket.visible = true;
    setAiSpawnFade(entry, 0);
  }

  function updateSpawnFade(currentTime) {
    if (!rocket.visible || !spawnFadeActive) {
      return;
    }

    const elapsed = currentTime - spawnFadeStartTime;
    const progress = clamp01(elapsed / ROCKET_SPAWN_FADE_DURATION_MS);
    const easedProgress = smoothstep(progress);

    setRocketSpawnFade(easedProgress);

    if (progress >= 1) {
      resetSpawnFadeMaterial(
        rocketMaterial,
        rocketBaseEmissive,
        rocketBaseEmissiveIntensity,
        rocketBaseColor
      );
      spawnFadeActive = false;
      playerSpawnProtected = false;
      updatePhysics.setInvulnerable(false);
    }
  }

  function updateAiSpawnFade(entry, currentTime) {
    if (!entry.rocket.visible || !entry.spawnFadeActive) {
      return;
    }

    const elapsed = currentTime - entry.spawnFadeStartTime;
    const progress = clamp01(elapsed / ROCKET_SPAWN_FADE_DURATION_MS);
    const easedProgress = smoothstep(progress);

    setAiSpawnFade(entry, easedProgress);

    if (progress >= 1) {
      resetSpawnFadeMaterial(
        entry.rocket.material,
        entry.baseEmissive,
        entry.baseEmissiveIntensity,
        entry.baseColor
      );
      entry.spawnFadeActive = false;
      entry.physics.setInvulnerable(false);
    }
  }

  function emitExplosion(origin, velocity = null) {
    for (const particle of explosionFlareParticles) {
      flareOffset.set(
        (Math.random() - 0.5) * 7.8,
        (Math.random() - 0.45) * 5.6,
        (Math.random() - 0.5) * 9.8
      );
      flareVelocity
        .set(
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05,
          (Math.random() - 0.5) * 0.05
        )
        .multiplyScalar(lerp(0.8, 1.75, Math.random()));

      if (velocity) {
        flareVelocity.addScaledVector(velocity, 0.015);
      }

      particle.position.copy(origin).add(flareOffset);
      particle.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      particle.userData.velocity.copy(flareVelocity);
      particle.userData.spin.set(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.08
      );
      particle.userData.age = 0;
      particle.userData.life = lerp(
        3.9,
        EXPLOSION_FLARE_MAX_LIFE,
        Math.random()
      );
      particle.userData.baseScale = lerp(0.18, 0.6, Math.random());
      particle.userData.opacity = lerp(0.38, 0.72, Math.random());
      particle.scale.setScalar(particle.userData.baseScale);
      particle.material.opacity = particle.userData.opacity;
      particle.visible = true;
    }

    for (const particle of explosionSmokeParticles) {
      smokeOffset.set(
        (Math.random() - 0.5) * 6.8,
        (Math.random() - 0.5) * 4.6,
        (Math.random() - 0.5) * 8.2
      );
      smokeVelocity
        .set(
          (Math.random() - 0.5) * 0.035,
          Math.random() * 0.03 + 0.006,
          (Math.random() - 0.5) * 0.035
        )
        .multiplyScalar(lerp(0.65, 1.35, Math.random()));

      if (velocity) {
        smokeVelocity.addScaledVector(velocity, 0.01);
      }

      particle.position.copy(origin).add(smokeOffset);
      particle.userData.velocity.copy(smokeVelocity);
      particle.userData.spin.set(
        (Math.random() - 0.5) * 0.03,
        (Math.random() - 0.5) * 0.03,
        (Math.random() - 0.5) * 0.03
      );
      particle.userData.age = 0;
      particle.userData.life = lerp(
        6.375,
        EXPLOSION_SMOKE_MAX_LIFE,
        Math.random()
      );
      particle.userData.baseScale = lerp(1.1, 2.8, Math.random());
      particle.userData.opacity = lerp(0.18, 0.34, Math.random());
      particle.scale.setScalar(particle.userData.baseScale * 0.5);
      particle.material.opacity = 0;
      particle.visible = true;
    }

    explosionFlash.position.copy(origin);
    explosionFlash.scale.setScalar(1);
    explosionFlash.material.opacity = 0.82;
    explosionFlash.userData.age = 0;
    explosionFlash.visible = true;
  }

  function triggerRocketExplosion(currentTime, physicsState) {
    rocketDestroyed = true;
    respawnAtTime = currentTime + ROCKET_RESPAWN_DELAY_MS;
    physicsState = updatePhysics.setActive(false);
    updatePhysics.setInvulnerable(false);
    playerSpawnProtected = false;

    if (audioSystem) {
      audioSystem.playMissileExplosion(true);
      audioSystem.setThrust(0);
      audioSystem.setFlamethrower(0);
    }

    emitExplosion(rocket.position, physicsState && physicsState.velocity);

    chooseExternalCameraPosition(
      cameraState,
      rocket.position,
      deathCameraTargetPosition
    );
    deathCameraStartPosition.copy(camera.position);
    deathCameraActive = true;
    deathCameraStartTime = currentTime;

    rocket.visible = false;

    return physicsState;
  }

  function updateExplosionEffects(deltaSeconds) {
    for (const particle of explosionFlareParticles) {
      if (!particle.visible) {
        continue;
      }

      particle.userData.age += deltaSeconds;
      const progress = clamp01(particle.userData.age / particle.userData.life);
      particle.position.add(particle.userData.velocity);
      particle.userData.velocity.multiplyScalar(EXPLOSION_FLARE_DRAG);
      particle.userData.velocity.y += 0.00025;
      particle.rotation.x += particle.userData.spin.x;
      particle.rotation.y += particle.userData.spin.y;
      particle.rotation.z += particle.userData.spin.z;

      const scale =
        particle.userData.baseScale * lerp(1, 4.6, smoothstep(progress));
      particle.scale.setScalar(Math.max(0.045, scale));
      particle.material.opacity =
        particle.userData.opacity * Math.pow(1 - progress, 1.7);

      if (progress >= 1) {
        particle.visible = false;
      }
    }

    for (const particle of explosionSmokeParticles) {
      if (!particle.visible) {
        continue;
      }

      particle.userData.age += deltaSeconds;
      const progress = clamp01(particle.userData.age / particle.userData.life);
      particle.position.add(particle.userData.velocity);
      particle.userData.velocity.multiplyScalar(EXPLOSION_SMOKE_DRAG);
      particle.userData.velocity.y += EXPLOSION_SMOKE_LIFT;
      particle.rotation.x += particle.userData.spin.x;
      particle.rotation.y += particle.userData.spin.y;
      particle.rotation.z += particle.userData.spin.z;

      particle.scale.setScalar(
        particle.userData.baseScale * lerp(0.5, 5.5, smoothstep(progress))
      );

      if (progress < 0.26) {
        particle.material.opacity = lerp(
          0,
          particle.userData.opacity,
          progress / 0.26
        );
      } else {
        particle.material.opacity = lerp(
          particle.userData.opacity,
          0,
          (progress - 0.26) / 0.74
        );
      }

      if (progress >= 1) {
        particle.visible = false;
      }
    }

    if (explosionFlash.visible) {
      explosionFlash.userData.age += deltaSeconds;
      const flashProgress = clamp01(
        explosionFlash.userData.age / explosionFlash.userData.life
      );
      const flashScale = lerp(
        1,
        EXPLOSION_FLASH_MAX_SCALE,
        1 - Math.pow(1 - flashProgress, EXPLOSION_FLASH_GROWTH)
      );

      explosionFlash.scale.setScalar(flashScale);
      explosionFlash.material.opacity = lerp(
        0.92,
        0,
        smoothstep(flashProgress)
      );

      if (flashProgress >= 1) {
        explosionFlash.visible = false;
      }
    }
  }

  function respawnRocket(currentTime) {
    updatePhysics.resetState(spawnPosition);
    rocketDestroyed = false;
    respawnAtTime = Number.POSITIVE_INFINITY;
    deathCameraActive = false;
    deathCameraStartTime = Number.NEGATIVE_INFINITY;
    cameraChaseQuaternion.copy(rocket.quaternion);
    observerHasShot = false;
    observerFocusPoint.copy(rocket.position);
    previousUp.set(0, 1, 0);
    startSpawnFade(currentTime);
  }

  function destroyAiRocket(entry, currentTime) {
    const aiVelocity =
      entry.physicsState && entry.physicsState.velocity
        ? entry.physicsState.velocity.clone()
        : null;

    entry.destroyed = true;
    entry.respawnAtTime = currentTime + AI_RESPAWN_DELAY_MS;
    entry.physicsState = entry.physics.setActive(false);
    entry.physics.setInvulnerable(false);
    emitExplosion(entry.rocket.position, aiVelocity);
    entry.rocket.visible = false;
  }

  function respawnAiRocket(entry, currentTime) {
    if (!aiEnabled) {
      return;
    }

    getNextAiSpawnPosition(entry.spawnPosition);
    if (entry.index > 0) {
      entry.spawnPosition.x += 15 * entry.index;
      entry.spawnPosition.z += 15 * entry.index;
    }
    entry.physics.resetState(entry.spawnPosition);
    entry.destroyed = false;
    entry.respawnAtTime = Number.POSITIVE_INFINITY;
    startAiSpawnFade(entry, currentTime);
  }

  function shouldRepositionObserverCamera(cameraState, currentTime) {
    if (!observerHasShot) {
      return true;
    }

    if (hasDirectorCameraSettingsChanged(cameraState)) {
      return true;
    }

    if (
      observerFocusPoint.distanceToSquared(rocketViewTarget) >
      OBSERVER_FOCUS_RADIUS_SQ
    ) {
      return true;
    }

    if (currentTime - lastObserverCutTime < OBSERVER_RECUT_COOLDOWN_MS) {
      return false;
    }

    return (
      raycastVoxelSegmentBudgeted(
        world,
        observerPosition,
        rocketViewTarget,
        0.15,
        'low'
      ) !== null
    );
  }

  function updateSunlight() {
    const sunLight = scene.userData.sunLight;
    const sunTarget = scene.userData.sunTarget;
    const sunDirection = scene.userData.sunDirection;
    const sunDistance = scene.userData.sunDistance || 180;
    const skyOpenings =
      chunkManager && chunkManager.generator
        ? chunkManager.generator.skyOpenings
        : null;

    if (!sunLight || !sunTarget || !sunDirection) {
      return;
    }

    if (skyOpenings && skyOpenings.length > 0) {
      let bestOpening = skyOpenings[0];
      let bestDistanceSq = Number.POSITIVE_INFINITY;

      for (const opening of skyOpenings) {
        activeOpeningPosition.set(
          opening.center.x,
          opening.center.y,
          opening.center.z
        );

        const distanceSq = activeOpeningPosition.distanceToSquared(
          rocket.position
        );
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestOpening = opening;
        }
      }

      sunTargetPosition.set(
        bestOpening.center.x,
        bestOpening.center.y,
        bestOpening.center.z
      );
      activeOpeningOffset.copy(sunDirection).multiplyScalar(-sunDistance);
      sunPosition.copy(sunTargetPosition).add(activeOpeningOffset);
    } else {
      sunTargetPosition.copy(rocket.position);
      activeOpeningOffset.copy(sunDirection).multiplyScalar(-sunDistance);
      sunPosition.copy(sunTargetPosition).add(activeOpeningOffset);
    }

    sunLight.position.copy(sunPosition);
    sunTarget.position.copy(sunTargetPosition);
    sunLight.updateMatrixWorld();
    sunTarget.updateMatrixWorld();
    sunLight.target.updateMatrixWorld();
  }

  function getShellDebugColor(meshName) {
    if (meshName.indexOf('midLodChunk_') === 0) return LOD_DEBUG_COLORS.LOD1;
    if (meshName.indexOf('farVisualShell_4') === 0)
      return LOD_DEBUG_COLORS.LOD2;
    if (meshName.indexOf('farVisualShell_8') === 0)
      return LOD_DEBUG_COLORS.LOD3;
    return 0xff00ff;
  }

  function colorToCssHex(color) {
    return '#' + color.toString(16).padStart(6, '0');
  }

  function getLodDebugLegend() {
    return [
      {
        label: 'Full Chunks',
        color: colorToCssHex(LOD_DEBUG_COLORS.FULL_CHUNKS),
      },
      { label: 'LOD1 x2', color: colorToCssHex(LOD_DEBUG_COLORS.LOD1) },
      { label: 'LOD2 x4', color: colorToCssHex(LOD_DEBUG_COLORS.LOD2) },
      { label: 'LOD3 x8', color: colorToCssHex(LOD_DEBUG_COLORS.LOD3) },
    ];
  }

  function applyFarShellDebugMode(group, mode) {
    if (!group) return;
    group.visible = mode !== 3;

    for (var i = 0; i < group.children.length; i++) {
      var child = group.children[i];
      if (!child.isMesh || !child.material) {
        continue;
      }

      if (mode === 1) {
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }
        var debugColor = getShellDebugColor(child.name);
        if (
          child.material.type !== 'MeshBasicMaterial' ||
          child.material.color.getHex() !== debugColor
        ) {
          var originalUserData = child.userData.originalMaterial.userData || {};
          var dbgMat = new THREE.MeshBasicMaterial({
            color: debugColor,
            vertexColors: false,
            fog: false,
            transparent: true,
            opacity: originalUserData.maxOpacity || 0.65,
            depthTest: true,
            depthWrite: false,
            side: THREE.FrontSide,
          });
          dbgMat.userData = {
            fadeNear: originalUserData.fadeNear || 0,
            fadeFar: originalUserData.fadeFar || 1,
            fadeOutNear: originalUserData.fadeOutNear || 99999,
            fadeOutFar: originalUserData.fadeOutFar || 99999,
            maxOpacity: originalUserData.maxOpacity || 0.65,
          };
          applyLodDistanceFade(dbgMat);
          child.material = dbgMat;
        }
      } else {
        if (child.userData.originalMaterial) {
          if (child.material !== child.userData.originalMaterial) {
            child.material.dispose();
            child.material = child.userData.originalMaterial;
          }
          child.material.opacity = child.material.userData.maxOpacity || 0.65;
        }
      }

      if (mode === 2) {
        child.material.wireframe = true;
        child.material.visible = true;
      } else {
        child.material.wireframe = false;
      }
    }
  }

  function restoreFullChunkDebugMaterial(mesh) {
    if (!mesh.userData.originalFullChunkMaterial) {
      return;
    }

    mesh.material = mesh.userData.originalFullChunkMaterial;
    mesh.userData.originalFullChunkMaterial = null;
  }

  function applyFullChunkDebugMaterial(mesh, mode) {
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    if (mode === 1) {
      if (!mesh.userData.originalFullChunkMaterial) {
        mesh.userData.originalFullChunkMaterial = mesh.material;
      }
      mesh.material = fullChunkDebugMaterial;
      mesh.material.wireframe = false;
      return;
    }

    restoreFullChunkDebugMaterial(mesh);

    if (Array.isArray(mesh.material)) {
      for (var i = 0; i < mesh.material.length; i++) {
        mesh.material[i].wireframe = mode === 2;
      }
    } else {
      mesh.material.wireframe = mode === 2;
    }
  }

  function applyFullChunkDebugMode(mode) {
    if (!chunkManager || !chunkManager.chunkMeshes) {
      return;
    }

    if (mode !== 2 && chunkManager.materials) {
      chunkManager.materials.opaque.wireframe = false;
      chunkManager.materials.transparent.wireframe = false;
    }

    for (const [, mesh] of chunkManager.chunkMeshes) {
      applyFullChunkDebugMaterial(mesh, mode);

      for (var i = 0; i < mesh.children.length; i++) {
        applyFullChunkDebugMaterial(mesh.children[i], mode);
      }
    }
  }

  function updateFarShellOpacity(farShellGroup) {
    if (!farShellGroup || !farShellGroup.visible) return;
    for (var i = 0; i < farShellGroup.children.length; i++) {
      var child = farShellGroup.children[i];
      if (!child.isMesh || !child.material || !child.material.userData)
        continue;
      var ud = child.material.userData;
      child.material.opacity = ud.maxOpacity || 0.65;
    }
  }

  function updateFarShellStats(group) {
    farShellState.enabled = farShellDebugMode !== 3;
    farShellState.debugColors = farShellDebugMode === 1;
    farShellState.visibleMeshes = 0;
    farShellState.visibleTriangles = 0;

    for (var i = 0; i < group.children.length; i++) {
      var child = group.children[i];
      if (!child.isMesh) continue;
      if (child.visible && group.visible) {
        farShellState.visibleMeshes++;
        if (child.geometry && child.geometry.index) {
          farShellState.visibleTriangles += child.geometry.index.count / 3;
        }
      }
    }
  }

  function disposeObject3D(root) {
    root.traverse(function (child) {
      if (child.geometry) {
        child.geometry.dispose();
      }

      if (Array.isArray(child.material)) {
        for (var i = 0; i < child.material.length; i++) {
          child.material[i].dispose();
        }
      } else if (child.material) {
        child.material.dispose();
      }
    });
  }

  function removeStartupPreviewLod() {
    var previewGroup = lodSystems ? lodSystems.startupPreview : null;
    if (!previewGroup) {
      return;
    }

    if (previewGroup.parent) {
      previewGroup.parent.remove(previewGroup);
    }
    disposeObject3D(previewGroup);
    if (lodSystems) {
      lodSystems.startupPreview = null;
    }
  }

  function updateStartupPreviewLod() {
    var previewGroup = lodSystems ? lodSystems.startupPreview : null;
    if (!previewGroup) {
      return;
    }

    var farShellGroup = scene.getObjectByName('farShellSystem');
    if (
      farShellGroup &&
      farShellGroup.userData &&
      farShellGroup.userData.loadedShells > 0
    ) {
      removeStartupPreviewLod();
      return;
    }

    var activeMidLodSystem = lodSystems ? lodSystems.midLod : null;
    var previewTiles = previewGroup.children.slice();

    for (var tileIndex = 0; tileIndex < previewTiles.length; tileIndex++) {
      var tile = previewTiles[tileIndex];
      var previewChunkKeys = tile.userData
        ? tile.userData.previewChunkKeys
        : null;

      if (!previewChunkKeys || previewChunkKeys.length === 0) {
        continue;
      }

      var replacementCount = 0;
      for (var keyIndex = 0; keyIndex < previewChunkKeys.length; keyIndex++) {
        var chunkKey = previewChunkKeys[keyIndex];
        if (
          chunkManager.chunkMeshes.has(chunkKey) ||
          (activeMidLodSystem &&
            activeMidLodSystem.meshesByChunkKey &&
            activeMidLodSystem.meshesByChunkKey.has(chunkKey))
        ) {
          replacementCount++;
        }
      }

      if (replacementCount / previewChunkKeys.length < 0.35) {
        continue;
      }

      previewGroup.remove(tile);
      disposeObject3D(tile);
    }

    if (previewGroup.children.length === 0) {
      removeStartupPreviewLod();
    }
  }

  function gameLoop() {
    stats.begin();

    inputs = pollInputs();

    if (inputs.toggleMenu && gameMenu) {
      if (!gamePaused) {
        setPauseState(true, 'menu');
      } else if (pauseOverlayMode === 'menu') {
        setPauseState(false);
      } else {
        setPauseState(true, 'menu');
      }
    }

    if (inputs.forceOptions) {
      if (gamePaused) {
        setPauseState(false);
      } else {
        setPauseState(true, 'pause');
      }
    }

    // Allow these inputs during pause
    if (gamePaused) {
      if (soundtrack && (inputs.toggleMusic || inputs.toggleMusicReverse)) {
        soundtrack.cycleTrack(inputs.toggleMusicReverse ? -1 : 1);
        var pausedMusicState = soundtrack.getUiState();
        showToast(
          pausedMusicState && pausedMusicState.isEnabled
            ? 'Track: ' + (pausedMusicState.trackLabel || 'On')
            : 'Music Off'
        );
      }

      if (inputs.toggleFullscreen && toggleFullscreen) {
        toggleFullscreen();
      }

      if (inputs.toggleHud) {
        hudEnabled = !hudEnabled;
        hud.canvas.style.display = hudEnabled ? 'block' : 'none';
        showToast(hudEnabled ? 'HUD On' : 'HUD Off');
      }

      if (inputs.toggleCrosshair) {
        crosshairEnabled = !crosshairEnabled;
        if (!hudEnabled) {
          showToast(crosshairEnabled ? 'Crosshair On' : 'Crosshair Off');
        }
      }

      if (inputs.toggleDevMode) {
        devMode = !devMode;
        setDevMode(devMode);
        stats.dom.style.display = devMode ? 'block' : 'none';
        showToast(devMode ? 'Dev Mode On' : 'Dev Mode Off');
      }

      if (inputs.toggleBoundaries) {
        chunkManager.toggleChunkBoundaries();
        showToast(
          chunkManager.showChunkBoundaries ? 'Boundaries On' : 'Boundaries Off'
        );
      }

      updateOptions(
        chunkManager,
        cameraState.currentPerspective,
        soundtrack ? soundtrack.getUiState() : null,
        audioSystem ? audioSystem.getUiState() : null,
        weaponSystem.getUiState(),
        aiEnabled,
        hudEnabled,
        crosshairEnabled,
        gameConfig
      );

      timer.update();
      renderer.render(scene, camera);
      stats.end();
      requestAnimationFrame(gameLoop);
      return;
    }

    timer.update();
    const deltaTime = timer.getDelta();
    frameDelta += deltaTime;
    const currentTime = performance.now();
    const deltaSeconds = Math.min(deltaTime, 0.05);

    frameCount++;

    resetWorldPerformanceStats(world);
    resetGlobalWeaponBudgets();

    updateExplosionEffects(deltaSeconds);

    // Update FPS every second
    if (currentTime - fpsUpdateTime > 1000) {
      currentFPS = frameCount;
      frameCount = 0;
      fpsUpdateTime = currentTime;
    }

    if (soundtrack && (inputs.toggleMusic || inputs.toggleMusicReverse)) {
      soundtrack.cycleTrack(inputs.toggleMusicReverse ? -1 : 1);
      var musicState = soundtrack.getUiState();
      showToast(
        musicState && musicState.isEnabled
          ? 'Track: ' + (musicState.trackLabel || 'On')
          : 'Music Off'
      );
    }

    if (audioSystem && inputs.toggleSfx) {
      audioSystem.toggleEnabled();
      var sfxState = audioSystem.getUiState();
      showToast(sfxState && sfxState.isEnabled ? 'SFX On' : 'SFX Off');
    }

    if (inputs.toggleAi) {
      aiEnabled = !aiEnabled;

      if (!aiEnabled) {
        for (let i = 0; i < aiData.length; i++) {
          const entry = aiData[i];
          entry.destroyed = true;
          entry.respawnAtTime = Number.POSITIVE_INFINITY;
          entry.rocket.visible = false;
          entry.spawnFadeActive = false;
          entry.physics.setActive(false);
          entry.physics.setInvulnerable(false);
        }
      } else {
        for (let i = 0; i < aiData.length; i++) {
          const entry = aiData[i];
          respawnAiRocket(entry, currentTime);
          entry.physicsState = entry.physics(neutralInputs);
          entry.previousHealth =
            entry.physicsState.health == null ? 100 : entry.physicsState.health;
        }
      }
      showToast(aiEnabled ? 'AI On' : 'AI Off');
    }

    if (inputs.toggleBoundaries) {
      chunkManager.toggleChunkBoundaries();
      showToast(
        chunkManager.showChunkBoundaries ? 'Boundaries On' : 'Boundaries Off'
      );
    }

    if (inputs.toggleFullscreen && toggleFullscreen) {
      toggleFullscreen();
    }

    if (inputs.toggleHud) {
      hudEnabled = !hudEnabled;
      showToast(hudEnabled ? 'HUD On' : 'HUD Off');
    }

    if (inputs.toggleCrosshair && !hudEnabled) {
      crosshairEnabled = !crosshairEnabled;
      showToast(crosshairEnabled ? 'Crosshair On' : 'Crosshair Off');
    }

    if (inputs.toggleDevMode) {
      devMode = !devMode;
      setDevMode(devMode);
      stats.dom.style.display = devMode ? 'block' : 'none';
      showToast(devMode ? 'Dev Mode On' : 'Dev Mode Off');
    }

    if (inputs.toggleLod0) {
      debugLod0ChunksEnabled = !debugLod0ChunksEnabled;
      chunkManager.setDebugChunksVisible(debugLod0ChunksEnabled);
      showToast(
        debugLod0ChunksEnabled ? 'Full Chunks: On' : 'Full Chunks: Off'
      );
    }

    if (inputs.toggleLod1 || inputs.toggleLod2 || inputs.toggleLod3) {
      var shellGroup = scene.getObjectByName('farShellSystem');
      var midLodGroup = scene.getObjectByName('midLodSystem');
      if (inputs.toggleLod1) {
        if (midLodGroup) {
          midLodGroup.visible = !midLodGroup.visible;
          showToast(
            midLodGroup.visible
              ? 'LOD1 blockSize 2: ON'
              : 'LOD1 blockSize 2: OFF'
          );
        }
      }

      if (inputs.toggleLod2) {
        var shell2 =
          shellGroup && shellGroup.getObjectByName('farVisualShell_4');
        if (shell2) {
          shell2.visible = !shell2.visible;
          showToast(
            shell2.visible ? 'LOD2 blockSize 4: ON' : 'LOD2 blockSize 4: OFF'
          );
        }
      }

      if (inputs.toggleLod3) {
        var shell3 =
          shellGroup && shellGroup.getObjectByName('farVisualShell_8');
        if (shell3) {
          shell3.visible = !shell3.visible;
          showToast(
            shell3.visible ? 'LOD3 blockSize 8: ON' : 'LOD3 blockSize 8: OFF'
          );
        }
      }
    }

    if (inputs.toggleLodAll) {
      var farShellGroup = scene.getObjectByName('farShellSystem');
      var debugMidLodSystem = lodSystems ? lodSystems.midLod : null;
      farShellDebugMode = (farShellDebugMode + 1) % 4;

      if (farShellGroup) {
        applyFarShellDebugMode(farShellGroup, farShellDebugMode);
        updateFarShellStats(farShellGroup);
      }
      if (debugMidLodSystem && debugMidLodSystem.group) {
        applyFarShellDebugMode(debugMidLodSystem.group, farShellDebugMode);
      }
      applyFullChunkDebugMode(farShellDebugMode);

      var modeLabels = [
        'Far Shell: Normal',
        'Far Shell: Debug Identity Colors',
        'Far Shell: Wireframe',
        'Far Shell: Disabled',
      ];
      showToast(modeLabels[farShellDebugMode], {
        legend: farShellDebugMode === 1 ? getLodDebugLegend() : null,
      });
    }

    if (inputs.toggleLodDebug) {
      var debugGroup = scene.getObjectByName('farShellSystem');
      if (debugGroup) {
        showToast(
          'Shell Stats | En: ' +
            farShellState.enabled +
            ' | DC: ' +
            farShellState.debugColors +
            ' | Meshes: ' +
            farShellState.visibleMeshes +
            ' | Tris: ' +
            farShellState.visibleTriangles +
            ' | Opacity: ' +
            farShellState.opacity.toFixed(2) +
            ' | Near: ' +
            farShellState.nearestVisibleDistance +
            ' | Blocks: ' +
            farShellState.blockSizes.join(',')
        );
      }
    }

    if (inputs.cycleWeapon) {
      weaponSystem.cycleWeapon();
      var weaponState = weaponSystem.getUiState();
      if (weaponState && weaponState.label) {
        showToast(weaponState.label);
      }
    }

    // Process camera control inputs
    updateCameraState(inputs, cameraState);

    // Update perspective transitions
    updatePerspectiveTransition(cameraState);

    // Update camera reset animation
    updateCameraReset(cameraState);

    if (cameraState.currentPerspective !== previousPerspective) {
      if (cameraState.currentPerspective === PERSPECTIVE_OBSERVER) {
        observerHasShot = false;
      } else if (
        landingCameraWasAutoActivated &&
        cameraState.currentPerspective !== PERSPECTIVE_THIRD_PERSON
      ) {
        landingCameraWasAutoActivated = false;
      }
      previousPerspective = cameraState.currentPerspective;
    }

    while (frameDelta >= INV_MAX_FPS) {
      observerDidCut = false;

      // apply control inputs to objects and camera
      physicsState = updatePhysics(inputs); // calculate physics = move objects and camera
      if (!rocketDestroyed && previousHealth > 0 && physicsState.health <= 0) {
        physicsState = triggerRocketExplosion(currentTime, physicsState);
      }
      previousHealth = physicsState.health == null ? 100 : physicsState.health;

      if (rocketDestroyed && currentTime >= respawnAtTime) {
        respawnRocket(currentTime);
        physicsState = updatePhysics(neutralInputs);
        previousHealth =
          physicsState.health == null ? 100 : physicsState.health;
      }

      if (aiEnabled) {
        for (let i = 0; i < aiData.length; i++) {
          const entry = aiData[i];
          if (
            entry.destroyed &&
            currentTime >= entry.respawnAtTime &&
            !rocketDestroyed
          ) {
            respawnAiRocket(entry, currentTime);
            entry.physicsState = entry.physics(neutralInputs);
            entry.previousHealth =
              entry.physicsState.health == null
                ? 100
                : entry.physicsState.health;
          }
        }
      }

      Object.assign(actionInputs, inputs);
      if (
        !physicsState.active ||
        (physicsState && physicsState.hitStopActive)
      ) {
        actionInputs.thrust = 0;
        actionInputs.brake = 0;
        actionInputs.fire = 0;
      }
      updateFlames(actionInputs, physicsState); // update flame particles
      updateControlThrusters(actionInputs); // update control thruster particles
      var weaponUiState = updateWeaponSystem(
        actionInputs,
        currentTime,
        deltaSeconds
      );

      if (aiEnabled) {
        for (let i = 0; i < aiData.length; i++) {
          const entry = aiData[i];
          entry.inputs = entry.player.update(
            entry.physicsState,
            physicsState,
            currentTime
          );
          if (entry.destroyed || entry.physicsState.hitStopActive) {
            entry.inputs.thrust = 0;
            entry.inputs.brake = 0;
            entry.inputs.fire = 0;
          }
        }

        for (let i = 0; i < aiData.length; i++) {
          for (let j = i + 1; j < aiData.length; j++) {
            const entryA = aiData[i];
            const entryB = aiData[j];
            if (!entryA.destroyed && !entryB.destroyed) {
              const separation = computeAiSeparation(
                entryA.rocket,
                entryB.rocket
              );
              if (separation) {
                entryA.inputs.rollRight += separation.ai1Separation.x;
                entryA.inputs.pitchUp += separation.ai1Separation.y;
                entryB.inputs.rollRight += separation.ai2Separation.x;
                entryB.inputs.pitchUp += separation.ai2Separation.y;
              }
            }
          }
        }

        let maxAiThrust = 0;
        let maxAiFlamethrower = 0;

        for (let i = 0; i < aiData.length; i++) {
          const entry = aiData[i];
          entry.weaponSystem.setWeapon(entry.inputs.weaponId);
          entry.physicsState = entry.physics(entry.inputs);
          if (
            !entry.destroyed &&
            entry.previousHealth > 0 &&
            entry.physicsState.health <= 0
          ) {
            destroyAiRocket(entry, currentTime);
          }
          entry.previousHealth =
            entry.physicsState.health == null ? 100 : entry.physicsState.health;
          entry.flames(entry.inputs, entry.physicsState);
          entry.controlThrusters(entry.inputs);
          entry.updateWeaponSystem(entry.inputs, currentTime, deltaSeconds);

          if (audioSystem) {
            const mix = entry.audioMix();
            const thrust = (entry.inputs.thrust || 0) * 0.32 * mix;
            maxAiThrust = Math.max(maxAiThrust, thrust);
            const weapon = entry.weaponSystem.getCurrentWeapon();
            const flamethrower =
              entry.inputs.fire && weapon && weapon.id === 'flamethrower'
                ? 0.38 * mix
                : 0;
            maxAiFlamethrower = Math.max(maxAiFlamethrower, flamethrower);
          }
        }

        if (audioSystem) {
          audioSystem.setThrust(
            Math.max(actionInputs.thrust || 0, maxAiThrust)
          );
          audioSystem.setFlamethrower(
            Math.max(
              weaponSystem.getCurrentWeapon().id === 'flamethrower' &&
                actionInputs.fire
                ? 1
                : 0,
              maxAiFlamethrower
            )
          );

          if (physicsState) {
            audioSystem.updateWarnings(
              physicsState.health == null ? 100 : physicsState.health
            );
          }
        }
      } else if (audioSystem) {
        audioSystem.setThrust(actionInputs.thrust || 0);
        audioSystem.setFlamethrower(
          weaponSystem.getCurrentWeapon().id === 'flamethrower' &&
            actionInputs.fire
            ? 1
            : 0
        );

        if (physicsState) {
          audioSystem.updateWarnings(
            physicsState.health == null ? 100 : physicsState.health
          );
        }
      }

      updateLandingPadInteraction(INV_MAX_FPS);

      // Calculate camera position in rocket's local space using spherical coordinates
      const localCameraOffset = calculateCameraPosition(cameraState);
      rocketViewTarget.copy(rocket.position);
      rocketViewTarget.y += 1.1;
      observerFocusPoint.copy(rocketViewTarget);

      if (deathCameraActive) {
        const deathBlendProgress = clamp01(
          (currentTime - deathCameraStartTime) / DEATH_CAMERA_BLEND_MS
        );
        chooseExternalCameraPosition(
          cameraState,
          rocket.position,
          deathCameraTargetPosition
        );
        deathCameraPosition.lerpVectors(
          deathCameraStartPosition,
          deathCameraTargetPosition,
          smoothstep(deathBlendProgress)
        );
        desiredCameraPosition.copy(deathCameraPosition);
        deathCameraLookTarget.copy(explosionFlash.position);
        observerFocusPoint.copy(deathCameraLookTarget);
      } else if (cameraState.currentPerspective === PERSPECTIVE_OBSERVER) {
        observerOffset.copy(localCameraOffset);
        if (shouldRepositionObserverCamera(cameraState, currentTime)) {
          cutObserverCamera(cameraState, currentTime);
        }
        desiredCameraPosition.copy(observerPosition);
      } else {
        if (
          cameraState.currentPerspective === PERSPECTIVE_THIRD_PERSON &&
          physicsState &&
          physicsState.velocity
        ) {
          const rotationError = cameraChaseQuaternion.angleTo(
            rocket.quaternion
          );
          if (rotationError <= THIRD_PERSON_ROTATION_LOCK_ANGLE) {
            cameraChaseQuaternion.copy(rocket.quaternion);
          } else {
            cameraChaseQuaternion.slerp(
              rocket.quaternion,
              getThirdPersonRotationLerp(rotationError)
            );
          }
          desiredCameraPosition.copy(localCameraOffset);
          desiredCameraPosition.applyQuaternion(cameraChaseQuaternion);
          desiredCameraPosition.add(rocket.position);
          cameraLagOffset
            .copy(physicsState.velocity)
            .multiplyScalar(-THIRD_PERSON_SPEED_LAG);
          desiredCameraPosition.add(cameraLagOffset);
        } else {
          // Transform to world space
          desiredCameraPosition.copy(localCameraOffset);
          desiredCameraPosition.applyMatrix4(rocket.matrixWorld);
        }
      }

      if (cameraState.currentPerspective !== PERSPECTIVE_THIRD_PERSON) {
        cameraBlastOffset.set(0, 0, 0);
        cameraBlastShakeStrength = 0;
        cameraBlastShakeTime = 0;
        cameraBlastShakeOffset.set(0, 0, 0);
      } else {
        cameraBlastOffset.multiplyScalar(CAMERA_BLAST_DECAY);
        if (cameraBlastOffset.lengthSq() < 0.00001) {
          cameraBlastOffset.set(0, 0, 0);
        }

        cameraBlastShakeStrength *= CAMERA_BLAST_SHAKE_DECAY;
        if (cameraBlastShakeStrength < 0.001) {
          cameraBlastShakeStrength = 0;
          cameraBlastShakeTime = 0;
          cameraBlastShakeOffset.set(0, 0, 0);
        } else {
          cameraBlastShakeTime += INV_MAX_FPS;
          cameraBlastShakeOffset.set(
            Math.sin(cameraBlastShakeTime * 4.6),
            Math.sin(cameraBlastShakeTime * 3.8 + 1.2),
            Math.cos(cameraBlastShakeTime * 4.2 + 0.6)
          );
          cameraBlastShakeOffset.multiplyScalar(cameraBlastShakeStrength);
        }
      }

      if (cameraState.currentPerspective !== 'first-person') {
        if (cameraState.currentPerspective !== PERSPECTIVE_OBSERVER) {
          cameraAnchor.copy(rocket.position);
          cameraAnchor.y += 1.25;
          cameraDirection.subVectors(desiredCameraPosition, cameraAnchor);

          const cameraHit = raycastVoxelSegmentBudgeted(
            world,
            cameraAnchor,
            desiredCameraPosition,
            0.15,
            'low'
          );

          if (cameraHit) {
            const desiredDistance = cameraDirection.length();
            if (desiredDistance > 0.001) {
              cameraDirection.normalize();
              const safeDistance = Math.max(1.2, cameraHit.distance - 0.75);
              desiredCameraPosition
                .copy(cameraAnchor)
                .addScaledVector(
                  cameraDirection,
                  Math.min(safeDistance, desiredDistance)
                );
            }
          }
        }
      }

      // Smooth camera movement
      if (deathCameraActive) {
        camera.position.copy(desiredCameraPosition);
      } else if (cameraState.currentPerspective === PERSPECTIVE_OBSERVER) {
        if (observerDidCut || !observerHasShot) {
          camera.position.copy(desiredCameraPosition);
        }
      } else if (cameraState.currentPerspective === PERSPECTIVE_THIRD_PERSON) {
        const cameraError = camera.position.distanceTo(desiredCameraPosition);
        const cameraLerp = getAdaptiveLerp(
          cameraError,
          THIRD_PERSON_CAMERA_LERP_MIN,
          THIRD_PERSON_CAMERA_LERP_MAX,
          THIRD_PERSON_CAMERA_EASE_DISTANCE
        );
        camera.position.lerp(desiredCameraPosition, cameraLerp);
      } else {
        camera.position.copy(desiredCameraPosition);
      }

      if (cameraBlastOffset.lengthSq() > 0) {
        cameraBlastPosition.copy(camera.position).add(cameraBlastOffset);
        camera.position.copy(cameraBlastPosition);
      }

      if (cameraBlastShakeStrength > 0) {
        camera.position.add(cameraBlastShakeOffset);
      }

      // Determine look target based on perspective
      getRocketUpVector(rocket, rocketUp);

      // Smooth the up vector more aggressively to prevent jerking
      previousUp.lerp(
        deathCameraActive ||
          cameraState.currentPerspective === PERSPECTIVE_OBSERVER
          ? worldUp
          : rocketUp,
        deathCameraActive ||
          cameraState.currentPerspective === PERSPECTIVE_OBSERVER
          ? 0.12
          : 0.05
      );

      if (cameraState.currentPerspective === 'first-person') {
        // In first-person mode, look forward or backward based on reverse view state
        firstPersonLookDirection
          .copy(ROCKET_FORWARD_LOCAL)
          .multiplyScalar(cameraState.isReversed ? -10 : 10);
        transformRocketLocalVector(
          rocket,
          firstPersonLookDirection,
          firstPersonLookDirection
        );
        cameraLookTarget.copy(rocket.position).add(firstPersonLookDirection);
        camera.lookAt(cameraLookTarget);
      } else if (
        deathCameraActive ||
        cameraState.currentPerspective === PERSPECTIVE_OBSERVER
      ) {
        camera.lookAt(observerFocusPoint);
      } else {
        chaseLookDirection.set(0, 1.2, 20);
        if (cameraState.currentPerspective === PERSPECTIVE_THIRD_PERSON) {
          chaseLookDirection.applyQuaternion(cameraChaseQuaternion);
        } else {
          transformRocketLocalVector(
            rocket,
            chaseLookDirection,
            chaseLookDirection
          );
        }
        cameraLookTarget.copy(rocket.position).add(chaseLookDirection);
        camera.lookAt(cameraLookTarget);
      }

      camera.up.copy(previousUp);

      frameDelta -= INV_MAX_FPS;

      if (frameDelta >= INV_MAX_FPS) {
        inputs = pollInputs();
      }
    }

    updateSpawnFade(currentTime);
    for (let i = 0; i < aiData.length; i++) {
      updateAiSpawnFade(aiData[i], currentTime);
    }

    // Update frustum culling based on camera position
    updateChunkManager(
      chunkManager,
      rocket.position,
      camera,
      physicsState && physicsState.velocity
    );
    if (farShellDebugMode !== 0) {
      applyFullChunkDebugMode(farShellDebugMode);
    }

    // Update far shell opacity based on camera distance
    var farShellOpacityGroup = scene.getObjectByName('farShellSystem');
    if (farShellOpacityGroup) {
      updateFarShellOpacity(farShellOpacityGroup);
    }

    updateStartupPreviewLod();

    // Sync mid-LOD visibility with full chunk existence (throttled)
    var activeMidLodSystem = lodSystems ? lodSystems.midLod : null;
    if (activeMidLodSystem) {
      if (
        currentTime - lastLodVisibilityUpdateTime >=
        LOD_VISIBILITY_INTERVAL_MS
      ) {
        lastLodVisibilityUpdateTime = currentTime;
        activeMidLodSystem.syncVisibility(chunkManager, rocket.position);
      }
      if (DEBUG) {
        lodOwnershipLogCounter++;
        if (lodOwnershipLogCounter >= 300) {
          lodOwnershipLogCounter = 0;
          activeMidLodSystem.logOwnership(chunkManager, rocket.position);
        }
      }
    }

    if (
      currentTime - lastDetailPropVisibilityUpdateTime >=
      DETAIL_PROP_VISIBILITY_INTERVAL_MS
    ) {
      lastDetailPropVisibilityUpdateTime = currentTime;
      refreshDetailPropsVisibility(detailProps, world);
    }
    if (physicsState && physicsState.velocity) {
      detailWindDirection.copy(physicsState.velocity);
      if (detailWindDirection.lengthSq() > 0.0001) {
        detailWindDirection.normalize();
      } else {
        getRocketForwardVector(rocket, detailWindDirection);
      }
    } else {
      getRocketForwardVector(rocket, detailWindDirection);
    }
    updateDetailPropsAnimation(detailProps, timer.getElapsed(), {
      position: rocket.position,
      direction: detailWindDirection,
      speed:
        physicsState && physicsState.velocity
          ? physicsState.velocity.length()
          : 0,
      deltaSeconds: INV_MAX_FPS,
    });

    windParticles.update(camera, timer.getElapsed(), deltaSeconds, windField);

    const effectivePerspective = cameraState.isTransitioning
      ? cameraState.targetPerspective
      : cameraState.currentPerspective;

    var targets = [];

    if (aiEnabled) {
      camera.updateMatrixWorld(true);
      targetLosStart.copy(rocket.position);
      targetLosStart.y += 1.1;

      for (let i = 0; i < aiData.length; i++) {
        const entry = aiData[i];
        if (!entry.destroyed && entry.rocket.visible) {
          transformRocketLocalPoint(
            entry.rocket,
            targetAnchorLocal,
            targetLosEnd
          );
          var losHit = raycastVoxelSegmentBudgeted(
            world,
            targetLosStart,
            targetLosEnd,
            0.15,
            'low'
          );
          targets.push({
            rocket: entry.rocket,
            isVisible: !losHit,
            aiIndex: i,
          });
        }
      }
    }

    updateSpatialLocatorHud(
      hud,
      effectivePerspective,
      rocket,
      targets,
      aiEnabled,
      camera,
      hudEnabled,
      crosshairEnabled,
      audioSystem,
      deltaSeconds,
      weaponUiState
    );

    if (aiEnabled) {
      const aiLockInfos = aiData.map(function (entry) {
        if (entry.player && typeof entry.player.getLockInfo === 'function') {
          return entry.player.getLockInfo();
        }
        return { lockState: 'none', lockStrength: 0, isLocked: false };
      });

      const aiDistances = aiData.map(function (entry) {
        return entry.rocket.position.distanceTo(rocket.position);
      });

      const aiWeapons = aiData.map(function (entry) {
        return entry.weaponSystem.getCurrentWeapon();
      });

      const anyEnemyLocked = aiLockInfos.some(function (info) {
        return info.isLocked;
      });
      const maxLockStrength = Math.max.apply(
        null,
        aiLockInfos.map(function (info) {
          return info.lockStrength;
        })
      );
      const effectiveLockState = anyEnemyLocked
        ? maxLockStrength >= 1
          ? 'locked'
          : 'acquiring'
        : 'none';

      const anyWeaponCanTrack = aiWeapons.some(function (weapon) {
        return weapon && weapon.canTrack === true;
      });

      if (
        audioSystem &&
        typeof audioSystem.updateEnemyLockAudio === 'function'
      ) {
        audioSystem.updateEnemyLockAudio(
          effectiveLockState,
          Math.min.apply(null, aiDistances),
          anyWeaponCanTrack
        );
      }
    }

    if (currentTime - lastUiUpdateTime >= UI_UPDATE_INTERVAL_MS) {
      var aiStates = aiData.map(function (entry) {
        return aiEnabled && !entry.destroyed ? entry.physicsState : null;
      });
      updateUI(
        rocket.position,
        chunkManager,
        physicsState,
        {
          fps: currentFPS,
          ...world.performanceStats,
        },
        aiEnabled,
        aiStates[0] || null,
        aiStates[1] || null,
        lodSystems ? lodSystems.midLod : null,
        scene
      );

      updateOptions(
        chunkManager,
        cameraState.currentPerspective,
        soundtrack ? soundtrack.getUiState() : null,
        audioSystem ? audioSystem.getUiState() : null,
        weaponSystem.getUiState(),
        aiEnabled,
        hudEnabled,
        crosshairEnabled,
        gameConfig
      );
      lastUiUpdateTime = currentTime;
    }

    if (currentTime - lastShadowUpdateTime >= SHADOW_UPDATE_INTERVAL_MS) {
      updateSunlight();
      renderer.shadowMap.needsUpdate = true;
      lastShadowUpdateTime = currentTime;
    }

    renderer.render(scene, camera);
    stats.end();
    requestAnimationFrame(gameLoop);
  }

  return { gameLoop };
}

export { initGameLoop };
