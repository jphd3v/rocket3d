import { Quaternion, Vector3 } from 'three';
import { raycastVoxelSegment } from './voxel-ray-traversal.js';
import { ROCKET_VOXEL_SIZE, ROCKET_VOXELS } from './rocket-voxels.js';
import {
  getRocketForwardVector,
  getRocketRightVector,
  getRocketUpVector,
} from './rocket-orientation.js';
import { getVoxel, voxelToWorldCoord, worldToVoxelCoord } from './voxel.js';
import { isVoxelSolid } from './voxel-materials.js';

function addUniqueCollisionPoint(points, pointKeys, x, y, z) {
  const key = `${x},${y},${z}`;
  if (pointKeys.has(key)) {
    return;
  }
  pointKeys.add(key);
  points.push({ x, y, z });
}

function addVoxelCollisionPoints(points, pointKeys, voxel) {
  const halfSize = ROCKET_VOXEL_SIZE * 0.5;
  const centerX = voxel.x * ROCKET_VOXEL_SIZE;
  const centerY = voxel.y * ROCKET_VOXEL_SIZE;
  const centerZ = voxel.z * ROCKET_VOXEL_SIZE;

  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX - halfSize,
    centerY - halfSize,
    centerZ - halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX + halfSize,
    centerY - halfSize,
    centerZ - halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX - halfSize,
    centerY - halfSize,
    centerZ + halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX + halfSize,
    centerY - halfSize,
    centerZ + halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX - halfSize,
    centerY + halfSize,
    centerZ - halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX + halfSize,
    centerY + halfSize,
    centerZ - halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX - halfSize,
    centerY + halfSize,
    centerZ + halfSize
  );
  addUniqueCollisionPoint(
    points,
    pointKeys,
    centerX + halfSize,
    centerY + halfSize,
    centerZ + halfSize
  );
  addUniqueCollisionPoint(points, pointKeys, centerX, centerY, centerZ);
}

// Rocket collision shape definition
function getRocketCollisionPoints() {
  const collisionPoints = [];
  const pointKeys = new Set();

  for (const voxel of ROCKET_VOXELS) {
    addVoxelCollisionPoints(collisionPoints, pointKeys, voxel);
  }

  return collisionPoints;
}

function updateRotationAxisInput(axisState, targetInput, easeStep) {
  const targetDirection = Math.sign(targetInput);
  const targetStrength = Math.abs(targetInput);

  if (targetDirection === 0 || targetStrength === 0) {
    axisState.direction = 0;
    axisState.strength = 0;
    return 0;
  }

  if (targetDirection !== axisState.direction) {
    axisState.direction = targetDirection;
    axisState.strength = 0;
  }

  axisState.strength = Math.min(targetStrength, axisState.strength + easeStep);
  return axisState.direction * axisState.strength;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function createCollisionResultSlot(maxCollisionPoints) {
  const collisionHits = [];

  for (let i = 0; i < maxCollisionPoints; i++) {
    collisionHits.push({
      point: new Vector3(),
      normal: new Vector3(),
    });
  }

  collisionHits.count = 0;

  return {
    hasCollision: false,
    collisionHits,
    collisionNormalVector: new Vector3(),
    collisionNormal: null,
  };
}

function createOverlapResultSlot() {
  return {
    hasOverlap: false,
    escapeNormalVector: new Vector3(),
    escapeNormal: null,
  };
}

export function initPhysics(
  invMaxFps,
  rocket,
  scene,
  world = null,
  audioSystem = null
) {
  const speedMultiplier = invMaxFps * 60; // 60 FPS equals "1", 30 FPS would be twice the speed, etc.
  const velocity = new Vector3(0, 0, 0);
  const rotationVector = new Vector3(0, 0, 0);
  const tmpQuaternion = new Quaternion();
  const movementSpeed = 0.15;
  const rotationSpeed = 0.013;
  const rotationEaseInStep = 0.025;
  const thrustAcceleration = 0.0162;
  const brakeDamping = 1.2;
  const minScrapeDamage = 1;
  const minCollisionDamage = 4;
  const maxCollisionDamage = 28;
  const minRotationCollisionDamage = 1;
  const maxRotationCollisionDamage = 4;
  const damageImpactThreshold = 0.55;
  const damageImpactScale = 7.5;
  const scrapeImpactThreshold = 0.12;
  const scrapeImpactScale = 3.4;
  const minShakeDurationMs = 130;
  const maxShakeDurationMs = 320;
  const maxShakeOffset = 1.02;
  const maxShakeAngle = 0.48;
  const minHitStopMs = 0;
  const maxHitStopMs = 0;
  const selfDamageHitStopMinMs = 40;
  const selfDamageHitStopMaxMs = 120;
  const selfDamageFeedbackCooldownMs = 220;
  const collisionFeedbackCooldown = 180;
  const sameSurfaceFeedbackCooldown = 220;
  const moveMult = speedMultiplier * movementSpeed;
  const rotMult = speedMultiplier * rotationSpeed;
  const friction = 0.9933;
  const angularDamping = 0.94;
  const acceleration = new Vector3(0, 0, 0);
  const maxSpeed = 11.52;
  const directionVector = new Vector3(0, 0, 1);
  const pitchRotationState = { direction: 0, strength: 0 };
  const rollRotationState = { direction: 0, strength: 0 };
  const rocketVisual = rocket.userData.visualMesh || rocket;
  const baseRocketVisualPosition = rocketVisual.position.clone();
  const baseRocketVisualRotation = rocketVisual.rotation.clone();
  const baseRocketQuaternion = rocket.quaternion.clone();
  let shakeTimeRemainingMs = 0;
  let shakeDurationMs = 0;
  let shakeStrength = 0;
  let hitStopTimeRemainingMs = 0;
  let flashTimeRemainingMs = 0;
  let flashDurationMs = 0;
  let collisionThrustDegradation = 0;
  let collisionTurnDegradation = 0;
  let collisionVelocityDampening = 0;
  let lastSameSurfaceFeedbackTime = Number.NEGATIVE_INFINITY;
  let lastCollisionSurfaceNormal = null;
  let active = true;
  let invulnerable = false;

  // Collision and damage system
  let health = 100; // Rocket health
  let lastCollisionTime = 0;
  let lastRotationCollisionTime = 0;
  let lastCollisionFeedbackTime = Number.NEGATIVE_INFINITY;
  let lastSelfDamageFeedbackTime = Number.NEGATIVE_INFINITY;
  const collisionCooldown = 220; // ms between collisions
  const rotationCollisionCooldown = 160;
  const collisionSweepPadding = 0.22;
  const minMovementForCollisionSq = 1e-6;
  const leadingPointBand = 2.5;
  const maxCollisionPoints = 4;
  const maxMovementPerStep = 0.6;
  const collisionResultPoolSize = 16;
  const overlapResultPoolSize = 16;
  const movementDelta = new Vector3();
  const intendedMovement = new Vector3();
  const stepMovement = new Vector3();
  const slideMovement = new Vector3();
  const candidatePosition = new Vector3();
  const slideCandidatePosition = new Vector3();
  const startPoint = new Vector3();
  const endPoint = new Vector3();
  const localMoveDirection = new Vector3();
  const inverseRocketRotation = new Quaternion();
  const hitVoxelKeys = new Set();
  const collisionNormal = new Vector3();
  const collisionNudgeCandidate = new Vector3();
  const worldForward = new Vector3();
  const worldUp = new Vector3();
  const worldRight = new Vector3();
  const previousQuaternion = new Quaternion();
  const proposedQuaternion = new Quaternion();
  const overlapEscapeNormal = new Vector3();
  const overlapSampleWorld = new Vector3();
  const overlapVoxelCenter = new Vector3();
  const overlapOffset = new Vector3();
  const rotationNudgeDirection = new Vector3();
  const rotationNudgeCandidate = new Vector3();
  const unitUp = new Vector3(0, 1, 0);
  const emptyCollisionHits = [];
  const emptyInputs = {};
  const collisionCandidateDirections = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ];
  const rotationCandidateDirections = [
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
    new Vector3(),
  ];
  const collisionResults = [];
  const overlapResults = [];
  let collisionResultCursor = 0;
  let overlapResultCursor = 0;
  const minSlideMovementSq = 1e-5;
  const lowSpeedAssistThreshold = 0.65;
  const nudgeDistances = [0.12, 0.24, 0.36, 0.52];
  const rotationNudgeDistances = [0.08, 0.16, 0.28, 0.42];
  const physicsState = {
    velocity,
    health: 100,
    active: true,
    destroyed: false,
    hitStopActive: false,
  };

  for (let i = 0; i < collisionResultPoolSize; i++) {
    collisionResults.push(createCollisionResultSlot(maxCollisionPoints));
  }

  for (let i = 0; i < overlapResultPoolSize; i++) {
    overlapResults.push(createOverlapResultSlot());
  }

  // Get rocket collision points once for efficiency
  const rocketCollisionPoints = getRocketCollisionPoints();

  function getNextCollisionResult() {
    const result = collisionResults[collisionResultCursor];
    collisionResultCursor =
      (collisionResultCursor + 1) % collisionResultPoolSize;
    result.hasCollision = false;
    result.collisionHits.count = 0;
    result.collisionNormal = null;
    result.collisionNormalVector.set(0, 0, 0);
    return result;
  }

  function getNextOverlapResult() {
    const result = overlapResults[overlapResultCursor];
    overlapResultCursor = (overlapResultCursor + 1) % overlapResultPoolSize;
    result.hasOverlap = false;
    result.escapeNormal = null;
    result.escapeNormalVector.set(0, 0, 0);
    return result;
  }

  // Check collision with cave walls using fast voxel ray traversal.
  function checkCollision(newPosition) {
    const collisionResult = getNextCollisionResult();

    // If no world data is available, no collision
    if (!world) {
      return collisionResult;
    }

    movementDelta.subVectors(newPosition, rocket.position);
    if (movementDelta.lengthSq() < minMovementForCollisionSq) {
      return collisionResult;
    }

    // Check leading collision samples first, based on movement direction in
    // rocket-local coordinates, to reduce traversal rays.
    localMoveDirection.copy(movementDelta).normalize();
    inverseRocketRotation.copy(rocket.quaternion).invert();
    localMoveDirection.applyQuaternion(inverseRocketRotation);

    let maxProjection = Number.NEGATIVE_INFINITY;
    for (const localPoint of rocketCollisionPoints) {
      const projection =
        localPoint.x * localMoveDirection.x +
        localPoint.y * localMoveDirection.y +
        localPoint.z * localMoveDirection.z;
      if (projection > maxProjection) {
        maxProjection = projection;
      }
    }

    const projectionThreshold = maxProjection - leadingPointBand;
    hitVoxelKeys.clear();

    // Move each collision sample through the voxel grid and collect first hits.
    for (const localPoint of rocketCollisionPoints) {
      const projection =
        localPoint.x * localMoveDirection.x +
        localPoint.y * localMoveDirection.y +
        localPoint.z * localMoveDirection.z;
      if (projection < projectionThreshold) {
        continue;
      }

      startPoint.set(localPoint.x, localPoint.y, localPoint.z);
      startPoint.applyQuaternion(rocket.quaternion);
      startPoint.add(rocket.position);

      endPoint.copy(startPoint);
      endPoint.add(movementDelta);

      const hit = raycastVoxelSegment(
        world,
        startPoint,
        endPoint,
        collisionSweepPadding
      );

      if (hit) {
        const hitKey = `${hit.voxelX},${hit.voxelY},${hit.voxelZ}`;
        if (hitVoxelKeys.has(hitKey)) {
          continue;
        }
        hitVoxelKeys.add(hitKey);

        const hitEntry =
          collisionResult.collisionHits[collisionResult.collisionHits.count];
        hitEntry.point.set(
          voxelToWorldCoord(world, hit.voxelX + 0.5),
          voxelToWorldCoord(world, hit.voxelY + 0.5),
          voxelToWorldCoord(world, hit.voxelZ + 0.5)
        );
        hitEntry.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        collisionResult.collisionHits.count++;

        if (collisionResult.collisionHits.count >= maxCollisionPoints) {
          break;
        }
      }
    }

    if (collisionResult.collisionHits.count <= 0) {
      return collisionResult;
    }

    collisionResult.collisionNormalVector.set(0, 0, 0);
    for (let i = 0; i < collisionResult.collisionHits.count; i++) {
      collisionResult.collisionNormalVector.add(
        collisionResult.collisionHits[i].normal
      );
    }
    if (
      collisionResult.collisionNormalVector.lengthSq() <=
      minMovementForCollisionSq
    ) {
      collisionResult.collisionNormalVector
        .copy(movementDelta)
        .normalize()
        .multiplyScalar(-1);
    } else {
      collisionResult.collisionNormalVector.normalize();
    }

    collisionResult.hasCollision = true;
    collisionResult.collisionNormal = collisionResult.collisionNormalVector;
    return collisionResult;
  }

  function moveRocketOutOfCollision(escapeNormal) {
    if (!escapeNormal || escapeNormal.lengthSq() <= minMovementForCollisionSq) {
      return false;
    }

    getRocketForwardVector(rocket, worldForward);
    getRocketUpVector(rocket, worldUp);
    getRocketRightVector(rocket, worldRight);

    collisionCandidateDirections[0].copy(escapeNormal);
    collisionCandidateDirections[1]
      .copy(escapeNormal)
      .addScaledVector(worldUp, 0.22);
    collisionCandidateDirections[2]
      .copy(escapeNormal)
      .addScaledVector(worldUp, -0.18);
    collisionCandidateDirections[3]
      .copy(escapeNormal)
      .addScaledVector(worldRight, 0.2);
    collisionCandidateDirections[4]
      .copy(escapeNormal)
      .addScaledVector(worldRight, -0.2);

    for (const direction of collisionCandidateDirections) {
      if (direction.lengthSq() <= minMovementForCollisionSq) {
        continue;
      }

      direction.normalize();
      for (const distance of nudgeDistances) {
        collisionNudgeCandidate
          .copy(rocket.position)
          .addScaledVector(direction, distance);

        const nudgeCollision = checkCollision(collisionNudgeCandidate);
        if (!nudgeCollision.hasCollision) {
          rocket.position.copy(collisionNudgeCandidate);
          return true;
        }
      }
    }

    return false;
  }

  function getRotationOverlapInfo(position, quaternion) {
    const overlapInfo = getNextOverlapResult();

    if (!world) {
      return overlapInfo;
    }

    let overlapCount = 0;
    overlapEscapeNormal.set(0, 0, 0);

    for (const localPoint of rocketCollisionPoints) {
      overlapSampleWorld.set(localPoint.x, localPoint.y, localPoint.z);
      overlapSampleWorld.applyQuaternion(quaternion);
      overlapSampleWorld.add(position);

      const voxelX = Math.floor(worldToVoxelCoord(world, overlapSampleWorld.x));
      const voxelY = Math.floor(worldToVoxelCoord(world, overlapSampleWorld.y));
      const voxelZ = Math.floor(worldToVoxelCoord(world, overlapSampleWorld.z));

      if (!isVoxelSolid(getVoxel(world, voxelX, voxelY, voxelZ))) {
        continue;
      }

      overlapCount++;
      overlapVoxelCenter.set(
        voxelToWorldCoord(world, voxelX + 0.5),
        voxelToWorldCoord(world, voxelY + 0.5),
        voxelToWorldCoord(world, voxelZ + 0.5)
      );
      overlapOffset.subVectors(overlapSampleWorld, overlapVoxelCenter);

      if (overlapOffset.lengthSq() <= minMovementForCollisionSq) {
        overlapEscapeNormal.y += 1;
      } else {
        overlapEscapeNormal.add(overlapOffset.normalize());
      }
    }

    if (overlapCount <= 0) {
      return overlapInfo;
    }

    if (overlapEscapeNormal.lengthSq() <= minMovementForCollisionSq) {
      overlapEscapeNormal.set(0, 1, 0);
    } else {
      overlapEscapeNormal.normalize();
    }

    overlapInfo.hasOverlap = true;
    overlapInfo.escapeNormalVector.copy(overlapEscapeNormal);
    overlapInfo.escapeNormal = overlapInfo.escapeNormalVector;
    return overlapInfo;
  }

  function canResolveRotationOverlap(position, quaternion, escapeNormal) {
    rotationNudgeDirection.copy(escapeNormal || worldUp);
    if (rotationNudgeDirection.lengthSq() <= minMovementForCollisionSq) {
      rotationNudgeDirection.set(0, 1, 0);
    } else {
      rotationNudgeDirection.normalize();
    }

    worldForward.set(0, 0, 1).applyQuaternion(quaternion).normalize();
    worldRight.crossVectors(worldForward, unitUp).normalize();

    rotationCandidateDirections[0].copy(rotationNudgeDirection);
    rotationCandidateDirections[1]
      .copy(rotationNudgeDirection)
      .add(unitUp)
      .normalize();
    rotationCandidateDirections[2].copy(unitUp);
    rotationCandidateDirections[3].copy(worldForward);
    rotationCandidateDirections[4].copy(worldForward).negate();
    rotationCandidateDirections[5].copy(worldRight);

    for (let i = 0; i < rotationCandidateDirections.length; i++) {
      const direction = rotationCandidateDirections[i];

      if (i === rotationCandidateDirections.length - 1) {
        direction.copy(worldRight).negate();
      }

      if (direction.lengthSq() <= minMovementForCollisionSq) {
        continue;
      }

      direction.normalize();
      for (const distance of rotationNudgeDistances) {
        rotationNudgeCandidate
          .copy(position)
          .addScaledVector(direction, distance);
        const overlapInfo = getRotationOverlapInfo(
          rotationNudgeCandidate,
          quaternion
        );
        if (!overlapInfo.hasOverlap) {
          rocket.position.copy(rotationNudgeCandidate);
          return true;
        }
      }
    }

    return false;
  }

  function applyRotationWithCollision(nextQuaternion) {
    const overlapInfo = getRotationOverlapInfo(rocket.position, nextQuaternion);
    if (!overlapInfo.hasOverlap) {
      rocket.quaternion.copy(nextQuaternion);
      return true;
    }

    if (
      canResolveRotationOverlap(
        rocket.position,
        nextQuaternion,
        overlapInfo.escapeNormal
      )
    ) {
      rocket.quaternion.copy(nextQuaternion);
      return true;
    }

    return false;
  }

  function startCollisionShake(impactStrength) {
    shakeStrength = Math.max(shakeStrength, impactStrength);
    shakeDurationMs = Math.max(
      shakeDurationMs,
      minShakeDurationMs +
        (maxShakeDurationMs - minShakeDurationMs) * impactStrength
    );
    shakeTimeRemainingMs = shakeDurationMs;
  }

  function startSelfDamageHitStop(impactStrength) {
    var severity = clamp(impactStrength, 0, 1);
    hitStopTimeRemainingMs = Math.max(
      hitStopTimeRemainingMs,
      selfDamageHitStopMinMs +
        (selfDamageHitStopMaxMs - selfDamageHitStopMinMs) * severity
    );
  }

  function startCollisionFlash(impactStrength) {
    flashDurationMs = Math.max(flashDurationMs, 90 + 120 * impactStrength);
    flashTimeRemainingMs = flashDurationMs;
  }

  function clearRotationInput() {
    pitchRotationState.direction = 0;
    pitchRotationState.strength = 0;
    rollRotationState.direction = 0;
    rollRotationState.strength = 0;
    rotationVector.x = 0;
    rotationVector.y = 0;
    rotationVector.z = 0;
  }

  function updateCollisionFlash() {
    const flashStrength =
      flashDurationMs > 0
        ? clamp(flashTimeRemainingMs / flashDurationMs, 0, 1)
        : 0;

    rocket.material.color.setRGB(
      1,
      1 - 0.1 * (1 - flashStrength),
      1 - 0.18 * (1 - flashStrength)
    );
    rocket.material.emissive.setRGB(
      0.22 + flashStrength * 1.2,
      0.08 + flashStrength * 1.05,
      0.08 + flashStrength * 1.0
    );
    rocket.material.emissiveIntensity = 0.35 + flashStrength * 1.8;

    if (flashTimeRemainingMs <= 0) {
      flashDurationMs = 0;
      return;
    }

    flashTimeRemainingMs = Math.max(0, flashTimeRemainingMs - invMaxFps * 1000);
  }

  function updateCollisionShake() {
    rocketVisual.position.copy(baseRocketVisualPosition);
    rocketVisual.rotation.copy(baseRocketVisualRotation);

    if (
      shakeTimeRemainingMs <= 0 ||
      shakeDurationMs <= 0 ||
      shakeStrength <= 0
    ) {
      return;
    }

    const progress = shakeTimeRemainingMs / shakeDurationMs;
    const oscillation = Math.sin((1 - progress) * Math.PI * 10);
    const amplitude = shakeStrength * progress * oscillation;

    rocketVisual.position.x += maxShakeOffset * amplitude;
    rocketVisual.rotation.z += maxShakeAngle * amplitude * 0.35;

    shakeTimeRemainingMs = Math.max(0, shakeTimeRemainingMs - invMaxFps * 1000);
    if (shakeTimeRemainingMs === 0) {
      shakeDurationMs = 0;
      shakeStrength = 0;
    }
  }

  function getCollisionImpactStrength(speed, collisionResponseNormal) {
    if (
      !collisionResponseNormal ||
      collisionResponseNormal.lengthSq() <= minMovementForCollisionSq
    ) {
      return clamp(speed / damageImpactScale, 0, 1);
    }

    const inwardSpeed = Math.max(0, -velocity.dot(collisionResponseNormal));
    return clamp(
      (inwardSpeed - damageImpactThreshold) /
        (damageImpactScale - damageImpactThreshold),
      0,
      1
    );
  }

  function getScrapeImpactStrength(speed, collisionResponseNormal) {
    if (
      !collisionResponseNormal ||
      collisionResponseNormal.lengthSq() <= minMovementForCollisionSq
    ) {
      return clamp(
        (speed - scrapeImpactThreshold) /
          (scrapeImpactScale - scrapeImpactThreshold),
        0,
        1
      );
    }

    const contactSpeed = Math.abs(velocity.dot(collisionResponseNormal));
    const lateralSpeed = Math.max(
      0,
      Math.sqrt(Math.max(0, speed * speed - contactSpeed * contactSpeed))
    );

    return clamp(
      (lateralSpeed - scrapeImpactThreshold) /
        (scrapeImpactScale - scrapeImpactThreshold),
      0,
      1
    );
  }

  function applyCollisionFeedback(
    collisionHits,
    strength,
    collisionSpeed,
    currentTime = Date.now()
  ) {
    var collisionResponseNormal =
      collisionHits && collisionHits.length > 0
        ? collisionHits[0].normal
        : null;

    var timeSinceSameSurface = currentTime - lastSameSurfaceFeedbackTime;
    var isSameSurface =
      collisionResponseNormal &&
      lastCollisionSurfaceNormal &&
      collisionResponseNormal.dot(lastCollisionSurfaceNormal) > 0.85;

    if (isSameSurface && timeSinceSameSurface < sameSurfaceFeedbackCooldown) {
      return false;
    }

    if (
      currentTime - lastCollisionFeedbackTime < collisionFeedbackCooldown ||
      shakeTimeRemainingMs > 0
    ) {
      return false;
    }

    lastCollisionFeedbackTime = currentTime;
    lastSameSurfaceFeedbackTime = currentTime;
    if (collisionResponseNormal) {
      lastCollisionSurfaceNormal = collisionResponseNormal.clone();
    }

    var severity = clamp(strength, 0, 1);

    if (severity < 0.25) {
      startCollisionShake(severity * 0.5);
      if (audioSystem) {
        audioSystem.playCollision(collisionSpeed * (0.3 + severity * 0.4));
      }
      return true;
    }

    var stunMs = lerp(minHitStopMs, maxHitStopMs, severity);
    hitStopTimeRemainingMs = Math.max(hitStopTimeRemainingMs, stunMs);

    var velocityLoss = lerp(0.85, 0.35, severity);
    velocity.multiplyScalar(velocityLoss);

    collisionThrustDegradation = lerp(0, 0.5, severity);
    collisionTurnDegradation = lerp(0, 0.6, severity);
    collisionVelocityDampening = lerp(0, 0.3, severity);

    startCollisionShake(severity);
    startCollisionFlash(severity);

    if (audioSystem) {
      audioSystem.playCollision(collisionSpeed * (0.45 + severity * 0.55));
    }

    return true;
  }

  function getPhysicsState() {
    physicsState.health = health;
    physicsState.active = active;
    physicsState.destroyed = !active && health <= 0;
    physicsState.hitStopActive = hitStopTimeRemainingMs > 0;
    return physicsState;
  }

  function clearFeedbackState() {
    shakeTimeRemainingMs = 0;
    shakeDurationMs = 0;
    shakeStrength = 0;
    hitStopTimeRemainingMs = 0;
    flashTimeRemainingMs = 0;
    flashDurationMs = 0;
    collisionThrustDegradation = 0;
    collisionTurnDegradation = 0;
    collisionVelocityDampening = 0;
    rocketVisual.position.copy(baseRocketVisualPosition);
    rocketVisual.rotation.copy(baseRocketVisualRotation);
    rocket.material.color.setRGB(1, 1, 1);
    rocket.material.emissive.setRGB(0.22, 0.08, 0.08);
    rocket.material.emissiveIntensity = 0.35;
  }

  function setActive(nextActive) {
    active = Boolean(nextActive);

    if (!active) {
      clearRotationInput();
      clearFeedbackState();
      velocity.set(0, 0, 0);
      acceleration.set(0, 0, 0);
    }

    return getPhysicsState();
  }

  function setInvulnerable(nextInvulnerable) {
    invulnerable = Boolean(nextInvulnerable);
    return getPhysicsState();
  }

  function resetState(position = null) {
    health = 100;
    clearFeedbackState();
    clearRotationInput();
    velocity.set(0, 0, 0);
    acceleration.set(0, 0, 0);
    rocket.quaternion.copy(baseRocketQuaternion);
    rocket.rotation.setFromQuaternion(rocket.quaternion, rocket.rotation.order);
    rocketVisual.position.copy(baseRocketVisualPosition);
    rocketVisual.rotation.copy(baseRocketVisualRotation);
    lastCollisionTime = 0;
    lastRotationCollisionTime = 0;
    lastCollisionFeedbackTime = Number.NEGATIVE_INFINITY;
    lastSelfDamageFeedbackTime = Number.NEGATIVE_INFINITY;

    if (position) {
      rocket.position.copy(position);
    }

    active = true;
    return getPhysicsState();
  }

  function applyImpulse(impulse) {
    if (!active || !impulse || impulse.lengthSq() <= 0) {
      return;
    }

    velocity.add(impulse);
  }

  function applySelfDamage(amount = 0, impactStrength = 0.3) {
    const damage = Math.max(0, Math.round(amount));
    const clampedImpactStrength = clamp(impactStrength, 0, 1);
    const currentTime = Date.now();

    if (health <= 0 || invulnerable) {
      return getPhysicsState();
    }

    if (damage > 0) {
      health = Math.max(0, health - damage);
    }

    if (
      clampedImpactStrength > 0 &&
      currentTime - lastSelfDamageFeedbackTime >= selfDamageFeedbackCooldownMs
    ) {
      lastSelfDamageFeedbackTime = currentTime;
      startCollisionShake(0.14 + clampedImpactStrength * 0.22);
      startSelfDamageHitStop(clampedImpactStrength);
      startCollisionFlash(0.12 + clampedImpactStrength * 0.28);
    }

    return getPhysicsState();
  }

  function restoreHealth(amount = 0) {
    const healAmount = Math.max(0, amount);

    if (healAmount <= 0 || health >= 100) {
      return getPhysicsState();
    }

    health = Math.min(100, health + healAmount);

    return getPhysicsState();
  }

  function stabilizeDockedState(position = null, quaternion = null) {
    if (!active) {
      return getPhysicsState();
    }

    clearRotationInput();
    clearFeedbackState();
    velocity.set(0, 0, 0);
    acceleration.set(0, 0, 0);

    if (position) {
      rocket.position.copy(position);
    }

    if (quaternion) {
      rocket.quaternion.copy(quaternion);
      rocket.rotation.setFromQuaternion(
        rocket.quaternion,
        rocket.rotation.order
      );
    }

    return getPhysicsState();
  }

  function suppressCollisionFeedback(durationMs = 0) {
    const duration = Math.max(0, durationMs);
    if (duration <= 0) {
      return getPhysicsState();
    }

    const currentTime = Date.now();
    lastCollisionFeedbackTime = currentTime + duration;
    lastCollisionTime = currentTime + duration;
    lastRotationCollisionTime = currentTime + duration;
    return getPhysicsState();
  }

  // Handle collision response
  function handleCollision(
    collisionHits = emptyCollisionHits,
    resolvedNormal = null,
    inputs = emptyInputs
  ) {
    const currentTime = Date.now();
    const speed = velocity.length();
    const collisionResponseNormal = resolvedNormal || collisionNormal;
    const impactStrength = getCollisionImpactStrength(
      speed,
      collisionResponseNormal
    );
    const scrapeImpactStrength = getScrapeImpactStrength(
      speed,
      collisionResponseNormal
    );
    const damage = Math.round(
      minCollisionDamage +
        (maxCollisionDamage - minCollisionDamage) * impactStrength
    );
    const scrapeDamage = Math.round(
      minScrapeDamage +
        (minCollisionDamage - minScrapeDamage) * scrapeImpactStrength
    );

    if (
      collisionResponseNormal &&
      collisionResponseNormal.lengthSq() > minMovementForCollisionSq
    ) {
      const inwardVelocity = velocity.dot(collisionResponseNormal);
      if (inwardVelocity < 0) {
        velocity.addScaledVector(collisionResponseNormal, -inwardVelocity);
      }

      const thrustInput = typeof inputs.thrust === 'number' ? inputs.thrust : 0;
      const assistStrength =
        speed < lowSpeedAssistThreshold
          ? thrustInput > 0.01
            ? 0.16
            : 0.09
          : thrustInput > 0.01
            ? 0.08
            : 0.03;
      velocity.addScaledVector(collisionResponseNormal, assistStrength);
      velocity.multiplyScalar(0.9);
      moveRocketOutOfCollision(collisionResponseNormal);
    }

    // Check collision cooldown
    if (currentTime - lastCollisionTime < collisionCooldown) {
      return;
    }

    lastCollisionTime = currentTime;

    if (collisionResponseNormal) {
      const bounceStrength = speed > 1.1 ? 0.12 : 0.03;
      velocity.addScaledVector(collisionResponseNormal, bounceStrength);
    } else {
      velocity.multiplyScalar(-0.12);
    }

    // Apply damage
    if (impactStrength > 0) {
      if (invulnerable) {
        return;
      }

      health = Math.max(0, health - damage);
      applyCollisionFeedback(
        collisionHits,
        Math.max(0.5, impactStrength),
        speed,
        currentTime
      );
      return;
    }

    if (scrapeImpactStrength > 0) {
      if (invulnerable) {
        return;
      }

      health = Math.max(0, health - scrapeDamage);
      applyCollisionFeedback(
        collisionHits,
        0.28 + scrapeImpactStrength * 0.35,
        speed * 0.65,
        currentTime
      );
    }
  }

  function handleRotationCollision(overlapInfo) {
    const currentTime = Date.now();
    const rotationSpeed =
      Math.abs(rotationVector.x) + Math.abs(rotationVector.z);
    const movementSpeed = velocity.length();
    const impactStrength = clamp(
      rotationSpeed * 1.9 + movementSpeed * 0.08,
      0,
      1
    );

    clearRotationInput();

    if (currentTime - lastRotationCollisionTime < rotationCollisionCooldown) {
      if (overlapInfo && overlapInfo.escapeNormal) {
        moveRocketOutOfCollision(overlapInfo.escapeNormal);
      }

      return;
    }

    lastRotationCollisionTime = currentTime;
    if (invulnerable) {
      return;
    }

    health = Math.max(
      0,
      health -
        Math.round(
          minRotationCollisionDamage +
            (maxRotationCollisionDamage - minRotationCollisionDamage) *
              impactStrength
        )
    );
    applyCollisionFeedback(
      emptyCollisionHits,
      0.32 + impactStrength * 0.3,
      Math.max(0.6, movementSpeed * 0.4 + rotationSpeed * 3.2),
      currentTime
    );

    if (overlapInfo && overlapInfo.escapeNormal) {
      moveRocketOutOfCollision(overlapInfo.escapeNormal);
    }
  }

  function moveRocketWithCollision(totalMovement, inputs = emptyInputs) {
    const movementLength = totalMovement.length();
    const stepCount = Math.max(
      1,
      Math.ceil(movementLength / maxMovementPerStep)
    );

    stepMovement.copy(totalMovement).divideScalar(stepCount);

    for (let i = 0; i < stepCount; i++) {
      candidatePosition.copy(rocket.position).add(stepMovement);
      const collisionResult = checkCollision(candidatePosition);

      if (collisionResult.hasCollision) {
        if (
          collisionResult.collisionNormal &&
          collisionResult.collisionNormal.lengthSq() > minMovementForCollisionSq
        ) {
          const inwardStep = stepMovement.dot(collisionResult.collisionNormal);
          if (inwardStep < 0) {
            slideMovement
              .copy(stepMovement)
              .addScaledVector(collisionResult.collisionNormal, -inwardStep);

            if (slideMovement.lengthSq() > minSlideMovementSq) {
              slideCandidatePosition.copy(rocket.position).add(slideMovement);
              const slideCollision = checkCollision(slideCandidatePosition);
              if (!slideCollision.hasCollision) {
                rocket.position.copy(slideCandidatePosition);
                continue;
              }
            }
          }
        }

        handleCollision(
          collisionResult.collisionHits,
          collisionResult.collisionNormal,
          inputs
        );
        return false;
      }

      rocket.position.copy(candidatePosition);
    }

    return true;
  }

  // Add visual collision effect
  function updateCollisionParticles() {}

  function applyControlInputs(inputs) {
    updateCollisionParticles();
    updateCollisionShake();
    updateCollisionFlash();

    if (!active) {
      return getPhysicsState();
    }

    if (hitStopTimeRemainingMs > 0) {
      hitStopTimeRemainingMs = Math.max(
        0,
        hitStopTimeRemainingMs - invMaxFps * 1000
      );
      collisionThrustDegradation *= 0.9;
      collisionTurnDegradation *= 0.9;
      collisionVelocityDampening *= 0.92;
      return getPhysicsState();
    }

    collisionThrustDegradation *= 0.92;
    collisionTurnDegradation *= 0.92;
    collisionVelocityDampening *= 0.94;

    const thrustInput = clamp(
      typeof inputs.thrust === 'number' ? inputs.thrust : 0,
      0,
      1
    );
    const brakeInput = clamp(
      typeof inputs.brake === 'number' ? inputs.brake : 0,
      0,
      1
    );

    getRocketForwardVector(rocket, directionVector);

    var effectiveThrust = thrustInput * (1 - collisionThrustDegradation);
    if (effectiveThrust > 0) {
      acceleration
        .copy(directionVector)
        .multiplyScalar(thrustAcceleration * effectiveThrust);
    } else {
      acceleration.set(0, 0, 0);
    }

    velocity.add(acceleration);
    velocity.multiplyScalar(friction);

    if (collisionVelocityDampening > 0.01) {
      velocity.multiplyScalar(1 - collisionVelocityDampening * invMaxFps * 2);
    }

    if (brakeInput > 0) {
      velocity.multiplyScalar(
        Math.max(0, 1 - brakeDamping * brakeInput * invMaxFps)
      );
    }

    // Apply speed limit (no longer affected by health)
    velocity.clampScalar(-maxSpeed, maxSpeed);

    const pitchInput = clamp(
      (typeof inputs.pitchDown === 'number' ? inputs.pitchDown : 0) -
        (typeof inputs.pitchUp === 'number' ? inputs.pitchUp : 0),
      -1,
      1
    );
    const rollInput = clamp(
      (typeof inputs.rollRight === 'number' ? inputs.rollRight : 0) -
        (typeof inputs.rollLeft === 'number' ? inputs.rollLeft : 0),
      -1,
      1
    );

    var effectiveTurnMult = 1 - collisionTurnDegradation;

    rotationVector.x = updateRotationAxisInput(
      pitchRotationState,
      pitchInput * effectiveTurnMult,
      rotationEaseInStep
    );
    rotationVector.y = 0;
    rotationVector.z = updateRotationAxisInput(
      rollRotationState,
      rollInput * effectiveTurnMult,
      rotationEaseInStep
    );

    rotationVector.multiplyScalar(angularDamping);

    intendedMovement.set(
      velocity.x * moveMult,
      velocity.y * moveMult,
      velocity.z * moveMult
    );
    moveRocketWithCollision(intendedMovement, inputs);

    if (hitStopTimeRemainingMs > 0) {
      return getPhysicsState();
    }

    previousQuaternion.copy(rocket.quaternion);
    tmpQuaternion
      .set(
        rotationVector.x * rotMult,
        rotationVector.y * rotMult,
        rotationVector.z * rotMult,
        1
      )
      .normalize();
    proposedQuaternion.copy(previousQuaternion).multiply(tmpQuaternion);
    if (!applyRotationWithCollision(proposedQuaternion)) {
      rocket.quaternion.copy(previousQuaternion);
      handleRotationCollision(
        getRotationOverlapInfo(rocket.position, previousQuaternion)
      );
    }
    rocket.rotation.setFromQuaternion(rocket.quaternion, rocket.rotation.order);

    return getPhysicsState();
  }

  applyControlInputs.applyImpulse = applyImpulse;
  applyControlInputs.restoreHealth = restoreHealth;
  applyControlInputs.applySelfDamage = applySelfDamage;
  applyControlInputs.stabilizeDockedState = stabilizeDockedState;
  applyControlInputs.suppressCollisionFeedback = suppressCollisionFeedback;
  applyControlInputs.resetState = resetState;
  applyControlInputs.setActive = setActive;
  applyControlInputs.setInvulnerable = setInvulnerable;

  return applyControlInputs;
}
