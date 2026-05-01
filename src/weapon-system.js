import * as THREE from 'three';
import {
  canRunVoxelRaycast,
  raycastVoxelSegment,
} from './voxel-ray-traversal.js';
import {
  getRocketForwardVector,
  getRocketRightVector,
  getRocketUpVector,
} from './rocket-orientation.js';
import { ROCKET_WEAPON_MUZZLE_POINT } from './rocket-voxels.js';
import { getVoxel, setRuntimeVoxel, voxelToWorldCoord } from './voxel.js';
import { VOXEL_TYPES } from './voxel-types.js';
import { isVoxelDestructible } from './voxel-materials.js';
import { WORLD_UNITS_PER_VOXEL } from './world-units.js';
import { debugLog } from './debug.js';

const WEAPON_DAMAGE_SCALE = 0.2;

function scaleWeaponDamage(damage) {
  return damage * WEAPON_DAMAGE_SCALE;
}

const BULLET_SPEED = 5.2;
const BULLET_FRICTION = 0.992;
const BULLET_LIFETIME = 42;
const MAX_BULLET_TRAVEL_DISTANCE = 110;
const MISSILE_SPEED = 1.35;
const MISSILE_LIFETIME_MS = 2500;
const MISSILE_TURN_RATE = 0.75;
const MISSILE_DAMAGE = 35;
const MISSILE_EXPLOSION_RADIUS = 5;
const MISSILE_EXPLOSION_REACH = 10;
const MISSILE_PLAYER_BLAST_RADIUS = 22;
const MISSILE_PLAYER_BLAST_DAMAGE = scaleWeaponDamage(42);
const MISSILE_PLAYER_BLAST_FORCE = 2.8;
const MAX_ACTIVE_MISSILES = 8;
const MAX_ACTIVE_BULLETS = 40;
const MAX_ACTIVE_FLAME_JETS = 48;
const MAX_ACTIVE_FLAME_SMOKE = 64;
const MAX_ACTIVE_DUST_PARTICLES = 72;

const MAX_ACTIVE_PROJECTILES = 80;
const MAX_ACTIVE_AI_PROJECTILES = 40;
const MAX_VOXEL_EDITS_PER_FRAME = 64;
const MAX_TERRAIN_IMPACTS_PER_FRAME = 4;

let globalProjectileCount = 0;
let globalAiProjectileCount = 0;
let globalVoxelEditsThisFrame = 0;
let globalTerrainImpactsThisFrame = 0;

export function resetGlobalWeaponBudgets() {
  globalVoxelEditsThisFrame = 0;
  globalTerrainImpactsThisFrame = 0;
}

export function getGlobalWeaponStats() {
  return {
    globalProjectileCount,
    globalAiProjectileCount,
    globalVoxelEditsThisFrame,
    globalTerrainImpactsThisFrame,
  };
}

export function canSpawnProjectile(isAi) {
  if (globalProjectileCount >= MAX_ACTIVE_PROJECTILES) {
    return false;
  }
  if (isAi && globalAiProjectileCount >= MAX_ACTIVE_AI_PROJECTILES) {
    return false;
  }
  return true;
}

export function incrementProjectileCount(isAi) {
  globalProjectileCount++;
  if (isAi) {
    globalAiProjectileCount++;
  }
}

export function decrementProjectileCount(isAi) {
  if (globalProjectileCount > 0) {
    globalProjectileCount--;
  }
  if (isAi && globalAiProjectileCount > 0) {
    globalAiProjectileCount--;
  }
}

export function canPerformVoxelEdit() {
  return globalVoxelEditsThisFrame < MAX_VOXEL_EDITS_PER_FRAME;
}

export function incrementVoxelEdit() {
  globalVoxelEditsThisFrame++;
}

export function canPerformTerrainImpact() {
  return globalTerrainImpactsThisFrame < MAX_TERRAIN_IMPACTS_PER_FRAME;
}

export function incrementTerrainImpact() {
  globalTerrainImpactsThisFrame++;
}

const MISSILE_PROP_HIT_RADIUS = 4.2;
const PROJECTILE_TARGET_RADIUS = 3.8;
const DESTRUCTION_REACH = 2;
const DUST_PARTICLE_COUNT = 9;
const DUST_PARTICLE_LIFETIME = 26;
const FLAMETHROWER_LIFETIME = 28;
const FLAMETHROWER_SMOKE_LIFETIME = 24;
const MAX_FLAME_TRAVEL_DISTANCE = 68;
const FLAMETHROWER_IMPACT_SOUND_INTERVAL_MS = 90;
const FLAMETHROWER_PROP_HIT_RADIUS = 2.4;
const FLAMETHROWER_PROP_HIT_INTERVAL_MS = 75;
const FLAMETHROWER_RAYCAST_STRIDE = 3;
const FLAMETHROWER_HEAT_PER_HIT = 0.33;
const FLAMETHROWER_HEAT_THRESHOLD = 1.0;
const FLAMETHROWER_HEAT_DECAY_RATE = 0.35;
const IMPACT_FLAME_PARTICLE_COUNT = 3;
const IMPACT_SMOKE_PARTICLE_COUNT = 2;
const MISSILE_EXPLOSION_FLAME_PARTICLE_COUNT = 14;
const MISSILE_EXPLOSION_SMOKE_PARTICLE_COUNT = 10;
const MISSILE_RAYCAST_STRIDE_UNDER_LOAD = 2;
const WEAPONS = [
  {
    id: 'bullets',
    label: 'BULLETS',
    fireIntervalMs: 70,
    projectileCount: 1,
    recoil: 0,
    spread: 0,
    speed: BULLET_SPEED,
    targetDamage: scaleWeaponDamage(2),
    targetImpactStrength: 0.12,
    targetImpulse: 0.08,
  },
  {
    id: 'shotgun',
    label: 'SHOTGUN',
    fireIntervalMs: 1170,
    projectileCount: 6,
    recoil: 0.38,
    recoilForce: 0.22,
    spread: 0.075,
    speed: 5,
    targetDamage: scaleWeaponDamage(4),
    targetImpactStrength: 0.45,
    targetImpulse: 0.35,
  },
  {
    id: 'missile',
    label: 'MISSILE',
    fireIntervalMs: 2790,
    projectileCount: 1,
    recoil: 1.74,
    recoilForce: 0.44,
    spread: 0,
    speed: MISSILE_SPEED,
    canTrack: true,
    destructionReach: MISSILE_EXPLOSION_REACH,
  },
  {
    id: 'flamethrower',
    label: 'FLAMETHROWER',
    fireIntervalMs: 42,
    projectileCount: 9,
    recoil: 0.08,
    spread: 0.1,
    speed: 2.85,
    destructionReach: 0,
    targetDamage: scaleWeaponDamage(1),
    targetImpactStrength: 0.1,
    targetImpulse: 0.03,
  },
];

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rotateTowards(currentDir, desiredDir, maxAngle) {
  const dot = clamp(currentDir.dot(desiredDir), -1, 1);
  const angle = Math.acos(dot);
  if (angle < 0.0001) {
    return desiredDir.clone();
  }
  const t = Math.min(1, maxAngle / angle);
  return currentDir.clone().lerp(desiredDir, t).normalize();
}

function createDustMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x8aa09a,
    transparent: true,
    opacity: 0.55,
  });
}

function createBulletMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xfff0a8,
    transparent: true,
    opacity: 0.92,
  });
}

function createMissileBodyMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xd9ddd8,
  });
}

function createMissileNoseMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xff9259,
  });
}

function createMissileFlareMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xffd38a,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createFlameJetMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createFlameSmokeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x5c5049,
    transparent: true,
    opacity: 0.09,
  });
}

function setObjectActive(object, isActive) {
  object.visible = isActive;
  object.userData.active = isActive;
}

function releasePooledObject(object) {
  setObjectActive(object, false);
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  object.scale.set(1, 1, 1);
}

function acquirePooledObject(pool, createObject) {
  for (const object of pool) {
    if (!object.userData.active) {
      return object;
    }
  }

  const object = createObject();
  setObjectActive(object, false);
  pool.push(object);
  return object;
}

function getVoxelCenter(world, voxelX, voxelY, voxelZ, target) {
  target.set(
    voxelToWorldCoord(world, voxelX + 0.5),
    voxelToWorldCoord(world, voxelY + 0.5),
    voxelToWorldCoord(world, voxelZ + 0.5)
  );
  return target;
}

function destroyVoxelCluster(
  world,
  centerX,
  centerY,
  centerZ,
  reach = DESTRUCTION_REACH,
  shape = 'diamond',
  edgeJitter = 0
) {
  let destroyedCount = 0;
  const maxDistanceSq = reach * reach;
  var outerReach = reach;

  if (edgeJitter > 0) {
    outerReach = Math.ceil(reach * (1 + 0.35 * edgeJitter));
  }
  const outerReachSq = outerReach * outerReach;
  const innerReachSq = edgeJitter > 0 ? (reach * 0.65) * (reach * 0.65) : 0;
  var jitteredRadiusSq;

  for (let y = centerY - outerReach; y <= centerY + outerReach; y++) {
    for (let z = centerZ - outerReach; z <= centerZ + outerReach; z++) {
      for (let x = centerX - outerReach; x <= centerX + outerReach; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dz = z - centerZ;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (shape === 'sphere') {
          if (distSq > outerReachSq) {
            continue;
          }

          if (edgeJitter > 0) {
            if (distSq <= innerReachSq) {
              // inner core: always destroy
            } else {
              // randomize effective radius per voxel for chaotic edge
              jitteredRadiusSq =
                reach * reach *
                (0.65 + Math.random() * 0.7 * edgeJitter) *
                (0.65 + Math.random() * 0.7 * edgeJitter);
              if (distSq > jitteredRadiusSq) {
                continue;
              }
            }
          } else if (distSq > maxDistanceSq) {
            continue;
          }
        } else if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > reach) {
          continue;
        }

        const voxelType = getVoxel(world, x, y, z);
        if (!isVoxelDestructible(voxelType)) {
          continue;
        }

        if (setRuntimeVoxel(world, x, y, z, VOXEL_TYPES.EMPTY)) {
          destroyedCount++;
        }
      }
    }
  }

  return destroyedCount;
}

function isDestructibleDecorationPatch(patch) {
  if (!patch || !patch.userData || !patch.userData.detailKind) {
    return false;
  }

  return (
    patch.userData.detailKind === 'moss-vine-patch' ||
    patch.userData.detailKind === 'moss-cactus-patch'
  );
}

export function initWeaponSystem(
  rocket,
  scene,
  world,
  audioSystem = null,
  applyImpulse = null,
  applySelfDamage = null,
  onCameraBlast = null,
  projectileTarget = null,
  getLockState = null,
  getTargetAnchorWorld = null,
  isAi = false
) {
  const projectileTargets = Array.isArray(projectileTarget)
    ? projectileTarget
    : projectileTarget
      ? [projectileTarget]
      : [];
  const rocketVisual = rocket.userData.visualMesh || rocket;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const muzzlePosition = new THREE.Vector3();
  const nextBulletPosition = new THREE.Vector3();
  const hitPosition = new THREE.Vector3();
  const particleDirection = new THREE.Vector3();
  const randomDirection = new THREE.Vector3();
  const shotDirection = new THREE.Vector3();
  const missileDirection = new THREE.Vector3();
  const missileTrailOffset = new THREE.Vector3();
  const flameOrigin = new THREE.Vector3();
  const flameVelocity = new THREE.Vector3();
  const smokeVelocity = new THREE.Vector3();
  const blastOffset = new THREE.Vector3();
  const blastDirection = new THREE.Vector3();
  const projectileTargetOffset = new THREE.Vector3();
  const projectileTargetSegment = new THREE.Vector3();
  const projectileTargetClosest = new THREE.Vector3();
  const projectileTargetImpulse = new THREE.Vector3();
  const recoilImpulse = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const missileModelAxis = new THREE.Vector3(0, 1, 0);
  const missileTrackingTarget = new THREE.Vector3();
  const missileDesiredDir = new THREE.Vector3();
  const missileCurrentDir = new THREE.Vector3();
  const missileNewDir = new THREE.Vector3();
  let spreadAngle = 0;
  let spreadRadius = 0;
  const bullets = [];
  const missiles = [];
  const dustParticles = [];
  const flameJets = [];
  const flameSmoke = [];
  const voxelHeatMap = new Map();
  const bulletPool = [];
  const missilePool = [];
  const dustParticlePool = [];
  const flameJetPool = [];
  const flameSmokePool = [];
  const bulletGeometry = new THREE.SphereGeometry(0.12, 6, 6);
  const missileBodyGeometry = new THREE.CylinderGeometry(0.12, 0.18, 0.82, 8);
  const missileNoseGeometry = new THREE.ConeGeometry(0.17, 0.34, 8);
  const missileFlareGeometry = new THREE.OctahedronGeometry(0.28, 0);
  const dustGeometry = new THREE.SphereGeometry(0.18, 5, 5);
  const flameJetGeometry = new THREE.OctahedronGeometry(0.35, 0);
  const flameSmokeGeometry = new THREE.SphereGeometry(0.22, 6, 6);
  const bulletMaterial = createBulletMaterial();
  const missileBodyMaterial = createMissileBodyMaterial();
  const missileNoseMaterial = createMissileNoseMaterial();
  const missileFlareMaterial = createMissileFlareMaterial();
  const dustMaterial = createDustMaterial();
  const flameJetMaterials = [
    createFlameJetMaterial(0xffc24b),
    createFlameJetMaterial(0xff8f24),
    createFlameJetMaterial(0xff6418),
    createFlameJetMaterial(0xff3b12),
  ];
  const flameSmokeMaterial = createFlameSmokeMaterial();
  let lastShotTimes = {
    bullets: Number.NEGATIVE_INFINITY,
    shotgun: Number.NEGATIVE_INFINITY,
    flamethrower: Number.NEGATIVE_INFINITY,
  };
  let lastMissileShotTime = Number.NEGATIVE_INFINITY;
  let currentWeaponIndex = 0;
  let recoilOffset = 0;
  let recoilTarget = 0;
  let recoilSnap = 0;
  let flamethrowerGlow = 0;
  let lastFlamethrowerImpactTime = Number.NEGATIVE_INFINITY;
  let lastFlamethrowerPropHitTime = Number.NEGATIVE_INFINITY;
  let lastFireDeniedTime = Number.NEGATIVE_INFINITY;
  let lastCooldownReadySoundTime = Number.NEGATIVE_INFINITY;
  let lastSuccessfulFireTime = Number.NEGATIVE_INFINITY;
  let wasOnCooldown = false;
  const inputBufferWindowMs = 100;
  const fireDenialGraceMs = 200;
  const flamethrowerLight = new THREE.PointLight(0xff9a42, 0, 0, 2);

  flamethrowerLight.position.set(
    ROCKET_WEAPON_MUZZLE_POINT.x,
    ROCKET_WEAPON_MUZZLE_POINT.y,
    ROCKET_WEAPON_MUZZLE_POINT.z - 0.35
  );
  rocket.add(flamethrowerLight);

  function getMuzzlePosition(target) {
    target
      .set(
        ROCKET_WEAPON_MUZZLE_POINT.x,
        ROCKET_WEAPON_MUZZLE_POINT.y,
        ROCKET_WEAPON_MUZZLE_POINT.z
      )
      .applyMatrix4(rocket.matrixWorld);
    return target;
  }

  function isProjectileTargetActive() {
    return projectileTargets.some(function (target) {
      if (
        !target ||
        !target.rocket ||
        typeof target.applyDamage !== 'function'
      ) {
        return false;
      }

      if (typeof target.isActive === 'function') {
        return target.isActive();
      }

      return target.rocket.visible;
    });
  }

  function hitProjectileTarget(
    start,
    end,
    damage,
    impactStrength,
    impulseForce
  ) {
    let bestTarget = null;
    let bestDistanceSq = PROJECTILE_TARGET_RADIUS * PROJECTILE_TARGET_RADIUS;

    for (const target of projectileTargets) {
      if (!target || !target.rocket) {
        continue;
      }

      if (typeof target.isActive === 'function' && !target.isActive()) {
        continue;
      }

      if (!target.rocket.visible) {
        continue;
      }

      projectileTargetSegment.subVectors(end, start);
      const segmentLengthSq = projectileTargetSegment.lengthSq();
      let distanceSq;

      if (segmentLengthSq <= 0.0001) {
        projectileTargetClosest.copy(start);
        distanceSq = target.rocket.position.distanceToSquared(start);
      } else {
        const t = clamp(
          projectileTargetOffset
            .subVectors(target.rocket.position, start)
            .dot(projectileTargetSegment) / segmentLengthSq,
          0,
          1
        );

        projectileTargetClosest
          .copy(start)
          .addScaledVector(projectileTargetSegment, t);

        distanceSq = target.rocket.position.distanceToSquared(
          projectileTargetClosest
        );
      }

      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestTarget = target;
      }
    }

    if (!bestTarget) {
      return null;
    }

    projectileTargetSegment.subVectors(end, start);
    const segmentLengthSq = projectileTargetSegment.lengthSq();

    if (segmentLengthSq <= 0.0001) {
      projectileTargetClosest.copy(start);
    } else {
      const t = clamp(
        projectileTargetOffset
          .subVectors(bestTarget.rocket.position, start)
          .dot(projectileTargetSegment) / segmentLengthSq,
        0,
        1
      );

      projectileTargetClosest
        .copy(start)
        .addScaledVector(projectileTargetSegment, t);
    }

    if (damage > 0) {
      bestTarget.applyDamage(damage, impactStrength);
    }

    if (impulseForce > 0 && typeof bestTarget.applyImpulse === 'function') {
      projectileTargetImpulse.subVectors(
        bestTarget.rocket.position,
        projectileTargetClosest
      );
      if (projectileTargetImpulse.lengthSq() <= 0.0001) {
        projectileTargetImpulse.copy(projectileTargetSegment);
      }
      if (projectileTargetImpulse.lengthSq() <= 0.0001) {
        projectileTargetImpulse.copy(worldUp);
      }
      projectileTargetImpulse.normalize().multiplyScalar(impulseForce);
      bestTarget.applyImpulse(projectileTargetImpulse);
    }

    return bestTarget;
  }

  function addDust(hit, normal) {
    for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
      if (dustParticles.length >= MAX_ACTIVE_DUST_PARTICLES) {
        break;
      }

      const particle = acquirePooledObject(dustParticlePool, function () {
        const pooledParticle = new THREE.Mesh(dustGeometry, dustMaterial);
        pooledParticle.userData.velocity = new THREE.Vector3();
        scene.add(pooledParticle);
        return pooledParticle;
      });
      randomDirection
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      particleDirection
        .set(normal.x, normal.y, normal.z)
        .multiplyScalar(0.18 + Math.random() * 0.16)
        .addScaledVector(randomDirection, 0.12);

      particle.position.copy(hit);
      particle.userData.velocity.copy(particleDirection);
      particle.userData.life = DUST_PARTICLE_LIFETIME;
      particle.userData.maxLife = DUST_PARTICLE_LIFETIME;
      particle.userData.growth = 0.018 + Math.random() * 0.018;
      particle.scale.setScalar(0.65 + Math.random() * 0.65);
      particle.material.opacity = 0.55;
      particle.rotation.set(0, 0, 0);
      setObjectActive(particle, true);
      dustParticles.push(particle);
    }
  }

  function getFlameMaterial(flameJetMaterials) {
    return flameJetMaterials[
      Math.floor(Math.random() * flameJetMaterials.length)
    ];
  }

  function addFlameParticle(
    position,
    velocity,
    life,
    scale,
    canHit = false,
    weapon = null
  ) {
    if (flameJets.length >= MAX_ACTIVE_FLAME_JETS) {
      return;
    }

    const particle = acquirePooledObject(flameJetPool, function () {
      const pooledParticle = new THREE.Mesh(
        flameJetGeometry,
        flameJetMaterials[0]
      );
      pooledParticle.userData.velocity = new THREE.Vector3();
      scene.add(pooledParticle);
      return pooledParticle;
    });
    particle.position.copy(position);
    particle.userData.velocity.copy(velocity);
    particle.userData.life = life;
    particle.userData.maxLife = life;
    particle.userData.growth = 0.018 + Math.random() * 0.026;
    particle.userData.distance = 0;
    particle.userData.drag = 0.92 + Math.random() * 0.04;
    particle.userData.spin = (Math.random() - 0.5) * 0.12;
    particle.userData.raycastCooldown = 0;
    particle.userData.canHit = canHit;
    particle.userData.targetDamage =
      weapon && weapon.targetDamage ? weapon.targetDamage : 0;
    particle.userData.targetImpactStrength =
      weapon && weapon.targetImpactStrength ? weapon.targetImpactStrength : 0;
    particle.userData.targetImpulse =
      weapon && weapon.targetImpulse ? weapon.targetImpulse : 0;
    particle.scale.setScalar(scale);
    particle.rotation.set(0, 0, 0);
    particle.material = getFlameMaterial(flameJetMaterials);
    particle.material.opacity = 0.86;
    setObjectActive(particle, true);
    flameJets.push(particle);
  }

  function addFlameSmokeParticle(position, velocity, life, scale) {
    if (flameSmoke.length >= MAX_ACTIVE_FLAME_SMOKE) {
      return;
    }

    const particle = acquirePooledObject(flameSmokePool, function () {
      const pooledParticle = new THREE.Mesh(
        flameSmokeGeometry,
        flameSmokeMaterial
      );
      pooledParticle.userData.velocity = new THREE.Vector3();
      scene.add(pooledParticle);
      return pooledParticle;
    });
    particle.position.copy(position);
    particle.userData.velocity.copy(velocity);
    particle.userData.life = life;
    particle.userData.maxLife = life;
    particle.userData.growth = 0.018 + Math.random() * 0.022;
    particle.userData.lift = 0.004 + Math.random() * 0.003;
    particle.userData.drag = 0.945 + Math.random() * 0.02;
    particle.scale.setScalar(scale);
    particle.rotation.set(0, 0, 0);
    particle.material.opacity = 0.09;
    setObjectActive(particle, true);
    flameSmoke.push(particle);
  }

  function addFlameImpact(hit, normal) {
    for (let i = 0; i < IMPACT_FLAME_PARTICLE_COUNT; i++) {
      randomDirection
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      flameOrigin
        .copy(hit)
        .addScaledVector(randomDirection, Math.random() * 0.18);
      particleDirection
        .set(normal.x, normal.y, normal.z)
        .multiplyScalar(0.08 + Math.random() * 0.16)
        .addScaledVector(randomDirection, 0.16 + Math.random() * 0.12);
      addFlameParticle(
        flameOrigin,
        particleDirection,
        7 + Math.floor(Math.random() * 5),
        0.34 + Math.random() * 0.28
      );
    }

    for (let i = 0; i < IMPACT_SMOKE_PARTICLE_COUNT; i++) {
      randomDirection
        .set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5)
        .normalize();
      flameOrigin
        .copy(hit)
        .addScaledVector(randomDirection, Math.random() * 0.24);
      smokeVelocity
        .copy(randomDirection)
        .multiplyScalar(0.035 + Math.random() * 0.055)
        .addScaledVector(up, 0.05 + Math.random() * 0.04);
      addFlameSmokeParticle(
        flameOrigin,
        smokeVelocity,
        FLAMETHROWER_SMOKE_LIFETIME + Math.floor(Math.random() * 8),
        0.2 + Math.random() * 0.14
      );
    }
  }

  function addMissileTrail(missile) {
    missileDirection.copy(missile.userData.velocity).normalize();
    flameOrigin.copy(missile.position).addScaledVector(missileDirection, -0.52);
    flameVelocity
      .copy(missileDirection)
      .multiplyScalar(-0.1 - Math.random() * 0.04)
      .addScaledVector(worldUp, 0.008 + Math.random() * 0.01);
    addFlameParticle(
      flameOrigin,
      flameVelocity,
      8 + Math.floor(Math.random() * 5),
      0.34 + Math.random() * 0.18
    );

    if (missile.userData.trailStep % 1 === 0) {
      missileTrailOffset
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      smokeVelocity
        .copy(missileDirection)
        .multiplyScalar(-0.035 - Math.random() * 0.02)
        .addScaledVector(worldUp, 0.015 + Math.random() * 0.02)
        .addScaledVector(missileTrailOffset, (Math.random() - 0.5) * 0.025);
      addFlameSmokeParticle(
        flameOrigin,
        smokeVelocity,
        FLAMETHROWER_SMOKE_LIFETIME + 20 + Math.floor(Math.random() * 14),
        0.26 + Math.random() * 0.16
      );
    }

    missile.userData.trailStep++;
  }

  function addMissileExplosion(position, normal) {
    addFlameParticle(position, flameVelocity.set(0, 0, 0), 12, 3.1);

    for (let i = 0; i < MISSILE_EXPLOSION_FLAME_PARTICLE_COUNT; i++) {
      randomDirection
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      flameOrigin
        .copy(position)
        .addScaledVector(randomDirection, Math.random() * 0.7);
      flameVelocity
        .copy(randomDirection)
        .multiplyScalar(0.18 + Math.random() * 0.24)
        .addScaledVector(normal, 0.08 + Math.random() * 0.18);
      addFlameParticle(
        flameOrigin,
        flameVelocity,
        12 + Math.floor(Math.random() * 10),
        0.95 + Math.random() * 1.1
      );
    }

    for (let i = 0; i < MISSILE_EXPLOSION_SMOKE_PARTICLE_COUNT; i++) {
      randomDirection
        .set(Math.random() - 0.5, Math.random() * 0.75, Math.random() - 0.5)
        .normalize();
      flameOrigin
        .copy(position)
        .addScaledVector(randomDirection, Math.random() * 0.9);
      smokeVelocity
        .copy(randomDirection)
        .multiplyScalar(0.06 + Math.random() * 0.11)
        .addScaledVector(worldUp, 0.08 + Math.random() * 0.06);
      addFlameSmokeParticle(
        flameOrigin,
        smokeVelocity,
        FLAMETHROWER_SMOKE_LIFETIME + 28 + Math.floor(Math.random() * 20),
        0.56 + Math.random() * 0.46
      );
    }
  }

  function removeBullet(index) {
    const bullet = bullets[index];
    releasePooledObject(bullet);
    bullets.splice(index, 1);
    decrementProjectileCount(isAi);
  }

  function removeMissile(index) {
    const missile = missiles[index];
    releasePooledObject(missile);

    missiles.splice(index, 1);
    decrementProjectileCount(isAi);
  }

  function removeFlameJet(index) {
    const flame = flameJets[index];
    releasePooledObject(flame);
    flameJets.splice(index, 1);
  }

  function removeFlameSmoke(index) {
    const smoke = flameSmoke[index];
    releasePooledObject(smoke);
    flameSmoke.splice(index, 1);
  }

  function getCurrentWeapon() {
    return WEAPONS[currentWeaponIndex] || WEAPONS[0];
  }

  function getUiState() {
    const weapon = getCurrentWeapon();
    const isMissile = weapon.id === 'missile';
    const cooldownReferenceTime = isMissile
      ? lastMissileShotTime
      : lastShotTimes[weapon.id];

    const currentTime = performance.now();
    const timeSinceFire = currentTime - cooldownReferenceTime;
    const cooldownProgress = Math.min(1, timeSinceFire / weapon.fireIntervalMs);

    const fireDenied =
      lastFireDeniedTime > 0 && currentTime - lastFireDeniedTime < 100;

    if (cooldownProgress >= 1 && wasOnCooldown) {
      wasOnCooldown = false;
      if (currentTime - lastCooldownReadySoundTime > 200) {
        lastCooldownReadySoundTime = currentTime;
        if (
          audioSystem &&
          typeof audioSystem.playCooldownReady === 'function'
        ) {
          audioSystem.playCooldownReady(weapon.id);
        }
      }
    } else if (cooldownProgress < 1) {
      wasOnCooldown = true;
    }

    return {
      id: weapon.id,
      label: weapon.label,
      lastFireTime: cooldownReferenceTime,
      fireIntervalMs: weapon.fireIntervalMs,
      cooldownProgress: cooldownProgress,
      fireDenied: fireDenied,
      fireDeniedTime: lastFireDeniedTime,
    };
  }

  function cycleWeapon() {
    currentWeaponIndex = (currentWeaponIndex + 1) % WEAPONS.length;

    if (audioSystem && typeof audioSystem.playWeaponSwitch === 'function') {
      audioSystem.playWeaponSwitch();
    }
  }

  function setWeapon(weaponId) {
    const nextWeaponIndex = WEAPONS.findIndex(function (weapon) {
      return weapon.id === weaponId;
    });

    if (nextWeaponIndex < 0 || nextWeaponIndex === currentWeaponIndex) {
      return false;
    }

    currentWeaponIndex = nextWeaponIndex;

    if (audioSystem && typeof audioSystem.playWeaponSwitch === 'function') {
      audioSystem.playWeaponSwitch();
    }

    return true;
  }

  function addBullet(direction, speed, weapon) {
    if (bullets.length >= MAX_ACTIVE_BULLETS) {
      return;
    }
    if (!canSpawnProjectile(isAi)) {
      return;
    }

    const bullet = acquirePooledObject(bulletPool, function () {
      const pooledBullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
      pooledBullet.userData.velocity = new THREE.Vector3();
      scene.add(pooledBullet);
      return pooledBullet;
    });
    bullet.position.copy(muzzlePosition);
    bullet.userData.velocity.copy(direction).multiplyScalar(speed);
    bullet.userData.life = BULLET_LIFETIME;
    bullet.userData.maxLife = BULLET_LIFETIME;
    bullet.userData.distance = 0;
    bullet.userData.targetDamage = weapon.targetDamage || 1;
    bullet.userData.targetImpactStrength = weapon.targetImpactStrength || 0.1;
    bullet.userData.targetImpulse = weapon.targetImpulse || 0;
    bullet.scale.setScalar(1);
    bullet.material.opacity = 0.92;
    setObjectActive(bullet, true);
    bullets.push(bullet);
    incrementProjectileCount(isAi);
  }

  function addMissile(direction, speed, locked, targetId) {
    if (missiles.length >= MAX_ACTIVE_MISSILES) {
      return;
    }
    if (!canSpawnProjectile(isAi)) {
      return;
    }

    const missile = acquirePooledObject(missilePool, function () {
      const pooledMissile = new THREE.Group();
      const body = new THREE.Mesh(missileBodyGeometry, missileBodyMaterial);
      const nose = new THREE.Mesh(missileNoseGeometry, missileNoseMaterial);
      const flare = new THREE.Mesh(missileFlareGeometry, missileFlareMaterial);

      nose.position.y = 0.56;
      flare.position.y = -0.56;
      flare.scale.set(1.2, 1.9, 1.2);

      pooledMissile.add(body);
      pooledMissile.add(nose);
      pooledMissile.add(flare);
      pooledMissile.userData.body = body;
      pooledMissile.userData.nose = nose;
      pooledMissile.userData.flare = flare;
      pooledMissile.userData.velocity = new THREE.Vector3();
      scene.add(pooledMissile);
      return pooledMissile;
    });

    missile.position.copy(muzzlePosition).addScaledVector(direction, 0.72);
    missile.rotation.set(0, 0, 0);
    missile.quaternion.setFromUnitVectors(missileModelAxis, direction);
    missile.userData.velocity.copy(direction).multiplyScalar(speed);
    missile.userData.explosionReach = MISSILE_EXPLOSION_REACH;
    missile.userData.trailStep = 0;
    missile.userData.raycastCooldown = 0;
    missile.userData.flare.material.opacity = 0.88;
    missile.userData.flare.scale.set(1.2, 1.9, 1.2);
    missile.userData.locked = locked;
    missile.userData.targetId = targetId;
    missile.userData.turnRate = MISSILE_TURN_RATE;
    missile.userData.speed = speed;
    missile.userData.lifetime = MISSILE_LIFETIME_MS;
    missile.userData.age = 0;
    setObjectActive(missile, true);
    missiles.push(missile);
    incrementProjectileCount(isAi);
  }

  function addFlamethrowerBurst(weapon) {
    const shotRotation = Math.random() * Math.PI * 2;

    for (let i = 0; i < weapon.projectileCount; i++) {
      applyShotSpread(weapon, i, shotRotation);
      flameOrigin
        .copy(muzzlePosition)
        .addScaledVector(shotDirection, 0.62 + Math.random() * 0.82)
        .addScaledVector(right, (Math.random() - 0.5) * 0.3)
        .addScaledVector(up, (Math.random() - 0.5) * 0.3);
      flameVelocity
        .copy(shotDirection)
        .multiplyScalar(weapon.speed * lerp(0.96, 1.18, Math.random()))
        .addScaledVector(right, (Math.random() - 0.5) * 0.05)
        .addScaledVector(up, (Math.random() - 0.5) * 0.05);
      addFlameParticle(
        flameOrigin,
        flameVelocity,
        FLAMETHROWER_LIFETIME + Math.floor(Math.random() * 7),
        lerp(0.9, 1.68, Math.random()),
        true,
        weapon
      );

      if (i < weapon.projectileCount - 1) {
        smokeVelocity
          .copy(flameVelocity)
          .multiplyScalar(0.22)
          .addScaledVector(up, 0.04 + Math.random() * 0.035)
          .addScaledVector(right, (Math.random() - 0.5) * 0.015);
        addFlameSmokeParticle(
          flameOrigin,
          smokeVelocity,
          FLAMETHROWER_SMOKE_LIFETIME + Math.floor(Math.random() * 8),
          lerp(0.14, 0.28, Math.random())
        );
      }
    }
  }

  function applyShotSpread(weapon, pelletIndex, shotRotation) {
    shotDirection.copy(forward);

    if (weapon.spread <= 0) {
      return;
    }

    if (weapon.id === 'shotgun' && weapon.projectileCount > 1) {
      if (pelletIndex === 0) {
        return;
      }

      const ringIndex = pelletIndex - 1;
      const ringCount = weapon.projectileCount - 1;
      const ringAngle = shotRotation + (ringIndex / ringCount) * Math.PI * 2;

      shotDirection
        .addScaledVector(right, Math.cos(ringAngle) * weapon.spread)
        .addScaledVector(up, Math.sin(ringAngle) * weapon.spread)
        .normalize();
      return;
    }

    spreadAngle = Math.random() * Math.PI * 2;
    spreadRadius = Math.sqrt(Math.random()) * weapon.spread;
    shotDirection
      .addScaledVector(right, Math.cos(spreadAngle) * spreadRadius)
      .addScaledVector(up, Math.sin(spreadAngle) * spreadRadius)
      .normalize();
  }

  function triggerRecoil(amount) {
    recoilTarget = Math.min(2.1, recoilTarget + amount);
    recoilSnap = 1;
  }

  function updateRecoil() {
    if (recoilSnap > 0) {
      recoilOffset = recoilTarget;
      recoilSnap = 0;
    } else {
      recoilOffset *= 0.42;
      recoilTarget *= 0.18;
    }

    if (recoilOffset < 0.0005 && recoilTarget < 0.0005) {
      recoilOffset = 0;
      recoilTarget = 0;
      recoilSnap = 0;
      return;
    }

    rocketVisual.position.z -= recoilOffset;
    rocketVisual.rotation.x += recoilOffset * 0.24;
  }

  function fire(currentTime) {
    const weapon = getCurrentWeapon();
    const isMissile = weapon.id === 'missile';
    const cooldownReferenceTime = isMissile
      ? lastMissileShotTime
      : lastShotTimes[weapon.id];

    const cooldownRemaining =
      weapon.fireIntervalMs - (currentTime - cooldownReferenceTime);

    if (cooldownRemaining > 0) {
      if (cooldownRemaining < inputBufferWindowMs) {
        return;
      }

      if (currentTime - lastSuccessfulFireTime < fireDenialGraceMs) {
        return;
      }

      lastFireDeniedTime = currentTime;

      return;
    }

    if (isMissile) {
      lastMissileShotTime = currentTime;
    } else {
      lastShotTimes[weapon.id] = currentTime;
    }
    lastSuccessfulFireTime = currentTime;

    getRocketForwardVector(rocket, forward);
    getRocketRightVector(rocket, right);
    getRocketUpVector(rocket, up);
    getMuzzlePosition(muzzlePosition);

    if (weapon.id === 'flamethrower') {
      addFlamethrowerBurst(weapon);

      if (weapon.recoil > 0) {
        triggerRecoil(weapon.recoil);
      }

      return;
    }

    if (weapon.id === 'missile') {
      let locked = false;
      let targetId = null;

      if (getLockState && typeof getLockState === 'function') {
        const lockInfo = getLockState();
        if (lockInfo && lockInfo.isLocked) {
          locked = true;
          targetId = lockInfo.targetId || null;
        }
      }

      addMissile(forward, weapon.speed, locked, targetId);
      addMissileTrail(missiles[missiles.length - 1]);

      if (audioSystem && typeof audioSystem.playMissileLaunch === 'function') {
        if (locked && typeof audioSystem.playMissileLockLaunch === 'function') {
          audioSystem.playMissileLockLaunch();
        } else {
          audioSystem.playMissileLaunch();
        }
      }

      if (weapon.recoil > 0) {
        triggerRecoil(weapon.recoil);
      }

      if (weapon.recoilForce > 0 && typeof applyImpulse === 'function') {
        applyImpulse(
          recoilImpulse.copy(forward).multiplyScalar(-weapon.recoilForce)
        );
      }

      return;
    }

    const shotRotation = Math.random() * Math.PI * 2;

    for (let i = 0; i < weapon.projectileCount; i++) {
      applyShotSpread(weapon, i, shotRotation);
      addBullet(shotDirection, weapon.speed, weapon);
    }

    if (audioSystem) {
      if (weapon.id === 'shotgun') {
        audioSystem.playShotgun();
      } else {
        audioSystem.playShot();
      }
    }

    if (weapon.recoil > 0) {
      triggerRecoil(weapon.recoil);
    }

    if (weapon.recoilForce > 0 && typeof applyImpulse === 'function') {
      applyImpulse(
        recoilImpulse.copy(forward).multiplyScalar(-weapon.recoilForce)
      );
    }
  }

  function damageTerrainInRadius(position, radius) {
    const voxelCenter = new THREE.Vector3();
    const worldPos = position.clone();

    const voxelX = Math.floor(worldPos.x / WORLD_UNITS_PER_VOXEL);
    const voxelY = Math.floor(worldPos.y / WORLD_UNITS_PER_VOXEL);
    const voxelZ = Math.floor(worldPos.z / WORLD_UNITS_PER_VOXEL);

    const radiusInVoxels = Math.ceil(radius / WORLD_UNITS_PER_VOXEL);

    for (let y = voxelY - radiusInVoxels; y <= voxelY + radiusInVoxels; y++) {
      for (let z = voxelZ - radiusInVoxels; z <= voxelZ + radiusInVoxels; z++) {
        for (
          let x = voxelX - radiusInVoxels;
          x <= voxelX + radiusInVoxels;
          x++
        ) {
          getVoxelCenter(world, x, y, z, voxelCenter);
          const dist = voxelCenter.distanceTo(worldPos);
          if (dist <= radius) {
            const voxelType = getVoxel(world, x, y, z);
            if (isVoxelDestructible(voxelType)) {
              setRuntimeVoxel(world, x, y, z, VOXEL_TYPES.EMPTY);
            }
          }
        }
      }
    }
  }

  function explodeMissile(missile, hit = null) {
    const explosionReach =
      missile.userData.explosionReach || MISSILE_EXPLOSION_REACH;

    missileDirection.copy(missile.userData.velocity).normalize();

    if (hit) {
      getVoxelCenter(world, hit.voxelX, hit.voxelY, hit.voxelZ, hitPosition);
      destroyVoxelCluster(
        world,
        hit.voxelX,
        hit.voxelY,
        hit.voxelZ,
        explosionReach,
        'sphere',
        0.7
      );
      addDust(hitPosition, hit.normal);

      if (typeof world.destroyDetailPropsNearPoint === 'function') {
        world.destroyDetailPropsNearPoint(
          hitPosition,
          MISSILE_PROP_HIT_RADIUS,
          isDestructibleDecorationPatch
        );
      }

      addMissileExplosion(hitPosition, hit.normal);

      if (MISSILE_EXPLOSION_RADIUS > 0) {
        damageTerrainInRadius(hitPosition, MISSILE_EXPLOSION_RADIUS);
      }
    } else {
      hitPosition.copy(missile.position);
      addMissileExplosion(hitPosition, missileDirection.multiplyScalar(-1));
    }

    if (audioSystem && typeof audioSystem.playMissileExplosion === 'function') {
      audioSystem.playMissileExplosion();
    }

    blastOffset.subVectors(rocket.position, hitPosition);
    const blastDistance = blastOffset.length();

    if (blastDistance <= MISSILE_PLAYER_BLAST_RADIUS) {
      const blastFalloff = 1 - blastDistance / MISSILE_PLAYER_BLAST_RADIUS;
      const blastStrength = blastFalloff * blastFalloff;

      if (blastOffset.lengthSq() > 0.0001) {
        blastDirection.copy(blastOffset).normalize();
      } else {
        blastDirection.copy(missileDirection).multiplyScalar(-1);
        if (blastDirection.lengthSq() <= 0.0001) {
          blastDirection.copy(worldUp);
        }
      }

      if (typeof applyImpulse === 'function') {
        applyImpulse(
          blastDirection.multiplyScalar(
            MISSILE_PLAYER_BLAST_FORCE * blastStrength
          )
        );
      }

      if (typeof applySelfDamage === 'function') {
        applySelfDamage(
          MISSILE_PLAYER_BLAST_DAMAGE * blastStrength,
          0.45 + blastStrength * 0.55
        );
      }

      if (typeof onCameraBlast === 'function') {
        onCameraBlast(hitPosition, blastStrength);
      }
    }

    for (const target of projectileTargets) {
      if (!target || !target.rocket) {
        continue;
      }

      if (typeof target.isActive === 'function' && !target.isActive()) {
        continue;
      }

      if (!target.rocket.visible) {
        continue;
      }

      blastOffset.subVectors(target.rocket.position, hitPosition);
      const targetBlastDistance = blastOffset.length();

      if (targetBlastDistance > MISSILE_PLAYER_BLAST_RADIUS) {
        continue;
      }

      const targetBlastFalloff =
        1 - targetBlastDistance / MISSILE_PLAYER_BLAST_RADIUS;
      const targetBlastStrength = targetBlastFalloff * targetBlastFalloff;

      if (blastOffset.lengthSq() > 0.0001) {
        blastDirection.copy(blastOffset).normalize();
      } else {
        blastDirection.copy(missileDirection).multiplyScalar(-1);
        if (blastDirection.lengthSq() <= 0.0001) {
          blastDirection.copy(worldUp);
        }
      }

      if (typeof target.applyImpulse === 'function') {
        target.applyImpulse(
          blastDirection.multiplyScalar(
            MISSILE_PLAYER_BLAST_FORCE * targetBlastStrength
          )
        );
      }

      target.applyDamage(
        MISSILE_PLAYER_BLAST_DAMAGE * targetBlastStrength,
        0.45 + targetBlastStrength * 0.55
      );
    }
  }

  function updateBullets() {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i];
      nextBulletPosition.copy(bullet.position).add(bullet.userData.velocity);

      const hit = raycastVoxelSegment(
        world,
        bullet.position,
        nextBulletPosition,
        0
      );

      if (
        hitProjectileTarget(
          bullet.position,
          nextBulletPosition,
          bullet.userData.targetDamage,
          bullet.userData.targetImpactStrength,
          bullet.userData.targetImpulse
        )
      ) {
        removeBullet(i);
        continue;
      }

      if (hit) {
        getVoxelCenter(world, hit.voxelX, hit.voxelY, hit.voxelZ, hitPosition);
        destroyVoxelCluster(world, hit.voxelX, hit.voxelY, hit.voxelZ);
        addDust(hitPosition, hit.normal);

        if (audioSystem) {
          audioSystem.playImpact();
        }

        removeBullet(i);
        continue;
      }

      bullet.userData.distance += bullet.userData.velocity.length();
      bullet.position.copy(nextBulletPosition);
      bullet.userData.velocity.multiplyScalar(BULLET_FRICTION);
      bullet.userData.life--;
      bullet.material.opacity =
        (bullet.userData.life / bullet.userData.maxLife) * 0.92;

      if (
        bullet.userData.life > 0 &&
        bullet.userData.distance < MAX_BULLET_TRAVEL_DISTANCE
      ) {
        continue;
      }

      removeBullet(i);
    }
  }

  function updateMissiles(dt) {
    const dtMs = dt * 1000;

    for (let i = missiles.length - 1; i >= 0; i--) {
      const missile = missiles[i];

      missile.userData.age += dtMs;

      if (missile.userData.age >= missile.userData.lifetime) {
        explodeMissile(missile);
        removeMissile(i);
        continue;
      }

      if (missile.userData.locked && missile.userData.targetId) {
        const targetAnchor = getTargetAnchorWorld
          ? getTargetAnchorWorld(missile.userData.targetId)
          : null;

        if (targetAnchor && isProjectileTargetActive()) {
          missileTrackingTarget.copy(targetAnchor);
          missileDesiredDir
            .subVectors(missileTrackingTarget, missile.position)
            .normalize();
          missileCurrentDir.copy(missile.userData.velocity).normalize();
          const maxTurn = missile.userData.turnRate * dt;
          missileNewDir.copy(
            rotateTowards(missileCurrentDir, missileDesiredDir, maxTurn)
          );
          missile.userData.velocity.copy(
            missileNewDir.multiplyScalar(missile.userData.speed)
          );
        } else {
          missile.userData.locked = false;
          missile.userData.targetId = null;
        }
      }

      nextBulletPosition.copy(missile.position).add(missile.userData.velocity);

      let hit = null;

      if (missile.userData.raycastCooldown <= 0) {
        if (canRunVoxelRaycast(world, 'critical')) {
          hit = raycastVoxelSegment(
            world,
            missile.position,
            nextBulletPosition,
            0.08
          );
        } else {
          missile.userData.raycastCooldown =
            MISSILE_RAYCAST_STRIDE_UNDER_LOAD - 1;
        }
      } else {
        missile.userData.raycastCooldown--;
      }

      const hitTarget = hitProjectileTarget(
        missile.position,
        nextBulletPosition,
        0,
        0,
        MISSILE_PLAYER_BLAST_FORCE
      );
      if (hitTarget) {
        if (missile.userData.locked) {
          hitTarget.applyDamage(scaleWeaponDamage(MISSILE_DAMAGE), 1.0);
        }
        explodeMissile(missile);
        removeMissile(i);
        continue;
      }

      if (hit) {
        explodeMissile(missile, hit);
        removeMissile(i);
        continue;
      }

      missile.position.copy(nextBulletPosition);
      missileDirection.copy(missile.userData.velocity).normalize();
      missile.quaternion.setFromUnitVectors(missileModelAxis, missileDirection);
      spreadRadius = Math.random() * 0.42;
      missile.userData.flare.scale.set(
        1.12 + spreadRadius,
        1.85 + spreadRadius * 1.2,
        1.12 + spreadRadius
      );
      missile.userData.flare.material.opacity = 0.78 + Math.random() * 0.2;
      addMissileTrail(missile);

      if (world && world.performanceStats && world.performanceStats.debug) {
        const lockedCount = missiles.filter(function (m) {
          return m.userData.locked;
        }).length;
        debugLog(
          'Missiles: ' + missiles.length + ' active, ' + lockedCount + ' locked'
        );
      }
    }
  }

  var flamethrowerMuzzleRaycastCooldown = 0;

  function updateFlamethrowerParticles(currentTime, dt, isFiring) {
    if (isFiring && flamethrowerMuzzleRaycastCooldown <= 0) {
      flamethrowerMuzzleRaycastCooldown = 2;

      getRocketForwardVector(rocket, forward);
      getMuzzlePosition(muzzlePosition);
      nextBulletPosition.copy(muzzlePosition).addScaledVector(forward, 4);

      var muzzleHit = raycastVoxelSegment(
        world,
        muzzlePosition,
        nextBulletPosition,
        0.05
      );

      if (muzzleHit) {
        for (var my = -1; my <= 1; my++) {
          for (var mz = -1; mz <= 1; mz++) {
            for (var mx = -1; mx <= 1; mx++) {
              var mvx = muzzleHit.voxelX + mx;
              var mvy = muzzleHit.voxelY + my;
              var mvz = muzzleHit.voxelZ + mz;
              var mvoxelType = getVoxel(world, mvx, mvy, mvz);

              if (!isVoxelDestructible(mvoxelType)) {
                continue;
              }

              var mheatKey = mvx + ',' + mvy + ',' + mvz;
              var mcurrentHeat = voxelHeatMap.get(mheatKey) || 0;
              mcurrentHeat += FLAMETHROWER_HEAT_PER_HIT;

              if (mcurrentHeat >= FLAMETHROWER_HEAT_THRESHOLD) {
                destroyVoxelCluster(world, mvx, mvy, mvz, 0);
                voxelHeatMap.delete(mheatKey);
              } else {
                voxelHeatMap.set(mheatKey, mcurrentHeat);
              }
            }
          }
        }
      }
    } else if (flamethrowerMuzzleRaycastCooldown > 0) {
      flamethrowerMuzzleRaycastCooldown--;
    }

    for (let i = flameJets.length - 1; i >= 0; i--) {
      const flame = flameJets[i];
      nextBulletPosition.copy(flame.position).add(flame.userData.velocity);

      if (flame.userData.canHit) {
        if (
          typeof world.destroyDetailPropsNearPoint === 'function' &&
          currentTime - lastFlamethrowerPropHitTime >=
            FLAMETHROWER_PROP_HIT_INTERVAL_MS
        ) {
          lastFlamethrowerPropHitTime = currentTime;
          world.destroyDetailPropsNearPoint(
            nextBulletPosition,
            FLAMETHROWER_PROP_HIT_RADIUS,
            isDestructibleDecorationPatch
          );
        }

        let hit = null;

        if (flame.userData.raycastCooldown <= 0) {
          hit = raycastVoxelSegment(
            world,
            flame.position,
            nextBulletPosition,
            0.05
          );
          flame.userData.raycastCooldown = FLAMETHROWER_RAYCAST_STRIDE - 1;
        } else {
          flame.userData.raycastCooldown--;
        }

        if (
          hitProjectileTarget(
            flame.position,
            nextBulletPosition,
            flame.userData.targetDamage,
            flame.userData.targetImpactStrength,
            flame.userData.targetImpulse
          )
        ) {
          removeFlameJet(i);
          continue;
        }

        if (hit) {
          getVoxelCenter(
            world,
            hit.voxelX,
            hit.voxelY,
            hit.voxelZ,
            hitPosition
          );

          var heatRadius = 1;

          for (var dy = -heatRadius; dy <= heatRadius; dy++) {
            for (var dz = -heatRadius; dz <= heatRadius; dz++) {
              for (var dx = -heatRadius; dx <= heatRadius; dx++) {
                var hx = hit.voxelX + dx;
                var hy = hit.voxelY + dy;
                var hz = hit.voxelZ + dz;
                var voxelType = getVoxel(world, hx, hy, hz);

                if (!isVoxelDestructible(voxelType)) {
                  continue;
                }

                var heatKey = hx + ',' + hy + ',' + hz;
                var currentHeat = voxelHeatMap.get(heatKey) || 0;
                currentHeat += FLAMETHROWER_HEAT_PER_HIT;

                if (currentHeat >= FLAMETHROWER_HEAT_THRESHOLD) {
                  destroyVoxelCluster(world, hx, hy, hz, 0);
                  voxelHeatMap.delete(heatKey);
                } else {
                  voxelHeatMap.set(heatKey, currentHeat);
                }
              }
            }
          }

          if (typeof world.destroyDetailPropsNearPoint === 'function') {
            world.destroyDetailPropsNearPoint(
              hitPosition,
              FLAMETHROWER_PROP_HIT_RADIUS,
              isDestructibleDecorationPatch
            );
          }

          addFlameImpact(hitPosition, hit.normal);

          if (
            audioSystem &&
            currentTime - lastFlamethrowerImpactTime >=
              FLAMETHROWER_IMPACT_SOUND_INTERVAL_MS
          ) {
            lastFlamethrowerImpactTime = currentTime;
            audioSystem.playImpact();
          }

          removeFlameJet(i);
          continue;
        }
      }

      flame.userData.distance += flame.userData.velocity.length();
      flame.userData.life--;
      flame.position.copy(nextBulletPosition);
      flame.userData.velocity.multiplyScalar(flame.userData.drag);
      flame.scale.multiplyScalar(1 + flame.userData.growth);
      flame.rotation.z += flame.userData.spin;
      flame.material.opacity =
        (flame.userData.life / flame.userData.maxLife) * 0.88;

      if (
        flame.userData.life > 0 &&
        flame.userData.distance < MAX_FLAME_TRAVEL_DISTANCE
      ) {
        continue;
      }

      removeFlameJet(i);
    }

    if (voxelHeatMap.size > 0 && dt > 0) {
      var decayAmount = FLAMETHROWER_HEAT_DECAY_RATE * dt;
      voxelHeatMap.forEach(function (heat, key) {
        heat -= decayAmount;
        if (heat <= 0) {
          voxelHeatMap.delete(key);
        } else {
          voxelHeatMap.set(key, heat);
        }
      });
    }
  }

  function updateFlamethrowerSmoke() {
    for (let i = flameSmoke.length - 1; i >= 0; i--) {
      const smoke = flameSmoke[i];
      smoke.userData.life--;
      smoke.position.add(smoke.userData.velocity);
      smoke.userData.velocity.multiplyScalar(smoke.userData.drag);
      smoke.userData.velocity.addScaledVector(worldUp, smoke.userData.lift);
      smoke.scale.multiplyScalar(1 + smoke.userData.growth);
      smoke.material.opacity =
        (smoke.userData.life / smoke.userData.maxLife) * 0.08;

      if (smoke.userData.life > 0) {
        continue;
      }

      removeFlameSmoke(i);
    }
  }

  function updateDust() {
    for (let i = dustParticles.length - 1; i >= 0; i--) {
      const particle = dustParticles[i];
      particle.userData.life--;
      particle.position.add(particle.userData.velocity);
      particle.userData.velocity.multiplyScalar(0.94);
      particle.scale.multiplyScalar(1 + particle.userData.growth);
      particle.material.opacity =
        (particle.userData.life / particle.userData.maxLife) * 0.55;

      if (particle.userData.life > 0) {
        continue;
      }

      releasePooledObject(particle);
      dustParticles.splice(i, 1);
    }
  }

  function updateFlamethrowerFeedback(isActive) {
    if (isActive) {
      flamethrowerGlow = clamp(flamethrowerGlow + 0.18, 0, 1);
    } else {
      flamethrowerGlow = clamp(flamethrowerGlow - 0.08, 0, 1);
    }

    flamethrowerLight.intensity =
      lerp(0, 8.6, flamethrowerGlow) * lerp(0.92, 1.12, Math.random());
    flamethrowerLight.distance = lerp(0, 28, flamethrowerGlow);
  }

  function updateWeaponSystem(inputs, currentTime, dt = 0.016) {
    const weapon = getCurrentWeapon();
    const flamethrowerActive = weapon.id === 'flamethrower' && inputs.fire;

    updateFlamethrowerFeedback(flamethrowerActive);

    if (inputs.fire) {
      fire(currentTime);
    }

    updateBullets();
    updateMissiles(dt);
    updateFlamethrowerParticles(currentTime, dt, flamethrowerActive);
    updateFlamethrowerSmoke();
    updateDust();
    updateRecoil();

    if (world && world.performanceStats) {
      world.performanceStats.activeProjectiles +=
        bullets.length + missiles.length;
      world.performanceStats.particleCount +=
        dustParticles.length + flameJets.length + flameSmoke.length;
    }

    return getUiState();
  }

  return {
    cycleWeapon,
    getCurrentWeapon,
    setWeapon,
    update: updateWeaponSystem,
    getUiState,
  };
}
