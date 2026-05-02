import * as THREE from 'three';
import { faces, getVoxel } from './voxel.js';
import { isVoxelSolid } from './voxel-materials.js';

const DETAIL_VOXEL_SIZE = 0.08;
const TAU = Math.PI * 2;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const HORIZONTAL_SAMPLE_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const GROUND_AREA_SAMPLE_OFFSETS = [
  [0, 0],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
  [2, 2],
  [-2, 2],
  [2, -2],
  [-2, -2],
  [5, 0],
  [-5, 0],
  [0, 5],
  [0, -5],
];
const DETAIL_WIND_MIN_SPEED = 0.05;
const DETAIL_WIND_FULL_SPEED = 2.8;
const VINE_WAKE_RADIUS = 18;
const VINE_WAKE_VERTICAL_WEIGHT = 0.18;
const VINE_WAKE_RESPONSE = 0.16;
const VINE_WAKE_DECAY = 1.9;
const VINE_WAKE_MAX = 0.34;
const CACTUS_WAKE_RADIUS = 18;
const CACTUS_WAKE_VERTICAL_WEIGHT = 0.18;
const CACTUS_WAKE_RESPONSE = 0.16;
const CACTUS_WAKE_DECAY = 1.9;
const CACTUS_WAKE_MAX = 0.34;
const LANDING_PAD_MAGNET_RADIUS = 72;
const LANDING_PAD_HEAL_RADIUS = 34;
const DETAIL_TEMP_POSITION = new THREE.Vector3();
const DETAIL_TEMP_OFFSET = new THREE.Vector3();
const DETAIL_TEMP_DIRECTION = new THREE.Vector3();
const DETAIL_WORLD_QUATERNION = new THREE.Quaternion();
const DETAIL_WORLD_QUATERNION_INVERSE = new THREE.Quaternion();
const DETAIL_TEMP_LINE = new THREE.Line3();
const DETAIL_EFFECT_WORLD_POSITION = new THREE.Vector3();
const DETAIL_EFFECT_VELOCITY = new THREE.Vector3();
const DETAIL_EFFECT_NORMAL = new THREE.Vector3();
const DETAIL_SEGMENT_CLOSEST_POINT = new THREE.Vector3();
const DETAIL_SEGMENT_TO_CENTER = new THREE.Vector3();
const DETAIL_EFFECT_DEBRIS_GEOMETRY = new THREE.OctahedronGeometry(0.18, 0);
const DETAIL_EFFECT_SMOKE_GEOMETRY = new THREE.SphereGeometry(0.22, 5, 5);
const DETAIL_EFFECT_MATERIALS = {
  cactus: new THREE.MeshBasicMaterial({
    color: 0x8fd55a,
    transparent: true,
    opacity: 1,
  }),
  vine: new THREE.MeshBasicMaterial({
    color: 0xa9db78,
    transparent: true,
    opacity: 0.96,
  }),
  smoke: new THREE.MeshBasicMaterial({
    color: 0x6b645c,
    transparent: true,
    opacity: 0.24,
  }),
};
const DETAIL_VINE_SUPPORT_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const DETAIL_CACTUS_SUPPORT_OFFSETS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const DETAIL_ROCK_FLOOR_SUPPORT_OFFSETS = [
  [0, 0],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
  [2, 2],
  [-2, 2],
  [2, -2],
  [-2, -2],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];
const DETAIL_ROCK_WALL_SUPPORT_OFFSETS = [
  [0, 0, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
  [0, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, -1, 1],
  [0, -1, -1],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blendColor(first, second, t) {
  return first.clone().lerp(second, clamp(t, 0, 1));
}

function dampWindOffset(windOffset, damping, deltaSeconds) {
  const retention = 1 - clamp(damping * deltaSeconds, 0, 1);

  windOffset.multiplyScalar(retention);

  if (windOffset.lengthSq() < 0.000001) {
    windOffset.set(0, 0);
  }
}

function getDetailWindSpeedFactor(windSource) {
  if (!windSource) {
    return 0;
  }

  return clamp(
    (windSource.speed - DETAIL_WIND_MIN_SPEED) /
      (DETAIL_WIND_FULL_SPEED - DETAIL_WIND_MIN_SPEED),
    0,
    1
  );
}

function applyWakeToAnimation(
  animation,
  worldPosition,
  localWindX,
  localWindZ,
  windSource,
  radius,
  verticalWeight,
  response,
  damping,
  maxOffset
) {
  const deltaSeconds = windSource ? windSource.deltaSeconds : 1 / 60;
  const speedFactor = getDetailWindSpeedFactor(windSource);
  const wakeOffset = animation.windOffset;

  dampWindOffset(wakeOffset, damping, deltaSeconds);
  animation.windStrength = wakeOffset.length();

  if (speedFactor <= 0) {
    return wakeOffset;
  }

  DETAIL_TEMP_OFFSET.subVectors(worldPosition, windSource.position);

  const horizontalDistance = Math.hypot(
    DETAIL_TEMP_OFFSET.x,
    DETAIL_TEMP_OFFSET.z
  );
  const distance =
    horizontalDistance + Math.abs(DETAIL_TEMP_OFFSET.y) * verticalWeight;

  if (distance >= radius) {
    return wakeOffset;
  }

  const proximity = 1 - distance / radius;
  const aheadDistance = DETAIL_TEMP_OFFSET.dot(windSource.direction);
  const wakeBias =
    aheadDistance > 0
      ? clamp(1 - aheadDistance / (radius * 0.9), 0.2, 1)
      : 1 + clamp(-aheadDistance / radius, 0, 0.35);
  const speedStrength = 0.35 + speedFactor * 0.65;
  const impulse = proximity * wakeBias * speedStrength * response;

  wakeOffset.x += localWindX * impulse;
  wakeOffset.y += localWindZ * impulse;

  const wakeLengthSq = wakeOffset.lengthSq();

  if (wakeLengthSq > maxOffset * maxOffset) {
    wakeOffset.multiplyScalar(maxOffset / Math.sqrt(wakeLengthSq));
  }

  animation.windStrength = wakeOffset.length();

  return wakeOffset;
}

function chunkKey(x, y, z) {
  return `${x},${y},${z}`;
}

function voxelKey(x, y, z) {
  return `${x},${y},${z}`;
}

function getDecorationSeedRoot(terrainGenerator) {
  if (!terrainGenerator || !terrainGenerator.config) {
    return 'default-decoration-seed';
  }

  return terrainGenerator.config.decorationSeed || 'default-decoration-seed';
}

function getDecorSeedKey(decorationSeedRoot, localSeedKey) {
  return decorationSeedRoot + ':' + localSeedKey;
}

function getDecorHash(decorationSeedRoot, localSeedKey) {
  return hashString(getDecorSeedKey(decorationSeedRoot, localSeedKey));
}

function getDetailRuntime(world) {
  if (!world) {
    return null;
  }

  if (!world.detailPropRuntime) {
    world.detailPropRuntime = {
      destructiblePatches: new Set(),
      chunkToPatches: new Map(),
      destroyedPatchIds: new Set(),
      destructionEffects: [],
      landingPads: new Set(),
      patchIdCounter: 0,
    };
  }

  return world.detailPropRuntime;
}

function getWorldChunkSize(world) {
  if (!world) {
    return 1;
  }

  return world.chunkSize * world.voxelSize;
}

function collectCandidatePatchesInBounds(
  world,
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ
) {
  const runtime = getDetailRuntime(world);

  if (!runtime) {
    return new Set();
  }

  const chunkWorldSize = getWorldChunkSize(world);
  const epsilon = 0.001;
  const minChunkX = Math.floor(minX / chunkWorldSize);
  const minChunkY = Math.floor(minY / chunkWorldSize);
  const minChunkZ = Math.floor(minZ / chunkWorldSize);
  const maxChunkX = Math.floor((maxX - epsilon) / chunkWorldSize);
  const maxChunkY = Math.floor((maxY - epsilon) / chunkWorldSize);
  const maxChunkZ = Math.floor((maxZ - epsilon) / chunkWorldSize);
  const candidates = new Set();

  for (let z = minChunkZ; z <= maxChunkZ; z++) {
    for (let y = minChunkY; y <= maxChunkY; y++) {
      for (let x = minChunkX; x <= maxChunkX; x++) {
        const bucket = runtime.chunkToPatches.get(chunkKey(x, y, z));

        if (!bucket) {
          continue;
        }

        for (const patch of bucket) {
          candidates.add(patch);
        }
      }
    }
  }

  return candidates;
}

function getPatchHitSphere(patch) {
  if (!patch || !patch.userData) {
    return null;
  }

  return patch.userData.hitSphere || null;
}

function registerPatchWithRuntime(world, patch) {
  const runtime = getDetailRuntime(world);

  if (!runtime || !patch || !patch.userData) {
    return;
  }

  if (patch.userData.isLandingPad) {
    runtime.landingPads.add(patch);
  }

  if (!patch.userData.isDestructibleDetailProp) {
    return;
  }

  if (!patch.userData.patchId) {
    runtime.patchIdCounter += 1;
    patch.userData.patchId = `detail-prop-${runtime.patchIdCounter}`;
  }

  runtime.destructiblePatches.add(patch);

  const requiredChunks = patch.userData.requiredChunks;
  if (!requiredChunks) {
    return;
  }

  for (const requiredChunk of requiredChunks) {
    if (!runtime.chunkToPatches.has(requiredChunk)) {
      runtime.chunkToPatches.set(requiredChunk, new Set());
    }

    runtime.chunkToPatches.get(requiredChunk).add(patch);
  }
}

function unregisterPatchFromRuntime(world, patch) {
  const runtime = getDetailRuntime(world);

  if (!runtime || !patch) {
    return;
  }

  runtime.landingPads.delete(patch);

  runtime.destructiblePatches.delete(patch);

  const requiredChunks = patch.userData ? patch.userData.requiredChunks : null;
  if (!requiredChunks) {
    return;
  }

  for (const requiredChunk of requiredChunks) {
    const bucket = runtime.chunkToPatches.get(requiredChunk);
    if (!bucket) {
      continue;
    }

    bucket.delete(patch);

    if (bucket.size === 0) {
      runtime.chunkToPatches.delete(requiredChunk);
    }
  }
}

function createDetailPropExplosion(patch) {
  if (!patch) {
    return [];
  }

  if (patch.userData.detailKind === 'rock-patch') {
    return [];
  }

  const particles = [];
  const isCactus = patch.userData.detailKind === 'moss-cactus-patch';
  const count = isCactus ? 8 : 6;
  const baseMaterial = isCactus
    ? DETAIL_EFFECT_MATERIALS.cactus
    : DETAIL_EFFECT_MATERIALS.vine;

  patch.getWorldPosition(DETAIL_EFFECT_WORLD_POSITION);

  for (let i = 0; i < count; i++) {
    const particle = new THREE.Mesh(
      DETAIL_EFFECT_DEBRIS_GEOMETRY,
      baseMaterial
    );

    DETAIL_EFFECT_NORMAL.set(
      Math.random() - 0.5,
      Math.random() * 0.7 + 0.18,
      Math.random() - 0.5
    ).normalize();
    DETAIL_EFFECT_VELOCITY.copy(DETAIL_EFFECT_NORMAL).multiplyScalar(
      0.1 + Math.random() * 0.18
    );

    particle.position
      .copy(DETAIL_EFFECT_WORLD_POSITION)
      .addScaledVector(DETAIL_EFFECT_NORMAL, Math.random() * 0.85);
    particle.scale.setScalar((isCactus ? 1.15 : 0.92) + Math.random() * 0.48);
    particle.userData = {
      kind: 'debris-puff',
      velocity: DETAIL_EFFECT_VELOCITY.clone(),
      life: 20 + Math.floor(Math.random() * 8),
      maxLife: 20 + Math.floor(Math.random() * 8),
      drag: 0.93 + Math.random() * 0.025,
      growth: 0.016 + Math.random() * 0.022,
      rotationSpeed: (Math.random() - 0.5) * 0.32,
    };
    particle.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );
    particles.push(particle);
  }

  const smokeParticle = new THREE.Mesh(
    DETAIL_EFFECT_SMOKE_GEOMETRY,
    DETAIL_EFFECT_MATERIALS.smoke
  );
  smokeParticle.position.copy(DETAIL_EFFECT_WORLD_POSITION);
  smokeParticle.scale.setScalar(isCactus ? 1.9 : 1.55);
  smokeParticle.userData = {
    kind: 'smoke-puff',
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 0.018,
      0.045 + Math.random() * 0.02,
      (Math.random() - 0.5) * 0.018
    ),
    life: 18 + Math.floor(Math.random() * 6),
    maxLife: 18 + Math.floor(Math.random() * 6),
    drag: 0.955,
    growth: 0.06 + Math.random() * 0.035,
    rotationSpeed: (Math.random() - 0.5) * 0.12,
  };
  particles.push(smokeParticle);

  return particles;
}

function removeDetailPatch(world, patch, reason = 'manual') {
  const runtime = getDetailRuntime(world);

  if (!runtime || !patch || patch.userData.isDestroyedDetailProp) {
    return false;
  }

  if (
    patch.userData.detailKind === 'moss-vine-patch' ||
    patch.userData.detailKind === 'moss-cactus-patch'
  ) {
    patch.userData.isDestroyedDetailProp = true;
    patch.userData.destroyReason = reason;
    patch.userData.removalAnimation = {
      life: 16,
      maxLife: 16,
      driftX: (Math.random() - 0.5) * 0.08,
      driftY: 0.035 + Math.random() * 0.025,
      driftZ: (Math.random() - 0.5) * 0.08,
      spinX: (Math.random() - 0.5) * 0.12,
      spinZ: (Math.random() - 0.5) * 0.12,
    };
    unregisterPatchFromRuntime(world, patch);

    if (patch.userData.patchId) {
      runtime.destroyedPatchIds.add(patch.userData.patchId);
    }

    if (patch.parent) {
      const particles = createDetailPropExplosion(patch);
      for (const particle of particles) {
        patch.parent.add(particle);
        runtime.destructionEffects.push(particle);
      }
    }

    return true;
  }

  patch.userData.isDestroyedDetailProp = true;
  patch.visible = false;
  unregisterPatchFromRuntime(world, patch);

  if (patch.userData.patchId) {
    runtime.destroyedPatchIds.add(patch.userData.patchId);
  }

  if (patch.parent) {
    const particles = createDetailPropExplosion(patch);
    for (const particle of particles) {
      patch.parent.add(particle);
      runtime.destructionEffects.push(particle);
    }

    patch.parent.remove(patch);
  }

  patch.userData.destroyReason = reason;

  return true;
}

function updateDetailDestructionEffects(world) {
  const runtime = getDetailRuntime(world);

  if (!runtime || runtime.destructionEffects.length === 0) {
    return;
  }

  for (let i = runtime.destructionEffects.length - 1; i >= 0; i--) {
    const particle = runtime.destructionEffects[i];

    if (!particle.parent) {
      if (particle.geometry) {
        particle.geometry.dispose();
      }
      if (particle.material) {
        particle.material.dispose();
      }
      runtime.destructionEffects.splice(i, 1);
      continue;
    }

    particle.userData.life--;
    particle.position.add(particle.userData.velocity);
    particle.userData.velocity.multiplyScalar(particle.userData.drag);
    if (particle.userData.kind === 'debris-puff') {
      particle.userData.velocity.y -= 0.0032;
      particle.rotation.x += particle.userData.rotationSpeed;
      particle.rotation.y += particle.userData.rotationSpeed * 0.8;
    } else {
      particle.userData.velocity.y += 0.0012;
    }
    particle.scale.multiplyScalar(1 + particle.userData.growth);
    particle.rotation.z += particle.userData.rotationSpeed;

    if (particle.userData.life > 0) {
      particle.visible = true;
      continue;
    }

    particle.visible = false;
    particle.parent.remove(particle);
    runtime.destructionEffects.splice(i, 1);
  }
}

function updateRemovingDetailPatch(patch) {
  const removalAnimation = patch.userData.removalAnimation;

  if (!removalAnimation) {
    return false;
  }

  removalAnimation.life--;
  patch.position.x += removalAnimation.driftX;
  patch.position.y += removalAnimation.driftY;
  patch.position.z += removalAnimation.driftZ;
  removalAnimation.driftY -= 0.008;
  patch.rotation.x += removalAnimation.spinX;
  patch.rotation.z += removalAnimation.spinZ;
  patch.scale.multiplyScalar(0.86);

  if (removalAnimation.life > 0) {
    return false;
  }

  if (patch.parent) {
    patch.parent.remove(patch);
  }

  patch.visible = false;
  delete patch.userData.removalAnimation;

  return true;
}

function doesPatchHaveSupport(world, patch) {
  if (!world || !patch || !patch.userData || !patch.userData.support) {
    return true;
  }

  const support = patch.userData.support;
  const baseVoxel = support.baseVoxel;

  if (support.mode === 'rock-floor') {
    let supportCount = 0;

    for (const [offsetX, offsetZ] of DETAIL_ROCK_FLOOR_SUPPORT_OFFSETS) {
      const voxelType = getVoxel(
        world,
        baseVoxel.x + offsetX,
        baseVoxel.y,
        baseVoxel.z + offsetZ
      );

      if (isVoxelSolid(voxelType)) {
        supportCount++;
      }
    }

    return supportCount >= 3;
  }

  if (support.mode === 'rock-wall') {
    let supportCount = 0;

    for (const [
      offsetX,
      offsetY,
      offsetZ,
    ] of DETAIL_ROCK_WALL_SUPPORT_OFFSETS) {
      const voxelType = getVoxel(
        world,
        baseVoxel.x + offsetX,
        baseVoxel.y + offsetY,
        baseVoxel.z + offsetZ
      );

      if (isVoxelSolid(voxelType)) {
        supportCount++;
      }
    }

    return supportCount >= 2;
  }

  const sampleOffsets =
    support.mode === 'ceiling'
      ? DETAIL_VINE_SUPPORT_OFFSETS
      : DETAIL_CACTUS_SUPPORT_OFFSETS;

  for (const [offsetX, offsetZ] of sampleOffsets) {
    const voxelType = getVoxel(
      world,
      baseVoxel.x + offsetX,
      baseVoxel.y,
      baseVoxel.z + offsetZ
    );

    if (isVoxelSolid(voxelType)) {
      return true;
    }
  }

  return false;
}

function pruneUnsupportedDetailProps(world, chunkKeys = null) {
  const runtime = getDetailRuntime(world);

  if (!runtime) {
    return 0;
  }

  const candidates = new Set();

  if (chunkKeys && chunkKeys.size > 0) {
    for (const key of chunkKeys) {
      const bucket = runtime.chunkToPatches.get(key);
      if (!bucket) {
        continue;
      }

      for (const patch of bucket) {
        candidates.add(patch);
      }
    }
  } else {
    for (const patch of runtime.destructiblePatches) {
      candidates.add(patch);
    }
  }

  let removedCount = 0;

  for (const patch of candidates) {
    if (!patch.parent || patch.userData.isDestroyedDetailProp) {
      continue;
    }

    if (doesPatchHaveSupport(world, patch)) {
      continue;
    }

    if (removeDetailPatch(world, patch, 'support-lost')) {
      removedCount++;
    }
  }

  return removedCount;
}

function destroyDetailPropsNearPoint(world, point, radius, filterFn = null) {
  const runtime = getDetailRuntime(world);

  if (!runtime) {
    return 0;
  }

  const candidates = collectCandidatePatchesInBounds(
    world,
    point.x - radius,
    point.y - radius,
    point.z - radius,
    point.x + radius,
    point.y + radius,
    point.z + radius
  );

  let destroyedCount = 0;

  for (const patch of candidates) {
    if (!patch.parent || patch.userData.isDestroyedDetailProp) {
      continue;
    }

    if (typeof filterFn === 'function' && !filterFn(patch)) {
      continue;
    }

    const hitSphere = getPatchHitSphere(patch);
    if (!hitSphere) {
      continue;
    }

    const totalRadius = radius + hitSphere.radius;
    if (hitSphere.center.distanceToSquared(point) > totalRadius * totalRadius) {
      continue;
    }

    if (removeDetailPatch(world, patch, 'weapon-hit')) {
      destroyedCount++;
    }
  }

  return destroyedCount;
}

function destroyDetailPropsAlongSegment(
  world,
  start,
  end,
  radius,
  filterFn = null
) {
  const runtime = getDetailRuntime(world);

  if (!runtime) {
    return 0;
  }

  const minX = Math.min(start.x, end.x) - radius;
  const minY = Math.min(start.y, end.y) - radius;
  const minZ = Math.min(start.z, end.z) - radius;
  const maxX = Math.max(start.x, end.x) + radius;
  const maxY = Math.max(start.y, end.y) + radius;
  const maxZ = Math.max(start.z, end.z) + radius;
  const candidates = collectCandidatePatchesInBounds(
    world,
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ
  );

  let destroyedCount = 0;

  DETAIL_TEMP_LINE.set(start, end);

  for (const patch of candidates) {
    if (!patch.parent || patch.userData.isDestroyedDetailProp) {
      continue;
    }

    if (typeof filterFn === 'function' && !filterFn(patch)) {
      continue;
    }

    const hitSphere = getPatchHitSphere(patch);
    if (!hitSphere) {
      continue;
    }

    DETAIL_SEGMENT_CLOSEST_POINT.copy(hitSphere.center);
    DETAIL_TEMP_LINE.closestPointToPoint(
      hitSphere.center,
      true,
      DETAIL_SEGMENT_CLOSEST_POINT
    );
    DETAIL_SEGMENT_TO_CENTER.subVectors(
      hitSphere.center,
      DETAIL_SEGMENT_CLOSEST_POINT
    );

    const totalRadius = radius + hitSphere.radius;

    if (DETAIL_SEGMENT_TO_CENTER.lengthSq() > totalRadius * totalRadius) {
      continue;
    }

    if (removeDetailPatch(world, patch, 'weapon-hit')) {
      destroyedCount++;
    }
  }

  return destroyedCount;
}

function createMaterials() {
  return {
    dark: new THREE.MeshStandardMaterial({
      color: 0x1b2427,
      roughness: 0.88,
      metalness: 0.04,
      vertexColors: true,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0x5a5550,
      roughness: 0.7,
      metalness: 0.18,
      vertexColors: true,
    }),
    cyan: new THREE.MeshStandardMaterial({
      color: 0x86fff2,
      emissive: 0x25d8ca,
      emissiveIntensity: 0.92,
      roughness: 0.26,
      vertexColors: true,
    }),
    paleCyan: new THREE.MeshStandardMaterial({
      color: 0xd5fff9,
      emissive: 0x64fff1,
      emissiveIntensity: 0.46,
      roughness: 0.2,
      vertexColors: true,
    }),
    crystal: new THREE.MeshStandardMaterial({
      color: 0xa8efff,
      emissive: 0x46b8ff,
      emissiveIntensity: 1.35,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      roughness: 0.04,
      metalness: 0.08,
      envMapIntensity: 1.8,
      vertexColors: true,
    }),
    amber: new THREE.MeshStandardMaterial({
      color: 0xb36a31,
      roughness: 0.72,
      metalness: 0.04,
      vertexColors: true,
    }),
    amberGlow: new THREE.MeshStandardMaterial({
      color: 0xffc46f,
      emissive: 0xff7a1f,
      emissiveIntensity: 2.4,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      roughness: 0.18,
      vertexColors: true,
    }),
    moss: new THREE.MeshStandardMaterial({
      color: 0x355d34,
      roughness: 0.9,
      metalness: 0.0,
      vertexColors: true,
    }),
    mossGlow: new THREE.MeshStandardMaterial({
      color: 0x8fffab,
      emissive: 0x41ff7d,
      emissiveIntensity: 0.72,
      roughness: 0.32,
      vertexColors: true,
    }),
    stone: new THREE.MeshStandardMaterial({
      color: 0xd8dde1,
      roughness: 0.96,
      metalness: 0.0,
      vertexColors: true,
    }),
    vine: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x1f2f1c,
      emissiveIntensity: 0.32,
      roughness: 0.86,
      metalness: 0.0,
      vertexColors: true,
    }),
  };
}

function createVoxelStore() {
  return new Map();
}

function getVoxelBucket(voxelStore, materialKey) {
  if (!voxelStore.has(materialKey)) {
    voxelStore.set(materialKey, new Map());
  }

  return voxelStore.get(materialKey);
}

function setVoxel(voxelStore, materialKey, x, y, z, color = null) {
  const bucket = getVoxelBucket(voxelStore, materialKey);

  bucket.set(voxelKey(x, y, z), {
    x,
    y,
    z,
    materialKey,
    color,
  });
}

function addVoxelColor(baseColor, baseTint, faceNormal, voxelPosition) {
  const normalBias = clamp((faceNormal[1] + 1) * 0.5, 0, 1);
  const topBias = clamp((voxelPosition.y + 8) / 18, 0, 1);
  const hash =
    Math.abs(
      Math.sin(
        voxelPosition.x * 12.9898 +
          voxelPosition.y * 78.233 +
          voxelPosition.z * 37.719
      )
    ) * 43758.5453;
  const variation = (hash % 1) * 0.14 - 0.07;
  const brightness = 0.7 + topBias * 0.18 + normalBias * 0.16 + variation;
  const tintStrength = 0.08 + topBias * 0.08;

  return new THREE.Color(
    clamp(baseColor.r * brightness + baseTint.r * tintStrength, 0, 1),
    clamp(baseColor.g * brightness + baseTint.g * tintStrength, 0, 1),
    clamp(baseColor.b * brightness + baseTint.b * tintStrength, 0, 1)
  );
}

function createMergedGeometryFromVoxels(bucket, material, baseColor, baseTint) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];

  for (const voxel of bucket.values()) {
    for (const face of faces) {
      const neighborX = voxel.x + face.dir[0];
      const neighborY = voxel.y + face.dir[1];
      const neighborZ = voxel.z + face.dir[2];

      if (bucket.has(voxelKey(neighborX, neighborY, neighborZ))) {
        continue;
      }

      const vertexOffset = positions.length / 3;
      const color =
        voxel.color || addVoxelColor(baseColor, baseTint, face.dir, voxel);

      for (const corner of face.corners) {
        positions.push(
          (voxel.x + corner[0]) * DETAIL_VOXEL_SIZE,
          (voxel.y + corner[1]) * DETAIL_VOXEL_SIZE,
          (voxel.z + corner[2]) * DETAIL_VOXEL_SIZE
        );
        normals.push(face.dir[0], face.dir[1], face.dir[2]);
        colors.push(color.r, color.g, color.b);
      }

      indices.push(
        vertexOffset,
        vertexOffset + 1,
        vertexOffset + 2,
        vertexOffset + 2,
        vertexOffset + 1,
        vertexOffset + 3
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  return mesh;
}

function buildPropGroup(voxelStore, materials) {
  const group = new THREE.Group();
  const baseColors = {
    dark: new THREE.Color(0.12, 0.15, 0.16),
    metal: new THREE.Color(0.38, 0.34, 0.3),
    cyan: new THREE.Color(0.42, 0.96, 0.92),
    paleCyan: new THREE.Color(0.82, 1.0, 0.98),
    crystal: new THREE.Color(0.55, 0.88, 1.0),
    amber: new THREE.Color(0.72, 0.42, 0.2),
    amberGlow: new THREE.Color(1.0, 0.48, 0.16),
    moss: new THREE.Color(0.26, 0.44, 0.25),
    mossGlow: new THREE.Color(0.62, 1.0, 0.74),
    stone: new THREE.Color(0.76, 0.79, 0.82),
    vine: new THREE.Color(0.72, 0.92, 0.64),
  };
  const tintColors = {
    dark: new THREE.Color(0.04, 0.06, 0.07),
    metal: new THREE.Color(0.74, 0.62, 0.46),
    cyan: new THREE.Color(0.48, 1.0, 0.92),
    paleCyan: new THREE.Color(0.62, 0.98, 1.0),
    crystal: new THREE.Color(0.7, 0.96, 1.0),
    amber: new THREE.Color(1.0, 0.7, 0.28),
    amberGlow: new THREE.Color(1.0, 0.8, 0.42),
    moss: new THREE.Color(0.46, 0.78, 0.4),
    mossGlow: new THREE.Color(0.72, 1.0, 0.84),
    stone: new THREE.Color(0.94, 0.96, 0.98),
    vine: new THREE.Color(0.96, 0.98, 0.84),
  };

  for (const [materialKey, bucket] of voxelStore.entries()) {
    if (bucket.size === 0) {
      continue;
    }

    const mesh = createMergedGeometryFromVoxels(
      bucket,
      materials[materialKey],
      baseColors[materialKey],
      tintColors[materialKey]
    );
    mesh.name = `detail-${materialKey}`;
    group.add(mesh);
  }

  return group;
}

function copyTemplateToVoxelStore(voxelStore, template) {
  const scale = template.voxelSize || DETAIL_VOXEL_SIZE;
  const scaleFactor = scale / DETAIL_VOXEL_SIZE;

  for (const voxel of template.voxels) {
    setVoxel(
      voxelStore,
      voxel.materialKey,
      Math.round(voxel.x * scaleFactor),
      Math.round(voxel.y * scaleFactor),
      Math.round(voxel.z * scaleFactor),
      voxel.color ? voxel.color.clone() : null
    );
  }
}

function createPrototype(name, template, materials) {
  const voxelStore = createVoxelStore();

  copyTemplateToVoxelStore(voxelStore, template);

  const group = buildPropGroup(voxelStore, materials);
  group.name = name;
  group.userData.localBounds = new THREE.Box3().setFromObject(group);

  return group;
}

function voxelStoreToTemplate(voxelStore) {
  return {
    voxels: Array.from(voxelStore.values()).flatMap(function (bucket) {
      return Array.from(bucket.values()).map(function (voxel) {
        return {
          x: voxel.x,
          y: voxel.y,
          z: voxel.z,
          materialKey: voxel.materialKey,
          color: voxel.color ? voxel.color.clone() : null,
        };
      });
    }),
  };
}

function fillEllipsoid(
  voxelStore,
  materialKey,
  centerX,
  centerY,
  centerZ,
  radiusX,
  radiusY,
  radiusZ,
  color = null
) {
  const minX = Math.floor(centerX - radiusX);
  const maxX = Math.ceil(centerX + radiusX);
  const minY = Math.floor(centerY - radiusY);
  const maxY = Math.ceil(centerY + radiusY);
  const minZ = Math.floor(centerZ - radiusZ);
  const maxZ = Math.ceil(centerZ + radiusZ);

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = radiusX === 0 ? 0 : (x - centerX) / radiusX;
        const dy = radiusY === 0 ? 0 : (y - centerY) / radiusY;
        const dz = radiusZ === 0 ? 0 : (z - centerZ) / radiusZ;

        if (dx * dx + dy * dy + dz * dz <= 1) {
          setVoxel(voxelStore, materialKey, x, y, z, color);
        }
      }
    }
  }
}

function drawThickLine(
  voxelStore,
  materialKey,
  start,
  end,
  radius,
  color = null
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) * 2 + 1;

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;

    fillEllipsoid(
      voxelStore,
      materialKey,
      start.x + dx * t,
      start.y + dy * t,
      start.z + dz * t,
      radius,
      radius,
      radius,
      color
    );
  }
}

function createMossVineAnchorTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const barkColor = new THREE.Color(0x1d3116);
  const mossColor = new THREE.Color(0x4f8f2b);
  const tipColor = new THREE.Color(0xc9ff6b);
  const anchorRadius = 2.4 + variantId * 0.45;

  fillEllipsoid(
    voxelStore,
    'vine',
    0,
    -0.8,
    0,
    anchorRadius,
    0.8,
    anchorRadius,
    barkColor
  );
  fillEllipsoid(
    voxelStore,
    'vine',
    0,
    -1.8,
    0,
    anchorRadius + 0.8,
    0.9,
    anchorRadius + 0.8,
    mossColor
  );

  for (let i = 0; i < 5 + variantId; i++) {
    const angle = (i / (5 + variantId)) * TAU + variantId * 0.37;
    const root = {
      x: Math.round(Math.cos(angle) * (anchorRadius - 0.3)),
      y: -1,
      z: Math.round(Math.sin(angle) * (anchorRadius - 0.3)),
    };
    const tip = {
      x: Math.round(root.x * 0.5),
      y: -3 - (i % 2),
      z: Math.round(root.z * 0.5),
    };

    drawThickLine(
      voxelStore,
      'vine',
      root,
      tip,
      0.4,
      blendColor(mossColor, tipColor, 0.28 + (i % 2) * 0.18)
    );
  }

  return voxelStoreToTemplate(voxelStore);
}

function createMossVineStrandTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const barkColor = new THREE.Color(0x162614);
  const mossColor = new THREE.Color(0x4e912b);
  const brightLeafColor = new THREE.Color(0x9cf04b);
  const tipColor = new THREE.Color(0xdfff79);
  const bloomColor = new THREE.Color(0xff4a56);
  const segmentCount = 8 + variantId * 2;
  const strandLength = 30 + variantId * 8;
  const curveStrength = 1.7 + variantId * 0.34;
  const basePoint = { x: 0, y: -2, z: 0 };
  const tuftScale = 0.98 + variantId * 0.08;
  let previousPoint = basePoint;

  drawThickLine(
    voxelStore,
    'vine',
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -2, z: 0 },
    0.52,
    barkColor
  );

  for (let segment = 1; segment <= segmentCount; segment++) {
    const t = segment / segmentCount;
    const bend = Math.pow(t, 1.14);
    const arcX =
      Math.sin(t * (2.5 + variantId * 0.3) + variantId * 0.9) *
      (0.7 + bend * curveStrength * 1.24);
    const arcZ =
      Math.cos(t * (2.1 + variantId * 0.24) + variantId * 0.45) *
      (0.85 + bend * (curveStrength + 1.1));
    const curlX =
      Math.sin(t * (6.3 + variantId * 0.6) + variantId * 1.8) *
      (0.18 + bend * 0.82);
    const curlZ =
      Math.cos(t * (5.6 + variantId * 0.5) + variantId * 1.1) *
      (0.14 + bend * 0.72);
    const point = {
      x: Math.round(arcX + curlX),
      y: Math.round(-2 - strandLength * t),
      z: Math.round(arcZ + curlZ),
    };
    const segmentColor = blendColor(barkColor, mossColor, t * 1.08);
    const radius = Math.max(0.3, 0.58 - t * 0.19 + variantId * 0.03);
    const leafColor = blendColor(mossColor, brightLeafColor, 0.25 + t * 0.75);
    const leafSpread = 1.7 + t * (2.5 + variantId * 0.44);
    const sideDirection = (segment + variantId) % 2 === 0 ? 1 : -1;
    const leafDrift =
      Math.sin(segment * 1.8 + variantId * 0.7) * (0.4 + t * 0.9);
    const leafTip = {
      x: point.x + Math.round(sideDirection * leafSpread),
      y: point.y - Math.round(0.5 + t * 1.4),
      z: point.z + Math.round(leafDrift),
    };
    const midLeafTip = {
      x:
        point.x +
        Math.round(sideDirection * (0.9 + t * (1.3 + variantId * 0.22))),
      y: point.y - Math.round(0.2 + t * 0.9),
      z: point.z - Math.round(leafDrift * 0.7),
    };

    drawThickLine(
      voxelStore,
      'vine',
      previousPoint,
      point,
      radius,
      segmentColor
    );
    drawThickLine(
      voxelStore,
      'vine',
      point,
      leafTip,
      Math.max(0.24, radius * 0.72),
      leafColor
    );
    drawThickLine(
      voxelStore,
      'vine',
      point,
      midLeafTip,
      Math.max(0.2, radius * 0.58),
      blendColor(mossColor, brightLeafColor, 0.16 + t * 0.54)
    );

    fillEllipsoid(
      voxelStore,
      'vine',
      leafTip.x,
      leafTip.y,
      leafTip.z,
      0.92 * tuftScale,
      0.58 * tuftScale,
      0.92 * tuftScale,
      blendColor(leafColor, tipColor, 0.35)
    );
    fillEllipsoid(
      voxelStore,
      'vine',
      midLeafTip.x,
      midLeafTip.y,
      midLeafTip.z,
      0.72 * tuftScale,
      0.46 * tuftScale,
      0.72 * tuftScale,
      blendColor(mossColor, brightLeafColor, 0.22 + t * 0.4)
    );

    if (segment > 2 && segment < segmentCount && segment % 3 === 0) {
      const oppositeTip = {
        x: point.x - Math.round(sideDirection * (leafSpread * 0.66)),
        y: point.y - Math.round(0.6 + t * 0.7),
        z:
          point.z -
          Math.round(Math.cos(segment * 1.2 + variantId * 0.7) * (0.4 + t)),
      };

      drawThickLine(
        voxelStore,
        'vine',
        point,
        oppositeTip,
        0.24,
        blendColor(mossColor, brightLeafColor, 0.18 + t * 0.62)
      );
      fillEllipsoid(
        voxelStore,
        'vine',
        oppositeTip.x,
        oppositeTip.y,
        oppositeTip.z,
        0.82 * tuftScale,
        0.5 * tuftScale,
        0.82 * tuftScale,
        blendColor(brightLeafColor, tipColor, 0.28)
      );
    }

    if (
      segment >= 3 &&
      segment <= segmentCount - 2 &&
      (segment + variantId) % 4 === 0
    ) {
      fillEllipsoid(
        voxelStore,
        'vine',
        leafTip.x,
        leafTip.y - 1,
        leafTip.z,
        0.5,
        0.5,
        0.5,
        bloomColor
      );
    }

    previousPoint = point;
  }

  fillEllipsoid(
    voxelStore,
    'vine',
    previousPoint.x,
    previousPoint.y,
    previousPoint.z,
    0.9,
    1.1,
    0.9,
    tipColor
  );

  return voxelStoreToTemplate(voxelStore);
}

function createBuiltInMossVineAssets(materials) {
  return {
    anchors: [0, 1].map(function (variantId) {
      return createPrototype(
        `detail-moss-vine-anchor-${variantId}`,
        createMossVineAnchorTemplate(variantId),
        materials
      );
    }),
    strands: [0, 1, 2, 3].map(function (variantId) {
      return createPrototype(
        `detail-moss-vine-strand-${variantId}`,
        createMossVineStrandTemplate(variantId),
        materials
      );
    }),
  };
}

function createMossCactusBaseTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const rootColor = new THREE.Color(0x294619);
  const padColor = new THREE.Color(0x5fae2f);
  const tipColor = new THREE.Color(0xbaff5f);
  const radius = 3.2 + variantId * 0.55;

  fillEllipsoid(voxelStore, 'moss', 0, 0.8, 0, radius, 1.1, radius, rootColor);
  fillEllipsoid(
    voxelStore,
    'vine',
    0,
    1.6,
    0,
    radius * 0.62,
    0.72,
    radius * 0.62,
    padColor
  );

  for (let i = 0; i < 5 + variantId; i++) {
    const angle = (i / (5 + variantId)) * TAU + variantId * 0.31;
    const sprout = {
      x: Math.round(Math.cos(angle) * (radius * 0.72)),
      y: 2,
      z: Math.round(Math.sin(angle) * (radius * 0.72)),
    };

    fillEllipsoid(
      voxelStore,
      'vine',
      sprout.x,
      sprout.y,
      sprout.z,
      0.72,
      1.2,
      0.72,
      blendColor(padColor, tipColor, 0.24 + (i % 2) * 0.14)
    );
  }

  return voxelStoreToTemplate(voxelStore);
}

function createMossCactusSegmentTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const darkColor = new THREE.Color(0x2e5618);
  const bodyColor = new THREE.Color(0x76c93a);
  const tipColor = new THREE.Color(0xc6ff74);
  const coreRadius = 0.95 + variantId * 0.12;
  const segmentHeight = 7.4 + variantId * 1.15;

  fillEllipsoid(
    voxelStore,
    'vine',
    0,
    segmentHeight * 0.48,
    0,
    coreRadius,
    segmentHeight * 0.52,
    coreRadius,
    bodyColor
  );

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * TAU + variantId * 0.21;
    const offsetX = Math.cos(angle) * (coreRadius * 0.54);
    const offsetZ = Math.sin(angle) * (coreRadius * 0.54);
    const ribColor = blendColor(darkColor, bodyColor, 0.44 + (i % 2) * 0.18);

    drawThickLine(
      voxelStore,
      'vine',
      {
        x: Math.round(offsetX * 0.72),
        y: 0,
        z: Math.round(offsetZ * 0.72),
      },
      {
        x: Math.round(offsetX),
        y: Math.round(segmentHeight - 1.4),
        z: Math.round(offsetZ),
      },
      0.24 + variantId * 0.02,
      ribColor
    );
  }

  fillEllipsoid(
    voxelStore,
    'vine',
    0,
    segmentHeight - 1.1,
    0,
    coreRadius * 0.88,
    1.05,
    coreRadius * 0.88,
    tipColor
  );

  if (variantId % 2 === 1) {
    fillEllipsoid(
      voxelStore,
      'vine',
      Math.round(coreRadius * 0.7),
      segmentHeight * 0.72,
      0,
      0.52,
      0.92,
      0.52,
      blendColor(bodyColor, tipColor, 0.3)
    );
  }

  return voxelStoreToTemplate(voxelStore);
}

function createBuiltInMossCactusAssets(materials) {
  return {
    bases: [0, 1].map(function (variantId) {
      return createPrototype(
        `detail-moss-cactus-base-${variantId}`,
        createMossCactusBaseTemplate(variantId),
        materials
      );
    }),
    segments: [0, 1, 2, 3].map(function (variantId) {
      return createPrototype(
        `detail-moss-cactus-segment-${variantId}`,
        createMossCactusSegmentTemplate(variantId),
        materials
      );
    }),
  };
}

function createRockLayerColor(baseColor, highlightColor, shadeColor, mix) {
  const tone = blendColor(baseColor, highlightColor, mix);

  return blendColor(tone, shadeColor, 0.14 + mix * 0.08);
}

function addRockLump(voxelStore, center, radii, color) {
  fillEllipsoid(
    voxelStore,
    'stone',
    center.x,
    center.y,
    center.z,
    radii.x,
    radii.y,
    radii.z,
    color
  );
}

function carveRockNotch(voxelStore, center, radii) {
  const minX = Math.floor(center.x - radii.x);
  const maxX = Math.ceil(center.x + radii.x);
  const minY = Math.floor(center.y - radii.y);
  const maxY = Math.ceil(center.y + radii.y);
  const minZ = Math.floor(center.z - radii.z);
  const maxZ = Math.ceil(center.z + radii.z);
  const stoneBucket = getVoxelBucket(voxelStore, 'stone');

  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = radii.x === 0 ? 0 : (x - center.x) / radii.x;
        const dy = radii.y === 0 ? 0 : (y - center.y) / radii.y;
        const dz = radii.z === 0 ? 0 : (z - center.z) / radii.z;

        if (dx * dx + dy * dy + dz * dz <= 1) {
          stoneBucket.delete(voxelKey(x, y, z));
        }
      }
    }
  }
}

function createRockTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const baseColor = new THREE.Color(0xaeb8bf);
  const highlightColor = new THREE.Color(0xe6edf1);
  const shadeColor = new THREE.Color(0x879098);
  const footprintX = 4.6 + (variantId % 3) * 1.25;
  const footprintZ = 4.4 + ((variantId + 1) % 3) * 1.2;
  const height = 3.5 + variantId * 0.95;
  const lumpCount = 3 + variantId;

  for (let i = 0; i < lumpCount; i++) {
    const orbitAngle = (i / lumpCount) * TAU + variantId * 0.39;
    const orbitRadius = (0.6 + (i % 3) * 0.34) * (1 + variantId * 0.08);
    const mix = i / Math.max(1, lumpCount - 1);

    addRockLump(
      voxelStore,
      {
        x: Math.cos(orbitAngle) * orbitRadius,
        y: 1.0 + (i % 2) * 0.62 + mix * height * 0.16,
        z: Math.sin(orbitAngle) * orbitRadius,
      },
      {
        x: footprintX * (0.5 + mix * 0.16),
        y: height * (0.5 + (i % 2) * 0.08),
        z: footprintZ * (0.49 + ((i + 1) % 2) * 0.08),
      },
      createRockLayerColor(baseColor, highlightColor, shadeColor, mix)
    );
  }

  addRockLump(
    voxelStore,
    { x: 0, y: 0.2, z: 0 },
    { x: footprintX * 0.94, y: height * 0.38, z: footprintZ * 0.94 },
    blendColor(baseColor, shadeColor, 0.28)
  );

  for (let i = 0; i < 2 + variantId; i++) {
    const cutAngle = (i / (2 + variantId)) * TAU + variantId * 0.28;
    const cutDistance = 1.4 + (i % 2) * 0.9;

    carveRockNotch(
      voxelStore,
      {
        x: Math.cos(cutAngle) * cutDistance,
        y: 2.1 + (i % 2) * 0.72,
        z: Math.sin(cutAngle) * cutDistance,
      },
      {
        x: 0.95 + variantId * 0.18,
        y: 0.72 + (i % 2) * 0.18,
        z: 0.92 + ((i + variantId) % 2) * 0.24,
      }
    );
  }

  for (let i = 0; i < 5 + variantId; i++) {
    const seamAngle = (i / (5 + variantId)) * TAU + variantId * 0.17;
    const seamRadiusX = footprintX * (0.4 + (i % 2) * 0.08);
    const seamRadiusZ = footprintZ * (0.4 + ((i + 1) % 2) * 0.08);

    fillEllipsoid(
      voxelStore,
      'stone',
      Math.cos(seamAngle) * seamRadiusX,
      1.1 + (i % 3) * 0.66,
      Math.sin(seamAngle) * seamRadiusZ,
      0.82 + (i % 2) * 0.18,
      0.66,
      0.82 + ((i + 1) % 2) * 0.18,
      blendColor(highlightColor, shadeColor, 0.18 + (i % 3) * 0.14)
    );
  }

  return voxelStoreToTemplate(voxelStore);
}

function createBuiltInRockAssets(materials) {
  return [0, 1, 2, 3].map(function (variantId) {
    return createPrototype(
      `detail-rock-${variantId}`,
      createRockTemplate(variantId),
      materials
    );
  });
}

function createLandingPadTemplate(variantId) {
  const voxelStore = createVoxelStore();
  const baseColor = new THREE.Color(0xd7d9dd);
  const sideColor = new THREE.Color(0xa9afb7);
  const legColor = new THREE.Color(0x737a82);
  const panelColor = new THREE.Color(0x8f8477);
  const panelHighlight = new THREE.Color(0xc7b497);
  const topColor = new THREE.Color(0xff3f2f);
  const width = 8 + variantId;
  const depth = 8 + variantId;
  const topWidth = width - 2;
  const topDepth = depth - 2;

  for (let x = -width; x <= width; x++) {
    for (let z = -depth; z <= depth; z++) {
      setVoxel(voxelStore, 'stone', x, 0, z, sideColor);
    }
  }

  for (let x = -(width - 1); x <= width - 1; x++) {
    for (let z = -(depth - 1); z <= depth - 1; z++) {
      setVoxel(voxelStore, 'metal', x, 1, z, baseColor);
    }
  }

  for (let x = -width + 2; x <= width - 2; x++) {
    setVoxel(voxelStore, 'metal', x, 1, -depth + 2, panelColor);
    setVoxel(voxelStore, 'metal', x, 1, depth - 2, panelColor);
  }

  for (let z = -depth + 2; z <= depth - 2; z++) {
    setVoxel(voxelStore, 'metal', -width + 2, 1, z, panelColor);
    setVoxel(voxelStore, 'metal', width - 2, 1, z, panelColor);
  }

  for (let x = -2; x <= 2; x++) {
    for (const z of [-depth + 3, depth - 3]) {
      setVoxel(voxelStore, 'metal', x, 1, z, panelHighlight);
    }
  }

  for (let z = -2; z <= 2; z++) {
    for (const x of [-width + 3, width - 3]) {
      setVoxel(voxelStore, 'metal', x, 1, z, panelHighlight);
    }
  }

  for (const legX of [-1, 1]) {
    for (const legZ of [-1, 1]) {
      const xStart = legX * Math.max(2, width - 4);
      const zStart = legZ * Math.max(2, depth - 4);

      for (let x = xStart - 1; x <= xStart + 1; x++) {
        for (let z = zStart - 1; z <= zStart + 1; z++) {
          setVoxel(voxelStore, 'metal', x, 2, z, legColor);
          setVoxel(voxelStore, 'metal', x, 3, z, legColor);
        }
      }
    }
  }

  for (let x = -topWidth; x <= topWidth; x++) {
    for (let z = -topDepth; z <= topDepth; z++) {
      setVoxel(voxelStore, 'metal', x, 4, z, baseColor);
    }
  }

  for (let x = -topWidth + 1; x <= topWidth - 1; x++) {
    setVoxel(voxelStore, 'metal', x, 4, -topDepth, panelColor);
    setVoxel(voxelStore, 'metal', x, 4, topDepth, panelColor);
  }

  for (let z = -topDepth + 1; z <= topDepth - 1; z++) {
    setVoxel(voxelStore, 'metal', -topWidth, 4, z, panelColor);
    setVoxel(voxelStore, 'metal', topWidth, 4, z, panelColor);
  }

  for (let x = -1; x <= 1; x++) {
    for (const z of [-topDepth + 1, topDepth - 1]) {
      setVoxel(voxelStore, 'metal', x, 4, z, panelHighlight);
    }
  }

  for (let z = -1; z <= 1; z++) {
    for (const x of [-topWidth + 1, topWidth - 1]) {
      setVoxel(voxelStore, 'metal', x, 4, z, panelHighlight);
    }
  }

  for (let x = -(topWidth - 1); x <= topWidth - 1; x++) {
    for (let z = -(topDepth - 1); z <= topDepth - 1; z++) {
      setVoxel(voxelStore, 'amberGlow', x, 5, z, topColor);
    }
  }

  return voxelStoreToTemplate(voxelStore);
}

function createBuiltInLandingPadAssets(materials) {
  return [0, 1].map(function (variantId) {
    return createPrototype(
      `detail-landing-pad-${variantId}`,
      createLandingPadTemplate(variantId),
      materials
    );
  });
}

function setObjectScale(object, scale) {
  if (typeof scale === 'number') {
    object.scale.setScalar(scale);
    return;
  }

  if (scale && typeof scale === 'object') {
    object.scale.set(
      scale.x === undefined ? 1 : scale.x,
      scale.y === undefined ? 1 : scale.y,
      scale.z === undefined ? 1 : scale.z
    );
  }
}

function createMossVinePatch(
  name,
  vineAssets,
  worldChunkSize,
  position,
  rotation,
  scale,
  seedKey
) {
  const group = new THREE.Group();
  const anchorPrototype =
    vineAssets.anchors[
      Math.floor(hashString(`${seedKey}:anchor`) * vineAssets.anchors.length)
    ];
  const strandCount = 4 + Math.floor(hashString(`${seedKey}:strand-count`) * 4);
  const strandSpread = 2.4 + hashString(`${seedKey}:spread`) * 1.8;

  group.name = name;
  group.position.copy(position);
  if (rotation) {
    group.quaternion.copy(rotation);
  }
  setObjectScale(group, scale);
  group.add(anchorPrototype.clone(true));

  for (let i = 0; i < strandCount; i++) {
    const strandPrototype =
      vineAssets.strands[
        Math.floor(
          hashString(`${seedKey}:strand-prototype:${i}`) *
            vineAssets.strands.length
        )
      ];
    const strand = strandPrototype.clone(true);
    const angle = hashString(`${seedKey}:strand-angle:${i}`) * TAU;
    const radius =
      Math.sqrt(hashString(`${seedKey}:strand-radius:${i}`)) * strandSpread;
    const thicknessScale =
      1.02 + hashString(`${seedKey}:strand-thickness:${i}`) * 0.24;
    const lengthScale =
      0.86 + hashString(`${seedKey}:strand-length:${i}`) * 0.68;
    const leanX = -0.06 + hashString(`${seedKey}:strand-lean-x:${i}`) * 0.12;
    const leanZ = -0.06 + hashString(`${seedKey}:strand-lean-z:${i}`) * 0.12;

    strand.position.set(
      Math.cos(angle) * radius,
      -0.2 - hashString(`${seedKey}:strand-drop:${i}`) * 0.5,
      Math.sin(angle) * radius
    );
    strand.quaternion.setFromAxisAngle(
      UP_AXIS,
      hashString(`${seedKey}:strand-yaw:${i}`) * TAU
    );
    strand.rotateX(leanX);
    strand.rotateZ(leanZ);
    strand.scale.set(thicknessScale, lengthScale, thicknessScale);
    strand.userData.animation = {
      kind: 'moss-vine-strand',
      basePosition: strand.position.clone(),
      baseQuaternion: strand.quaternion.clone(),
      baseScale: strand.scale.clone(),
      phase: hashString(`${seedKey}:strand-phase:${i}`) * TAU,
      speed: 0.48 + hashString(`${seedKey}:strand-speed:${i}`) * 0.3,
      secondarySpeed:
        0.86 + hashString(`${seedKey}:strand-secondary-speed:${i}`) * 0.44,
      swayXAmplitude:
        0.018 + hashString(`${seedKey}:strand-sway-x:${i}`) * 0.038,
      swayZAmplitude:
        0.012 + hashString(`${seedKey}:strand-sway-z:${i}`) * 0.03,
      twistAmplitude:
        0.006 + hashString(`${seedKey}:strand-twist:${i}`) * 0.014,
      scaleAmplitude:
        0.002 + hashString(`${seedKey}:strand-scale:${i}`) * 0.004,
      windOffset: new THREE.Vector2(),
      windStrength: 0,
      windPhase: hashString(`${seedKey}:strand-wind-phase:${i}`) * TAU,
    };

    group.add(strand);
  }

  group.userData.animation = {
    kind: 'moss-vine-patch',
  };
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(group);
  bounds.expandByScalar(4);
  group.userData.requiredChunks = buildChunkCoverage(bounds, worldChunkSize);
  group.userData.detailKind = 'moss-vine-patch';
  group.userData.isDestructibleDetailProp = true;
  group.userData.hitSphere = bounds.getBoundingSphere(new THREE.Sphere());
  group.userData.support = {
    mode: 'ceiling',
    baseVoxel: {
      x: Math.round(position.x),
      y: Math.round(position.y),
      z: Math.round(position.z),
    },
  };

  return group;
}

function createMossCactusPatch(
  name,
  cactusAssets,
  worldChunkSize,
  position,
  rotation,
  scale,
  seedKey
) {
  const group = new THREE.Group();
  const basePrototype =
    cactusAssets.bases[
      Math.floor(hashString(`${seedKey}:base`) * cactusAssets.bases.length)
    ];
  const stalkCount = 6 + Math.floor(hashString(`${seedKey}:stalk-count`) * 6);
  const patchRadius = 0.85 + hashString(`${seedKey}:patch-radius`) * 1.55;

  group.name = name;
  group.position.copy(position);
  if (rotation) {
    group.quaternion.copy(rotation);
  }
  setObjectScale(group, scale);
  group.add(basePrototype.clone(true));

  for (let i = 0; i < stalkCount; i++) {
    const stalk = new THREE.Group();
    const angle = hashString(`${seedKey}:stalk-angle:${i}`) * TAU;
    const radial =
      Math.sqrt(hashString(`${seedKey}:stalk-radius:${i}`)) * patchRadius;
    const segmentCount =
      4 + Math.floor(hashString(`${seedKey}:segment-count:${i}`) * 5);
    const stalkPhase = hashString(`${seedKey}:stalk-phase:${i}`) * TAU;
    const stalkSpeed = 0.66 + hashString(`${seedKey}:stalk-speed:${i}`) * 0.18;
    const stalkSecondarySpeed =
      0.92 + hashString(`${seedKey}:stalk-secondary-speed:${i}`) * 0.2;
    const curvePhase = hashString(`${seedKey}:stalk-curve:${i}`) * TAU;
    const curveStrength =
      0.04 + hashString(`${seedKey}:stalk-curve-strength:${i}`) * 0.08;
    let currentY = 0;

    stalk.name = `${name}-stalk-${i}`;
    stalk.position.set(Math.cos(angle) * radial, 0, Math.sin(angle) * radial);
    stalk.quaternion.setFromAxisAngle(
      UP_AXIS,
      hashString(`${seedKey}:stalk-yaw:${i}`) * TAU
    );
    stalk.userData.animation = {
      kind: 'moss-cactus-stalk',
      baseQuaternion: stalk.quaternion.clone(),
      sampleHeight: 0,
      windOffset: new THREE.Vector2(),
      windStrength: 0,
      windPhase: hashString(`${seedKey}:stalk-wind-phase:${i}`) * TAU,
    };

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const growth = segmentCount <= 1 ? 0 : segmentIndex / (segmentCount - 1);
      const segmentPrototype =
        cactusAssets.segments[
          Math.floor(
            hashString(`${seedKey}:segment-prototype:${i}:${segmentIndex}`) *
              cactusAssets.segments.length
          )
        ];
      const segment = segmentPrototype.clone(true);
      const segmentHeight =
        segmentPrototype.userData.localBounds.max.y -
        segmentPrototype.userData.localBounds.min.y;
      const thicknessScale =
        0.84 +
        hashString(`${seedKey}:segment-thickness:${i}:${segmentIndex}`) * 0.26 -
        growth * 0.08;
      const heightScale =
        0.86 +
        hashString(`${seedKey}:segment-height:${i}:${segmentIndex}`) * 0.24;
      const restX =
        Math.sin(growth * (1.4 + segmentCount * 0.08) + curvePhase) *
        curveStrength *
        (0.3 + growth * 1.1);
      const restZ =
        Math.cos(growth * (1.18 + segmentCount * 0.05) + curvePhase * 0.73) *
        curveStrength *
        (0.24 + growth * 0.96);

      segment.position.set(restX, currentY, restZ);
      segment.quaternion.setFromAxisAngle(
        UP_AXIS,
        hashString(`${seedKey}:segment-yaw:${i}:${segmentIndex}`) * TAU
      );
      segment.scale.set(thicknessScale, heightScale, thicknessScale);
      segment.userData.animation = {
        kind: 'moss-cactus-segment',
        basePosition: segment.position.clone(),
        baseQuaternion: segment.quaternion.clone(),
        baseScale: segment.scale.clone(),
        phase: stalkPhase,
        speed: stalkSpeed,
        secondarySpeed: stalkSecondarySpeed,
        pulseSpeed:
          0.72 +
          hashString(`${seedKey}:segment-pulse:${i}:${segmentIndex}`) * 0.16,
        waveOffset: growth * (1.2 + segmentCount * 0.09),
        heightRatio: growth,
        swayAmplitude:
          0.01 +
          hashString(`${seedKey}:segment-sway:${i}:${segmentIndex}`) * 0.02,
        bendAmplitude:
          0.018 +
          hashString(`${seedKey}:segment-bend:${i}:${segmentIndex}`) * 0.028,
        bulgeAmplitude:
          0.016 +
          hashString(`${seedKey}:segment-bulge:${i}:${segmentIndex}`) * 0.03,
      };

      currentY += segmentHeight * heightScale * (0.52 + growth * 0.08);
      stalk.add(segment);
    }

    stalk.userData.animation.sampleHeight = currentY * 0.58;

    group.add(stalk);
  }

  group.userData.animation = {
    kind: 'moss-cactus-patch',
  };
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(group);
  bounds.expandByScalar(3.5);
  group.userData.requiredChunks = buildChunkCoverage(bounds, worldChunkSize);
  group.userData.detailKind = 'moss-cactus-patch';
  group.userData.isDestructibleDetailProp = true;
  group.userData.hitSphere = bounds.getBoundingSphere(new THREE.Sphere());
  group.userData.support = {
    mode: 'floor',
    baseVoxel: {
      x: Math.round(position.x),
      y: Math.round(position.y - 1),
      z: Math.round(position.z),
    },
  };

  return group;
}

function createRockPatch(
  name,
  rockAssets,
  worldChunkSize,
  position,
  rotation,
  scale,
  seedKey,
  support = null
) {
  const group = new THREE.Group();
  const prototype =
    rockAssets[
      Math.floor(hashString(`${seedKey}:prototype`) * rockAssets.length)
    ];
  const rock = prototype.clone(true);
  const tiltX = -0.08 + hashString(`${seedKey}:tilt-x`) * 0.16;
  const tiltZ = -0.08 + hashString(`${seedKey}:tilt-z`) * 0.16;

  group.name = name;
  group.position.copy(position);
  if (rotation) {
    group.quaternion.copy(rotation);
  }
  setObjectScale(group, scale);
  rock.rotateX(tiltX);
  rock.rotateZ(tiltZ);
  group.add(rock);
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(group);
  bounds.expandByScalar(2.5);
  group.userData.requiredChunks = buildChunkCoverage(bounds, worldChunkSize);
  group.userData.detailKind = 'rock-patch';
  group.userData.isDestructibleDetailProp = true;
  group.userData.hitSphere = bounds.getBoundingSphere(new THREE.Sphere());
  group.userData.support = support;

  return group;
}

function createLandingPadPatch(
  name,
  landingPadAssets,
  worldChunkSize,
  position,
  rotation,
  scale,
  seedKey,
  support = null
) {
  const group = new THREE.Group();
  const prototype =
    landingPadAssets[
      Math.floor(hashString(`${seedKey}:prototype`) * landingPadAssets.length)
    ];
  const pad = prototype.clone(true);

  group.name = name;
  group.position.copy(position);
  if (rotation) {
    group.quaternion.copy(rotation);
  }
  setObjectScale(group, scale);
  group.add(pad);
  group.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  bounds.expandByScalar(2.5);
  group.userData.requiredChunks = buildChunkCoverage(bounds, worldChunkSize);
  group.userData.detailKind = 'landing-pad';
  group.userData.isLandingPad = true;
  group.userData.hitSphere = bounds.getBoundingSphere(new THREE.Sphere());
  group.userData.support = support;
  group.userData.landingPad = {
    captureRadius: Math.max(size.x, size.z) * 0.62,
    healRadius: LANDING_PAD_HEAL_RADIUS,
    deckHeight: size.y * 0.84,
    magnetRadius: LANDING_PAD_MAGNET_RADIUS,
    normal: new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion),
  };

  return group;
}

function buildChunkCoverage(bounds, worldChunkSize) {
  const chunkKeys = new Set();
  const epsilon = 0.001;
  const minChunkX = Math.floor(bounds.min.x / worldChunkSize);
  const minChunkY = Math.floor(bounds.min.y / worldChunkSize);
  const minChunkZ = Math.floor(bounds.min.z / worldChunkSize);
  const maxChunkX = Math.floor((bounds.max.x - epsilon) / worldChunkSize);
  const maxChunkY = Math.floor((bounds.max.y - epsilon) / worldChunkSize);
  const maxChunkZ = Math.floor((bounds.max.z - epsilon) / worldChunkSize);

  for (let z = minChunkZ; z <= maxChunkZ; z++) {
    for (let y = minChunkY; y <= maxChunkY; y++) {
      for (let x = minChunkX; x <= maxChunkX; x++) {
        chunkKeys.add(chunkKey(x, y, z));
      }
    }
  }

  return chunkKeys;
}

function hashString(value) {
  let hash = 2166136261;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function getChamberFloorPoint(chamber, angle, radial) {
  const normalizedX = Math.cos(angle) * radial;
  const normalizedZ = Math.sin(angle) * radial;
  const normalizedY = -Math.sqrt(
    Math.max(0, 1 - normalizedX * normalizedX - normalizedZ * normalizedZ)
  );

  return new THREE.Vector3(
    chamber.center.x + normalizedX * chamber.radius.x,
    chamber.center.y + normalizedY * chamber.radius.y,
    chamber.center.z + normalizedZ * chamber.radius.z
  );
}

function getChamberCeilingPoint(chamber, angle, radial) {
  const normalizedX = Math.cos(angle) * radial;
  const normalizedZ = Math.sin(angle) * radial;
  const normalizedY = Math.sqrt(
    Math.max(0, 1 - normalizedX * normalizedX - normalizedZ * normalizedZ)
  );

  return new THREE.Vector3(
    chamber.center.x + normalizedX * chamber.radius.x,
    chamber.center.y + normalizedY * chamber.radius.y,
    chamber.center.z + normalizedZ * chamber.radius.z
  );
}

function isSolidVoxel(terrainGenerator, x, y, z) {
  return terrainGenerator.generateVoxel(Math.round(x), y, Math.round(z)) !== 0;
}

function snapToFloor(terrainGenerator, chamber, position) {
  const snapped = position.clone();
  const startY = Math.floor(chamber.center.y);
  const minY = Math.floor(chamber.center.y - chamber.radius.y - 10);

  for (let y = startY; y >= minY; y--) {
    if (
      isSolidVoxel(terrainGenerator, position.x, y, position.z) &&
      !isSolidVoxel(terrainGenerator, position.x, y + 1, position.z)
    ) {
      snapped.y = y + 1;
      return snapped;
    }
  }

  snapped.y = chamber.center.y - chamber.radius.y * 0.55;

  return snapped;
}

function snapToCeiling(terrainGenerator, chamber, position) {
  const startY = Math.max(
    Math.floor(position.y),
    Math.floor(chamber.center.y + chamber.radius.y * 0.15)
  );
  const maxY = Math.ceil(chamber.center.y + chamber.radius.y + 12);

  for (let y = startY; y <= maxY; y++) {
    if (
      isSolidVoxel(terrainGenerator, position.x, y, position.z) &&
      !isSolidVoxel(terrainGenerator, position.x, y - 1, position.z)
    ) {
      return new THREE.Vector3(position.x, y, position.z);
    }
  }

  return null;
}

function countOpenHorizontalSamples(terrainGenerator, x, y, z, distance) {
  const sampleY = Math.floor(y);
  let openCount = 0;

  for (const [directionX, directionZ] of HORIZONTAL_SAMPLE_DIRECTIONS) {
    if (
      !isSolidVoxel(
        terrainGenerator,
        x + directionX * distance,
        sampleY,
        z + directionZ * distance
      )
    ) {
      openCount += 1;
    }
  }

  return openCount;
}

function findFloorYNear(terrainGenerator, x, referenceY, z, searchDistance) {
  const startY = Math.floor(referenceY) + searchDistance;
  const minY = Math.floor(referenceY) - searchDistance;

  for (let y = startY; y >= minY; y--) {
    if (
      isSolidVoxel(terrainGenerator, x, y, z) &&
      !isSolidVoxel(terrainGenerator, x, y + 1, z)
    ) {
      return y + 1;
    }
  }

  return null;
}

function getAngularDistance(firstAngle, secondAngle) {
  const delta = Math.abs(firstAngle - secondAngle) % TAU;

  return delta > Math.PI ? TAU - delta : delta;
}

function getClosestConnectionAngleDelta(connections, angle) {
  if (!connections || connections.length === 0) {
    return Math.PI;
  }

  let closestDelta = Math.PI;

  for (const connection of connections) {
    closestDelta = Math.min(
      closestDelta,
      getAngularDistance(angle, connection.angle)
    );
  }

  return closestDelta;
}

function chooseScatteredPlacements(candidates, defaultSpacing) {
  const accepted = [];

  const sortedCandidates = candidates.slice().sort(function (first, second) {
    return second.score - first.score;
  });

  for (const candidate of sortedCandidates) {
    const candidateSpacing = candidate.spacing || defaultSpacing;
    let overlapsAcceptedPlacement = false;

    for (const acceptedPlacement of accepted) {
      const requiredSpacing = Math.min(
        candidateSpacing,
        acceptedPlacement.spacing || defaultSpacing
      );

      if (
        candidate.position.distanceToSquared(acceptedPlacement.position) <
        requiredSpacing * requiredSpacing
      ) {
        overlapsAcceptedPlacement = true;
        break;
      }
    }

    if (!overlapsAcceptedPlacement) {
      accepted.push(candidate);
    }
  }

  return accepted;
}

function evaluateMossVinePlacement(
  terrainGenerator,
  chamber,
  position,
  placement
) {
  const lipOpenCount = countOpenHorizontalSamples(
    terrainGenerator,
    position.x,
    position.y - 1,
    position.z,
    2
  );
  const cavernOpenCount = countOpenHorizontalSamples(
    terrainGenerator,
    position.x,
    position.y - 2,
    position.z,
    4
  );
  const heightRatio = clamp(
    (position.y - chamber.center.y) / Math.max(1, chamber.radius.y),
    0,
    1
  );

  return (
    lipOpenCount * 1.4 +
    cavernOpenCount * 0.7 +
    heightRatio * 3.2 +
    (placement.tunnelBias || 0) +
    (placement.edgeBias || 0)
  );
}

function evaluateMossCactusPlacement(
  terrainGenerator,
  connections,
  position,
  placement
) {
  let flatSampleCount = 0;
  let spaciousSampleCount = 0;

  for (const [offsetX, offsetZ] of GROUND_AREA_SAMPLE_OFFSETS) {
    const sampleFloorY = findFloorYNear(
      terrainGenerator,
      position.x + offsetX,
      position.y,
      position.z + offsetZ,
      3
    );

    if (sampleFloorY === null) {
      continue;
    }

    const heightDelta = Math.abs(sampleFloorY - position.y);

    if (heightDelta <= 1.25) {
      flatSampleCount += 1;
    }

    if (
      heightDelta <= 1.75 &&
      !isSolidVoxel(
        terrainGenerator,
        position.x + offsetX,
        sampleFloorY + 2,
        position.z + offsetZ
      ) &&
      !isSolidVoxel(
        terrainGenerator,
        position.x + offsetX,
        sampleFloorY + 4,
        position.z + offsetZ
      )
    ) {
      spaciousSampleCount += 1;
    }
  }

  const localOpenCount = countOpenHorizontalSamples(
    terrainGenerator,
    position.x,
    position.y + 1,
    position.z,
    3
  );
  const tunnelClearance = getClosestConnectionAngleDelta(
    connections,
    placement.angle
  );
  const tunnelPenalty =
    clamp((0.36 - tunnelClearance) / 0.36, 0, 1) *
    (placement.radial > 0.34 ? 2.4 : 0.9);

  return (
    flatSampleCount * 1.35 +
    spaciousSampleCount * 0.9 +
    localOpenCount * 0.3 +
    (placement.areaBias || 0) -
    tunnelPenalty
  );
}

function evaluateRockPlacement(
  terrainGenerator,
  chamber,
  connections,
  position,
  placement
) {
  let flatSampleCount = 0;
  let supportedSampleCount = 0;

  for (const [offsetX, offsetZ] of GROUND_AREA_SAMPLE_OFFSETS) {
    const sampleFloorY = findFloorYNear(
      terrainGenerator,
      position.x + offsetX,
      position.y,
      position.z + offsetZ,
      3
    );

    if (sampleFloorY === null) {
      continue;
    }

    const heightDelta = Math.abs(sampleFloorY - position.y);

    if (heightDelta <= 1.1) {
      flatSampleCount += 1;
    }

    if (
      heightDelta <= 1.6 &&
      isSolidVoxel(
        terrainGenerator,
        position.x + offsetX,
        sampleFloorY - 1,
        position.z + offsetZ
      )
    ) {
      supportedSampleCount += 1;
    }
  }

  const lowerBias = clamp(
    (chamber.center.y - position.y) / Math.max(1, chamber.radius.y),
    0,
    1
  );
  const localWallSupport =
    countOpenHorizontalSamples(
      terrainGenerator,
      position.x,
      position.y,
      position.z,
      2
    ) <= 5
      ? 1
      : 0;
  const tunnelClearance = getClosestConnectionAngleDelta(
    connections,
    placement.angle
  );
  const tunnelPenalty = clamp((0.34 - tunnelClearance) / 0.34, 0, 1) * 3.2;
  const wallPenalty =
    placement.kind === 'wall' && placement.size > 0.72 ? 4.5 : 0;

  return (
    flatSampleCount * 1.45 +
    supportedSampleCount * 0.85 +
    lowerBias * 4.2 +
    localWallSupport * (placement.kind === 'wall' ? 1.6 : 0.35) +
    (placement.kind === 'wall'
      ? placement.wallBias || 0
      : placement.floorBias || 0) -
    tunnelPenalty -
    wallPenalty
  );
}

function evaluateLandingPadPlacement(
  terrainGenerator,
  connections,
  position,
  placement
) {
  let flatSampleCount = 0;
  let supportedSampleCount = 0;
  let openAboveCount = 0;

  for (const [offsetX, offsetZ] of GROUND_AREA_SAMPLE_OFFSETS) {
    const sampleFloorY = findFloorYNear(
      terrainGenerator,
      position.x + offsetX,
      position.y,
      position.z + offsetZ,
      2
    );

    if (sampleFloorY === null) {
      continue;
    }

    const heightDelta = Math.abs(sampleFloorY - position.y);

    if (heightDelta <= 0.7) {
      flatSampleCount += 1;
    }

    if (
      heightDelta <= 1 &&
      isSolidVoxel(
        terrainGenerator,
        position.x + offsetX,
        sampleFloorY - 1,
        position.z + offsetZ
      )
    ) {
      supportedSampleCount += 1;
    }

    if (
      heightDelta <= 0.9 &&
      !isSolidVoxel(
        terrainGenerator,
        position.x + offsetX,
        sampleFloorY + 4,
        position.z + offsetZ
      )
    ) {
      openAboveCount += 1;
    }
  }

  const localOpenCount = countOpenHorizontalSamples(
    terrainGenerator,
    position.x,
    position.y + 1,
    position.z,
    4
  );
  const tunnelClearance = getClosestConnectionAngleDelta(
    connections,
    placement.angle
  );
  const tunnelPenalty = clamp((0.4 - tunnelClearance) / 0.4, 0, 1) * 4.5;

  return (
    flatSampleCount * 1.8 +
    supportedSampleCount * 1.15 +
    openAboveCount * 0.95 +
    localOpenCount * 0.45 -
    tunnelPenalty +
    (placement.areaBias || 0)
  );
}

function snapToSupportedWall(terrainGenerator, chamber, position) {
  const startY = Math.floor(position.y);
  const minY = Math.floor(chamber.center.y - chamber.radius.y * 0.48);
  const maxY = Math.ceil(chamber.center.y + chamber.radius.y * 0.05);

  for (let y = startY; y >= minY; y--) {
    if (
      isSolidVoxel(terrainGenerator, position.x, y, position.z) &&
      !isSolidVoxel(terrainGenerator, position.x, y + 1, position.z) &&
      (isSolidVoxel(terrainGenerator, position.x + 1, y, position.z) ||
        isSolidVoxel(terrainGenerator, position.x - 1, y, position.z) ||
        isSolidVoxel(terrainGenerator, position.x, y, position.z + 1) ||
        isSolidVoxel(terrainGenerator, position.x, y, position.z - 1))
    ) {
      return new THREE.Vector3(position.x, y + 1, position.z);
    }
  }

  for (let y = startY + 1; y <= maxY; y++) {
    if (
      isSolidVoxel(terrainGenerator, position.x, y, position.z) &&
      !isSolidVoxel(terrainGenerator, position.x, y + 1, position.z) &&
      (isSolidVoxel(terrainGenerator, position.x + 1, y, position.z) ||
        isSolidVoxel(terrainGenerator, position.x - 1, y, position.z) ||
        isSolidVoxel(terrainGenerator, position.x, y, position.z + 1) ||
        isSolidVoxel(terrainGenerator, position.x, y, position.z - 1))
    ) {
      return new THREE.Vector3(position.x, y + 1, position.z);
    }
  }

  return null;
}

function buildChamberConnectionMap(graph) {
  const chamberById = new Map(
    graph.chambers.map(function (chamber) {
      return [chamber.id, chamber];
    })
  );
  const connections = new Map();

  function addConnection(fromId, toId, tunnel) {
    const fromChamber = chamberById.get(fromId);
    const toChamber = chamberById.get(toId);

    if (!fromChamber || !toChamber) {
      return;
    }

    if (!connections.has(fromId)) {
      connections.set(fromId, []);
    }

    connections.get(fromId).push({
      angle: Math.atan2(
        toChamber.center.z - fromChamber.center.z,
        toChamber.center.x - fromChamber.center.x
      ),
      isMainRoute: Boolean(tunnel.isMainRoute),
      radius: tunnel.radius,
      otherChamberId: toId,
      verticalDelta: toChamber.center.y - fromChamber.center.y,
    });
  }

  for (const tunnel of graph.tunnels) {
    addConnection(tunnel.from, tunnel.to, tunnel);
    addConnection(tunnel.to, tunnel.from, tunnel);
  }

  return connections;
}

function getChamberSizeFactor(chamber) {
  return clamp((Math.min(chamber.radius.x, chamber.radius.z) - 20) / 16, 0, 1);
}

function addBuiltInMossVines(
  terrainGenerator,
  group,
  graph,
  vineAssets,
  worldChunkSize,
  activeBiomeId
) {
  if (activeBiomeId !== 'moss') {
    return;
  }

  const eligibleChambers = graph.chambers.filter(function (chamber) {
    return chamber.biomeId === activeBiomeId;
  });
  const connectionsByChamber = buildChamberConnectionMap(graph);
  const decorationSeedRoot = getDecorationSeedRoot(terrainGenerator);

  for (const chamber of eligibleChambers) {
    const baseScale = clamp(
      Math.min(chamber.radius.x, chamber.radius.z) / 26,
      1.35,
      2.25
    );
    const connections = connectionsByChamber.get(chamber.id) || [];
    const placements = [];
    const candidatePlacements = [];

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      const entranceOffsets = connection.isMainRoute
        ? [-0.26, -0.14, 0, 0.14, 0.26]
        : [-0.16, 0.16];
      const radialBase =
        0.78 +
        clamp(
          connection.verticalDelta / Math.max(1, chamber.radius.y),
          -0.05,
          0.06
        );

      for (let j = 0; j < entranceOffsets.length; j++) {
        const sideOffset =
          entranceOffsets[j] +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:vine-tunnel-side:${i}:${j}`
          ) -
            0.5) *
            0.08;

        placements.push({
          angle: connection.angle + sideOffset,
          radial:
            radialBase +
            getDecorHash(
              decorationSeedRoot,
              `${chamber.id}:vine-tunnel-radial:${i}:${j}`
            ) *
              0.12,
          scaleX: 0.94,
          scaleY: 0.96,
          scaleZ: 0.94,
          scaleBoost: 1.08 + (connection.isMainRoute ? 0.2 : 0.08),
          tunnelBias: connection.isMainRoute ? 3.2 : 2.2,
          edgeBias: 0.85,
          seedKey: getDecorSeedKey(
            decorationSeedRoot,
            `${chamber.id}:vine-tunnel:${i}:${j}`
          ),
        });
      }

      if (connection.isMainRoute) {
        placements.push({
          angle:
            connection.angle +
            (getDecorHash(
              decorationSeedRoot,
              `${chamber.id}:vine-tunnel-crown-angle:${i}`
            ) -
              0.5) *
              0.18,
          radial:
            0.88 +
            getDecorHash(
              decorationSeedRoot,
              `${chamber.id}:vine-tunnel-crown-radial:${i}`
            ) *
              0.08,
          scaleX: 0.98,
          scaleY: 1.02,
          scaleZ: 0.98,
          scaleBoost: 1.18,
          tunnelBias: 3.8,
          edgeBias: 1.15,
          seedKey: getDecorSeedKey(
            decorationSeedRoot,
            `${chamber.id}:vine-tunnel-crown:${i}`
          ),
        });
      }
    }

    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      const position = snapToCeiling(
        terrainGenerator,
        chamber,
        getChamberCeilingPoint(chamber, placement.angle, placement.radial)
      );

      if (!position) {
        continue;
      }

      const score = evaluateMossVinePlacement(
        terrainGenerator,
        chamber,
        position,
        placement
      );

      if (score < 5.8) {
        continue;
      }

      candidatePlacements.push({
        ...placement,
        position,
        score,
        heightScale:
          0.64 + hashString(`${placement.seedKey}:height-scale`) * 0.23,
        spacing: baseScale * 3.15,
      });
    }

    const acceptedPlacements = chooseScatteredPlacements(
      candidatePlacements,
      baseScale * 3.5
    );

    for (let i = 0; i < acceptedPlacements.length; i++) {
      const placement = acceptedPlacements[i];

      const scale = {
        x: baseScale * placement.scaleX * placement.scaleBoost,
        y:
          baseScale *
          placement.scaleY *
          placement.scaleBoost *
          placement.heightScale,
        z: baseScale * placement.scaleZ * placement.scaleBoost,
      };
      const vine = createMossVinePatch(
        `detail-moss-vine-${chamber.id}-${i}`,
        vineAssets,
        worldChunkSize,
        placement.position,
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          hashString(`${placement.seedKey}:rotation`) * TAU
        ),
        scale,
        placement.seedKey
      );

      group.add(vine);
    }
  }
}

function addBuiltInMossCacti(
  terrainGenerator,
  group,
  graph,
  cactusAssets,
  worldChunkSize,
  activeBiomeId
) {
  if (activeBiomeId !== 'moss') {
    return;
  }

  const eligibleChambers = graph.chambers.filter(function (chamber) {
    return chamber.biomeId === activeBiomeId;
  });
  const connectionsByChamber = buildChamberConnectionMap(graph);
  const decorationSeedRoot = getDecorationSeedRoot(terrainGenerator);

  for (const chamber of eligibleChambers) {
    const sizeFactor = getChamberSizeFactor(chamber);
    const centralAreaCount =
      (chamber.id === 'spawn' ? 3 : 4) +
      Math.floor(sizeFactor * 3) +
      Math.floor(
        getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-central-count`) *
          3
      );
    const midAreaCount =
      4 +
      Math.floor(sizeFactor * 3) +
      Math.floor(
        getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-mid-count`) * 3
      );
    const outerAreaCount =
      1 +
      Math.floor(sizeFactor * 2) +
      Math.floor(
        getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-outer-count`) * 2
      );
    const connections = connectionsByChamber.get(chamber.id) || [];
    const placements = [];
    const candidatePlacements = [];
    const innerBaseAngle =
      getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-inner-base`) * TAU;
    const midBaseAngle =
      getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-mid-base`) * TAU;
    const outerBaseAngle =
      getDecorHash(decorationSeedRoot, `${chamber.id}:cactus-outer-base`) * TAU;

    for (let i = 0; i < centralAreaCount; i++) {
      placements.push({
        angle:
          innerBaseAngle +
          (i / centralAreaCount) * TAU +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-central-jitter:${i}`
          ) -
            0.5) *
            0.52,
        radial:
          0.1 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-central-radial:${i}`
          ) *
            0.14,
        widthScale: 0.98,
        heightScale: 1.0,
        areaBias: 1.35,
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:cactus-central:${i}`
        ),
      });
    }

    for (let i = 0; i < midAreaCount; i++) {
      placements.push({
        angle:
          midBaseAngle +
          (i / midAreaCount) * TAU +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-mid-jitter:${i}`
          ) -
            0.5) *
            0.42,
        radial:
          0.22 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-mid-radial:${i}`
          ) *
            0.16,
        widthScale: 1.0,
        heightScale: 1.08,
        areaBias: 1.55,
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:cactus-mid:${i}`
        ),
      });
    }

    for (let i = 0; i < outerAreaCount; i++) {
      placements.push({
        angle:
          outerBaseAngle +
          (i / outerAreaCount) * TAU +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-outer-jitter:${i}`
          ) -
            0.5) *
            0.38,
        radial:
          0.38 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-outer-radial:${i}`
          ) *
            0.14,
        widthScale: 1.0,
        heightScale: 1.08,
        areaBias: 0.1,
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:cactus-outer:${i}`
        ),
      });
    }

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      const shouldPlaceEntranceCluster =
        connection.isMainRoute ||
        getDecorHash(
          decorationSeedRoot,
          `${chamber.id}:cactus-tunnel-enabled:${i}`
        ) > 0.7;

      if (!shouldPlaceEntranceCluster) {
        continue;
      }

      placements.push({
        angle:
          connection.angle +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-tunnel-angle:${i}`
          ) -
            0.5) *
            0.28,
        radial:
          0.24 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:cactus-tunnel-radial:${i}`
          ) *
            0.1,
        widthScale: 1.02,
        heightScale: 1.14,
        areaBias: -0.2,
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:cactus-tunnel:${i}`
        ),
      });
    }

    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i];
      const position = snapToFloor(
        terrainGenerator,
        chamber,
        getChamberFloorPoint(chamber, placement.angle, placement.radial)
      );

      if (!position) {
        continue;
      }

      const score = evaluateMossCactusPlacement(
        terrainGenerator,
        connections,
        position,
        placement
      );

      if (score < 12.4) {
        continue;
      }

      const baseScale = clamp(
        Math.min(chamber.radius.x, chamber.radius.z) / 34,
        1.0,
        1.55
      );
      const widthScale =
        baseScale *
        placement.widthScale *
        (0.9 + hashString(`${placement.seedKey}:width`) * 0.16);
      const heightScale =
        baseScale *
        placement.heightScale *
        (0.82 + hashString(`${placement.seedKey}:height`) * 0.52);
      candidatePlacements.push({
        ...placement,
        position,
        score,
        spacing: baseScale * 3.05,
        scale: {
          x: widthScale,
          y: heightScale,
          z: widthScale,
        },
      });
    }

    const acceptedPlacements = chooseScatteredPlacements(
      candidatePlacements,
      5.2
    );

    for (let i = 0; i < acceptedPlacements.length; i++) {
      const placement = acceptedPlacements[i];
      const cactus = createMossCactusPatch(
        `detail-moss-cactus-${chamber.id}-${i}`,
        cactusAssets,
        worldChunkSize,
        placement.position,
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          hashString(`${placement.seedKey}:rotation`) * TAU
        ),
        placement.scale,
        placement.seedKey
      );

      group.add(cactus);
    }
  }
}

function addBuiltInRocks(
  terrainGenerator,
  group,
  graph,
  rockAssets,
  worldChunkSize,
  activeBiomeId
) {
  if (activeBiomeId !== 'moss') {
    return;
  }

  const eligibleChambers = graph.chambers.filter(function (chamber) {
    return chamber.biomeId === activeBiomeId;
  });
  const connectionsByChamber = buildChamberConnectionMap(graph);
  const decorationSeedRoot = getDecorationSeedRoot(terrainGenerator);

  for (const chamber of eligibleChambers) {
    const sizeFactor = getChamberSizeFactor(chamber);
    const floorCandidateCount =
      6 +
      Math.floor(sizeFactor * 6) +
      Math.floor(
        getDecorHash(decorationSeedRoot, `${chamber.id}:rock-floor-count`) * 5
      );
    const wallCandidateCount =
      1 +
      Math.floor(sizeFactor * 2) +
      Math.floor(
        getDecorHash(decorationSeedRoot, `${chamber.id}:rock-wall-count`) * 2
      );
    const floorBaseAngle =
      getDecorHash(decorationSeedRoot, `${chamber.id}:rock-floor-base`) * TAU;
    const wallBaseAngle =
      getDecorHash(decorationSeedRoot, `${chamber.id}:rock-wall-base`) * TAU;
    const connections = connectionsByChamber.get(chamber.id) || [];
    const candidates = [];

    for (let i = 0; i < floorCandidateCount; i++) {
      candidates.push({
        kind: 'floor',
        angle:
          floorBaseAngle +
          (i / floorCandidateCount) * TAU +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-floor-jitter:${i}`
          ) -
            0.5) *
            0.46,
        radial:
          0.22 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-floor-radial:${i}`
          ) *
            0.48,
        floorBias: 1.2,
        size:
          0.48 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-floor-size:${i}`
          ) *
            (0.68 + sizeFactor * 0.38),
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:rock-floor:${i}`
        ),
      });
    }

    for (let i = 0; i < wallCandidateCount; i++) {
      candidates.push({
        kind: 'wall',
        angle:
          wallBaseAngle +
          (i / wallCandidateCount) * TAU +
          (getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-wall-jitter:${i}`
          ) -
            0.5) *
            0.34,
        radial:
          0.72 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-wall-radial:${i}`
          ) *
            0.14,
        wallBias: 0.9,
        size:
          0.44 +
          getDecorHash(
            decorationSeedRoot,
            `${chamber.id}:rock-wall-size:${i}`
          ) *
            0.24,
        seedKey: getDecorSeedKey(
          decorationSeedRoot,
          `${chamber.id}:rock-wall:${i}`
        ),
      });
    }

    const acceptedCandidates = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const samplePoint =
        candidate.kind === 'floor'
          ? getChamberFloorPoint(chamber, candidate.angle, candidate.radial)
          : getChamberFloorPoint(
              chamber,
              candidate.angle,
              clamp(candidate.radial, 0.68, 0.9)
            );
      const position =
        candidate.kind === 'floor'
          ? snapToFloor(terrainGenerator, chamber, samplePoint)
          : snapToSupportedWall(terrainGenerator, chamber, samplePoint);

      if (!position) {
        continue;
      }

      const heightRatio = clamp(
        (chamber.center.y - position.y) / Math.max(1, chamber.radius.y),
        0,
        1
      );

      if (candidate.kind === 'wall') {
        if (heightRatio < 0.22) {
          continue;
        }
      }

      if (candidate.kind === 'floor' && heightRatio < 0.2) {
        continue;
      }

      const score = evaluateRockPlacement(
        terrainGenerator,
        chamber,
        connections,
        position,
        candidate
      );

      if (score < (candidate.kind === 'wall' ? 10.4 : 12.2)) {
        continue;
      }

      const baseScale = clamp(
        Math.min(chamber.radius.x, chamber.radius.z) / 38,
        1.2,
        1.78
      );
      const sizeScale = baseScale * candidate.size;

      acceptedCandidates.push({
        ...candidate,
        position,
        score,
        spacing:
          (candidate.kind === 'wall' ? 3.4 : 5.1) +
          sizeScale * (candidate.kind === 'wall' ? 1.5 : 2.2),
        scale: {
          x:
            sizeScale *
            (0.92 + hashString(`${candidate.seedKey}:scale-x`) * 0.24),
          y:
            sizeScale *
            (0.78 + hashString(`${candidate.seedKey}:scale-y`) * 0.34),
          z:
            sizeScale *
            (0.92 + hashString(`${candidate.seedKey}:scale-z`) * 0.24),
        },
      });
    }

    const scatteredCandidates = chooseScatteredPlacements(
      acceptedCandidates,
      4.4
    );

    for (let i = 0; i < scatteredCandidates.length; i++) {
      const candidate = scatteredCandidates[i];
      const rotation = new THREE.Quaternion().setFromAxisAngle(
        UP_AXIS,
        hashString(`${candidate.seedKey}:rotation`) * TAU
      );
      const rock = createRockPatch(
        `detail-rock-${chamber.id}-${i}`,
        rockAssets,
        worldChunkSize,
        candidate.position,
        rotation,
        candidate.scale,
        candidate.seedKey,
        candidate.kind === 'wall'
          ? {
              mode: 'rock-wall',
              baseVoxel: {
                x: Math.round(candidate.position.x),
                y: Math.round(candidate.position.y - 1),
                z: Math.round(candidate.position.z),
              },
            }
          : {
              mode: 'rock-floor',
              baseVoxel: {
                x: Math.round(candidate.position.x),
                y: Math.round(candidate.position.y - 1),
                z: Math.round(candidate.position.z),
              },
            }
      );

      group.add(rock);
    }
  }
}

function addBuiltInLandingPads(
  terrainGenerator,
  group,
  graph,
  landingPadAssets,
  worldChunkSize,
  activeBiomeId
) {
  if (activeBiomeId !== 'moss') {
    return;
  }

  // Landing pad placement targets recognized chamber IDs.
  // Extend this list when adding new levels with landing-pad-capable chambers.
  const preferredChambers = [
    'hub',
    'gallery',
    'basin',
    'crossroads',
    'upperOverlook',
    'landingLedge',
  ];
  const eligibleChambers = graph.chambers.filter(function (chamber) {
    return (
      chamber.biomeId === activeBiomeId &&
      preferredChambers.includes(chamber.id)
    );
  });
  const connectionsByChamber = buildChamberConnectionMap(graph);

  for (const chamber of eligibleChambers) {
    const candidateCount = 6;
    const baseAngle = hashString(`${chamber.id}:landing-pad-base`) * TAU;
    const connections = connectionsByChamber.get(chamber.id) || [];
    const candidates = [];

    for (let i = 0; i < candidateCount; i++) {
      candidates.push({
        angle:
          baseAngle +
          (i / candidateCount) * TAU +
          (hashString(`${chamber.id}:landing-pad-jitter:${i}`) - 0.5) * 0.24,
        radial:
          0.12 + hashString(`${chamber.id}:landing-pad-radial:${i}`) * 0.16,
        areaBias: 0.8,
        seedKey: `${chamber.id}:landing-pad:${i}`,
      });
    }

    const acceptedCandidates = [];

    for (const candidate of candidates) {
      const position = snapToFloor(
        terrainGenerator,
        chamber,
        getChamberFloorPoint(chamber, candidate.angle, candidate.radial)
      );

      if (!position) {
        continue;
      }

      const score = evaluateLandingPadPlacement(
        terrainGenerator,
        connections,
        position,
        candidate
      );

      if (score < 23) {
        continue;
      }

      const baseScale = 10;

      acceptedCandidates.push({
        ...candidate,
        position,
        score,
        spacing: 999,
        scale: {
          x: baseScale,
          y: baseScale * 0.45,
          z: baseScale,
        },
      });
    }

    const scatteredCandidates = chooseScatteredPlacements(
      acceptedCandidates,
      999
    ).slice(0, 1);

    for (let i = 0; i < scatteredCandidates.length; i++) {
      const candidate = scatteredCandidates[i];
      const pad = createLandingPadPatch(
        `detail-landing-pad-${chamber.id}-${i}`,
        landingPadAssets,
        worldChunkSize,
        candidate.position,
        new THREE.Quaternion(),
        candidate.scale,
        candidate.seedKey,
        {
          mode: 'rock-floor',
          baseVoxel: {
            x: Math.round(candidate.position.x),
            y: Math.round(candidate.position.y - 1),
            z: Math.round(candidate.position.z),
          },
        }
      );

      group.add(pad);
    }
  }
}

function updateDetailPropVisibility(group, world) {
  if (!group || !world || !world.loadedChunks) {
    return;
  }

  for (const child of group.children) {
    if (child.userData && child.userData.removalAnimation) {
      child.visible = true;
      continue;
    }

    const requiredChunks = child.userData.requiredChunks;

    if (!requiredChunks || requiredChunks.size === 0) {
      child.visible = true;
      continue;
    }

    let isVisible = true;

    for (const requiredChunk of requiredChunks) {
      if (!world.loadedChunks.has(requiredChunk)) {
        isVisible = false;
        break;
      }
    }

    child.visible = isVisible;
  }
}

function updateLandingPadAnimation(patch, elapsedTimeSeconds) {
  if (!patch || !patch.userData || !patch.userData.isLandingPad) {
    return;
  }

  const glowMesh = patch.getObjectByName('detail-amberGlow');
  if (!glowMesh || !glowMesh.material) {
    return;
  }

  const material = glowMesh.material;
  const isActive = Boolean(
    patch.userData.landingPad && patch.userData.landingPad.landingActive
  );
  const pulsePhase = 0.5 + 0.5 * Math.sin(elapsedTimeSeconds * 3.2);
  const easedPulse = pulsePhase * pulsePhase * (3 - 2 * pulsePhase);
  const pulse = isActive ? 0.68 + 0.32 * easedPulse : 0.34;

  material.emissiveIntensity = isActive ? 2.1 + pulse * 1.5 : 1.45;
  material.opacity = isActive ? 0.42 + pulse * 0.16 : 0.34;
}

function updateMossVinePatchAnimation(patch, elapsedTimeSeconds, windSource) {
  let localWindX = 0;
  let localWindZ = 0;

  if (windSource) {
    patch.getWorldQuaternion(DETAIL_WORLD_QUATERNION);
    DETAIL_WORLD_QUATERNION_INVERSE.copy(DETAIL_WORLD_QUATERNION).invert();
    DETAIL_TEMP_DIRECTION.copy(windSource.direction).applyQuaternion(
      DETAIL_WORLD_QUATERNION_INVERSE
    );
    localWindX = DETAIL_TEMP_DIRECTION.x;
    localWindZ = DETAIL_TEMP_DIRECTION.z;
  }

  for (const strand of patch.children) {
    if (
      !strand.userData ||
      !strand.userData.animation ||
      strand.userData.animation.kind !== 'moss-vine-strand'
    ) {
      continue;
    }

    const animation = strand.userData.animation;
    const primaryWave = Math.sin(
      elapsedTimeSeconds * animation.speed + animation.phase
    );
    const secondaryWave = Math.sin(
      elapsedTimeSeconds * animation.secondarySpeed + animation.phase * 0.61
    );
    const tertiaryWave = Math.sin(
      elapsedTimeSeconds * (animation.secondarySpeed * 0.53) +
        animation.phase * 1.13
    );

    strand.position.copy(animation.basePosition);
    patch.localToWorld(DETAIL_TEMP_POSITION.copy(animation.basePosition));

    const wakeOffset = applyWakeToAnimation(
      animation,
      DETAIL_TEMP_POSITION,
      localWindX,
      localWindZ,
      windSource,
      VINE_WAKE_RADIUS,
      VINE_WAKE_VERTICAL_WEIGHT,
      VINE_WAKE_RESPONSE,
      VINE_WAKE_DECAY,
      VINE_WAKE_MAX
    );
    const gustWave = Math.sin(
      elapsedTimeSeconds * (animation.secondarySpeed * 1.35) +
        animation.windPhase +
        animation.phase * 0.4
    );
    const wakeWave = 0.45 + gustWave * 0.55;
    const wakeBendX = wakeOffset.x * wakeWave;
    const wakeBendZ = wakeOffset.y * wakeWave;

    strand.position.x += wakeBendX * 0.34;
    strand.position.z += wakeBendZ * 0.34;
    strand.quaternion.copy(animation.baseQuaternion);
    strand.rotateX(
      primaryWave * animation.swayXAmplitude +
        secondaryWave * animation.swayXAmplitude * 0.34 +
        wakeBendZ * -2.2
    );
    strand.rotateZ(
      secondaryWave * animation.swayZAmplitude +
        primaryWave * animation.swayZAmplitude * 0.22 -
        wakeBendX * -2.2
    );
    strand.rotateY(tertiaryWave * animation.twistAmplitude + wakeBendX * 0.34);
    strand.scale.copy(animation.baseScale);
    strand.scale.y *= 1 + tertiaryWave * animation.scaleAmplitude;
  }
}

function updateMossCactusPatchAnimation(patch, elapsedTimeSeconds, windSource) {
  for (const stalk of patch.children) {
    if (
      !stalk.userData ||
      stalk.userData.animation?.kind !== 'moss-cactus-stalk'
    ) {
      continue;
    }

    const stalkAnimation = stalk.userData.animation;

    stalk.quaternion.copy(stalkAnimation.baseQuaternion);

    let localWindX = 0;
    let localWindZ = 0;

    if (windSource) {
      patch.getWorldQuaternion(DETAIL_WORLD_QUATERNION);
      DETAIL_WORLD_QUATERNION.multiply(stalkAnimation.baseQuaternion);
      DETAIL_WORLD_QUATERNION_INVERSE.copy(DETAIL_WORLD_QUATERNION).invert();
      DETAIL_TEMP_DIRECTION.copy(windSource.direction).applyQuaternion(
        DETAIL_WORLD_QUATERNION_INVERSE
      );
      localWindX = DETAIL_TEMP_DIRECTION.x;
      localWindZ = DETAIL_TEMP_DIRECTION.z;
    }

    DETAIL_TEMP_POSITION.set(0, stalkAnimation.sampleHeight, 0);
    DETAIL_TEMP_POSITION.applyQuaternion(stalkAnimation.baseQuaternion);
    DETAIL_TEMP_POSITION.add(stalk.position);
    patch.localToWorld(DETAIL_TEMP_POSITION);

    const stalkWakeOffset = applyWakeToAnimation(
      stalkAnimation,
      DETAIL_TEMP_POSITION,
      localWindX,
      localWindZ,
      windSource,
      CACTUS_WAKE_RADIUS,
      CACTUS_WAKE_VERTICAL_WEIGHT,
      CACTUS_WAKE_RESPONSE,
      CACTUS_WAKE_DECAY,
      CACTUS_WAKE_MAX
    );
    const stalkGustWave = Math.sin(
      elapsedTimeSeconds * 2.05 +
        stalkAnimation.windPhase +
        stalkWakeOffset.length() * 7
    );
    const stalkWakeWave = 0.52 + stalkGustWave * 0.48;
    const dynamicStalkWakeX = stalkWakeOffset.x * stalkWakeWave;
    const dynamicStalkWakeZ = stalkWakeOffset.y * stalkWakeWave;

    stalk.rotateX(dynamicStalkWakeZ * -0.95);
    stalk.rotateZ(dynamicStalkWakeX * -0.95);

    for (const segment of stalk.children) {
      if (
        !segment.userData ||
        !segment.userData.animation ||
        segment.userData.animation.kind !== 'moss-cactus-segment'
      ) {
        continue;
      }

      const animation = segment.userData.animation;
      const waveX = Math.sin(
        elapsedTimeSeconds * animation.speed +
          animation.phase +
          animation.waveOffset
      );
      const waveZ = Math.sin(
        elapsedTimeSeconds * animation.secondarySpeed +
          animation.phase * 0.72 +
          animation.waveOffset * 1.24
      );
      const pulse = Math.sin(
        elapsedTimeSeconds * animation.pulseSpeed +
          animation.phase * 0.48 +
          animation.waveOffset * 1.6
      );
      const gustRipple = Math.sin(
        elapsedTimeSeconds * 2.4 +
          animation.waveOffset * 1.8 +
          stalkAnimation.windPhase
      );
      const swayStrength = (0.18 + animation.heightRatio * 0.92) * 1.75;
      const bulge = 1 + pulse * animation.bulgeAmplitude;
      const wakeStrength =
        (0.08 + animation.heightRatio * 0.28) * (0.85 + gustRipple * 0.15);

      segment.position.copy(animation.basePosition);

      segment.position.x +=
        waveX * animation.swayAmplitude * swayStrength +
        dynamicStalkWakeX * wakeStrength;
      segment.position.z +=
        waveZ * animation.swayAmplitude * swayStrength +
        dynamicStalkWakeZ * wakeStrength;
      segment.quaternion.copy(animation.baseQuaternion);
      segment.rotateX(
        waveZ * animation.bendAmplitude * swayStrength +
          dynamicStalkWakeZ * wakeStrength * -0.55
      );
      segment.rotateZ(
        -waveX * animation.bendAmplitude * swayStrength -
          dynamicStalkWakeX * wakeStrength * 0.55
      );
      segment.scale.copy(animation.baseScale);
      segment.scale.x *= bulge;
      segment.scale.z *= bulge;
      segment.scale.y *= 1 - pulse * animation.bulgeAmplitude * 0.16;
    }
  }
}

export async function createDetailProps(terrainGenerator, world) {
  const group = new THREE.Group();
  const runtime = getDetailRuntime(world);

  group.name = 'detail-props';
  group.userData.updateVisibility = function () {
    updateDetailPropVisibility(group, world);
  };
  group.userData.updateDestructionEffects = function () {
    updateDetailDestructionEffects(world);
  };
  group.userData.pruneUnsupported = function (chunkKeys = null) {
    return pruneUnsupportedDetailProps(world, chunkKeys);
  };

  if (!terrainGenerator || !terrainGenerator.graph || !world) {
    return group;
  }

  const materials = createMaterials();
  const builtInMossVineAssets = createBuiltInMossVineAssets(materials);
  const builtInMossCactusAssets = createBuiltInMossCactusAssets(materials);
  const builtInRockAssets = createBuiltInRockAssets(materials);
  const builtInLandingPadAssets = createBuiltInLandingPadAssets(materials);
  const worldChunkSize = world.chunkSize * world.voxelSize;
  const activeBiomeId = terrainGenerator.config
    ? terrainGenerator.config.activeBiomeId || 'moss'
    : 'moss';

  addBuiltInMossVines(
    terrainGenerator,
    group,
    terrainGenerator.graph,
    builtInMossVineAssets,
    worldChunkSize,
    activeBiomeId
  );

  addBuiltInMossCacti(
    terrainGenerator,
    group,
    terrainGenerator.graph,
    builtInMossCactusAssets,
    worldChunkSize,
    activeBiomeId
  );

  addBuiltInRocks(
    terrainGenerator,
    group,
    terrainGenerator.graph,
    builtInRockAssets,
    worldChunkSize,
    activeBiomeId
  );

  addBuiltInLandingPads(
    terrainGenerator,
    group,
    terrainGenerator.graph,
    builtInLandingPadAssets,
    worldChunkSize,
    activeBiomeId
  );

  for (const child of group.children) {
    registerPatchWithRuntime(world, child);
  }

  world.destroyDetailPropsNearPoint = function (
    point,
    radius,
    filterFn = null
  ) {
    return destroyDetailPropsNearPoint(world, point, radius, filterFn);
  };
  world.destroyDetailPropsAlongSegment = function (
    start,
    end,
    radius,
    filterFn = null
  ) {
    return destroyDetailPropsAlongSegment(world, start, end, radius, filterFn);
  };
  world.pruneUnsupportedDetailProps = function (chunkKeys = null) {
    return pruneUnsupportedDetailProps(world, chunkKeys);
  };
  world.updateDetailDestructionEffects = function () {
    updateDetailDestructionEffects(world);
  };
  world.getLandingPadsNearPoint = function (point, radius) {
    const runtime = getDetailRuntime(world);

    if (!runtime || !point || radius <= 0) {
      return [];
    }

    const pads = [];
    const radiusSq = radius * radius;

    for (const patch of runtime.landingPads) {
      if (!patch || !patch.parent || patch.userData.isDestroyedDetailProp) {
        continue;
      }

      if (patch.position.distanceToSquared(point) > radiusSq) {
        continue;
      }

      pads.push(patch);
    }

    return pads;
  };

  if (runtime) {
    runtime.rootGroup = group;
  }

  updateDetailPropVisibility(group, world);

  return group;
}

export function refreshDetailPropsVisibility(group, world) {
  updateDetailPropVisibility(group, world);
  updateDetailDestructionEffects(world);
}

export function updateDetailPropsAnimation(
  group,
  elapsedTimeSeconds,
  windSource = null
) {
  if (!group) {
    return;
  }

  for (const child of group.children) {
    if (!child.visible) {
      continue;
    }

    if (child.userData && child.userData.removalAnimation) {
      updateRemovingDetailPatch(child);
      continue;
    }

    if (child.userData && child.userData.isLandingPad) {
      updateLandingPadAnimation(child, elapsedTimeSeconds);
    }

    if (
      !child.userData ||
      !child.userData.animation ||
      !child.userData.animation.kind
    ) {
      continue;
    }

    if (child.userData.animation.kind === 'moss-vine-patch') {
      updateMossVinePatchAnimation(child, elapsedTimeSeconds, windSource);
      continue;
    }

    if (child.userData.animation.kind === 'moss-cactus-patch') {
      updateMossCactusPatchAnimation(child, elapsedTimeSeconds, windSource);
    }
  }
}
