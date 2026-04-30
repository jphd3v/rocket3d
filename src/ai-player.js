import * as THREE from 'three';
import { raycastVoxelSegment } from './voxel-ray-traversal.js';
import { getRocketForwardVector } from './rocket-orientation.js';

const AI_SIGHT_RANGE = 180;
const AI_FIRE_RANGE = 150;
const AI_BULLET_FIRE_DOT = 0.988;
const AI_MISSILE_FIRE_DOT = 0.972;
const AI_FLAME_FIRE_DOT = 0.9;
const AI_ROLL_DEAD_ZONE = 0.08;
const AI_PITCH_DEAD_ZONE = 0.05;
const AI_MIN_CHASE_DISTANCE = 18;
const AI_FLAME_RANGE = 22;
const AI_MISSILE_MIN_RANGE = 42;
const AI_MISSILE_MAX_RANGE = 145;
const AI_WAYPOINT_REACHED_DISTANCE = 24;
const AI_NAV_THRUST_DOT = 0.72;
const AI_PERCEPTION_INTERVAL_MS = 140;

const AI_LOCK_ACQUIRE_TIME_MS = 500;
const AI_LOCK_DECAY_TIME_MS = 500;
const AI_LOCK_GRACE_TIME_MS = 400;
const AI_LOCK_BREAK_ANGLE_DEG = 35;
const AI_LOCK_BREAK_ANGLE_RAD = (AI_LOCK_BREAK_ANGLE_DEG * Math.PI) / 180;

function createEmptyInputs() {
  return {
    rollLeft: 0,
    rollRight: 0,
    pitchDown: 0,
    pitchUp: 0,
    thrust: 0,
    brake: 0,
    fire: 0,
    weaponId: 'bullets',
  };
}

export function initAiPlayer(
  rocket,
  targetRocket,
  world,
  graph = null,
  aiIndex = 0
) {
  const inputs = createEmptyInputs();
  const chambers = graph && Array.isArray(graph.chambers) ? graph.chambers : [];
  const chamberConnections = buildChamberConnections(graph);
  const targetOffset = new THREE.Vector3();
  const targetDirection = new THREE.Vector3();
  const navigationOffset = new THREE.Vector3();
  const navigationDirection = new THREE.Vector3();
  const navigationPosition = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const localTargetDirection = new THREE.Vector3();
  const inverseRotation = new THREE.Quaternion();
  const sightStart = new THREE.Vector3();
  const sightEnd = new THREE.Vector3();
  const perceptionOffset = aiIndex * 70;
  let lastLineOfSightCheckTime = Number.NEGATIVE_INFINITY + perceptionOffset;
  let cachedHasLineOfSight = false;
  let currentAimDot = 0;
  let currentDistance = 0;
  let aiLockState = 'none';
  let aiLockStrength = 0;
  let aiLockGraceTimer = 0;

  function resetInputs() {
    inputs.rollLeft = 0;
    inputs.rollRight = 0;
    inputs.pitchDown = 0;
    inputs.pitchUp = 0;
    inputs.thrust = 0;
    inputs.brake = 0;
    inputs.fire = 0;
    inputs.weaponId = 'bullets';
  }

  function buildChamberConnections(sourceGraph) {
    const connections = new Map();

    if (!sourceGraph || !Array.isArray(sourceGraph.tunnels)) {
      return connections;
    }

    for (const tunnel of sourceGraph.tunnels) {
      if (!connections.has(tunnel.from)) {
        connections.set(tunnel.from, []);
      }
      if (!connections.has(tunnel.to)) {
        connections.set(tunnel.to, []);
      }

      connections.get(tunnel.from).push(tunnel.to);
      connections.get(tunnel.to).push(tunnel.from);
    }

    return connections;
  }

  function getNearestChamber(position) {
    let bestChamber = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (const chamber of chambers) {
      if (!chamber || !chamber.center) {
        continue;
      }

      const dx = position.x - chamber.center.x;
      const dy = position.y - chamber.center.y;
      const dz = position.z - chamber.center.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;

      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestChamber = chamber;
      }
    }

    return bestChamber;
  }

  function findNextChamberId(fromId, toId) {
    const queue = [fromId];
    const previousById = new Map();
    const visited = new Set([fromId]);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = chamberConnections.get(currentId) || [];

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);
        previousById.set(neighborId, currentId);

        if (neighborId === toId) {
          let stepId = toId;
          let previousId = previousById.get(stepId);

          while (previousId && previousId !== fromId) {
            stepId = previousId;
            previousId = previousById.get(stepId);
          }

          return stepId;
        }

        queue.push(neighborId);
      }
    }

    return toId;
  }

  function getChamberById(chamberId) {
    for (const chamber of chambers) {
      if (chamber.id === chamberId) {
        return chamber;
      }
    }

    return null;
  }

  function getNavigationPosition(hasLineOfSight, target) {
    if (hasLineOfSight || chambers.length <= 0) {
      return target.copy(targetRocket.position);
    }

    const currentChamber = getNearestChamber(rocket.position);
    const targetChamber = getNearestChamber(targetRocket.position);

    if (!currentChamber || !targetChamber) {
      return target.copy(targetRocket.position);
    }

    if (currentChamber.id === targetChamber.id) {
      return target.copy(targetRocket.position);
    }

    const nextChamberId = findNextChamberId(
      currentChamber.id,
      targetChamber.id
    );
    const nextChamber = getChamberById(nextChamberId);

    if (!nextChamber || !nextChamber.center) {
      return target.copy(targetRocket.position);
    }

    return target.set(
      nextChamber.center.x,
      nextChamber.center.y,
      nextChamber.center.z
    );
  }

  function canSeePosition(position, distance, currentTime) {
    if (!world || distance > AI_SIGHT_RANGE) {
      cachedHasLineOfSight = false;
      return false;
    }

    if (currentTime - lastLineOfSightCheckTime < AI_PERCEPTION_INTERVAL_MS) {
      return cachedHasLineOfSight;
    }

    sightStart.copy(rocket.position);
    sightEnd.copy(position);
    lastLineOfSightCheckTime = currentTime;
    cachedHasLineOfSight =
      raycastVoxelSegment(world, sightStart, sightEnd, 0.2) === null;

    return cachedHasLineOfSight;
  }

  function update(physicsState = {}, targetPhysicsState = {}, currentTime = 0) {
    resetInputs();

    if (
      physicsState.active === false ||
      targetPhysicsState.active === false ||
      !rocket.visible ||
      !targetRocket.visible
    ) {
      return inputs;
    }

    targetOffset.subVectors(targetRocket.position, rocket.position);
    const distance = targetOffset.length();
    currentDistance = distance;

    if (distance <= 0.001) {
      return inputs;
    }

    targetDirection.copy(targetOffset).divideScalar(distance);
    getRocketForwardVector(rocket, forward);
    const aimDot = forward.dot(targetDirection);
    currentAimDot = aimDot;
    const hasLineOfSight = canSeePosition(
      targetRocket.position,
      distance,
      currentTime
    );

    getNavigationPosition(hasLineOfSight, navigationPosition);
    navigationOffset.subVectors(navigationPosition, rocket.position);
    const navigationDistance = navigationOffset.length();

    if (navigationDistance <= 0.001) {
      return inputs;
    }

    navigationDirection.copy(navigationOffset).divideScalar(navigationDistance);
    const navigationAimDot = forward.dot(navigationDirection);

    inverseRotation.copy(rocket.quaternion).invert();
    localTargetDirection
      .copy(navigationDirection)
      .applyQuaternion(inverseRotation);

    if (localTargetDirection.x > AI_ROLL_DEAD_ZONE) {
      inputs.rollRight = 1;
    } else if (localTargetDirection.x < -AI_ROLL_DEAD_ZONE) {
      inputs.rollLeft = 1;
    }

    if (localTargetDirection.y > AI_PITCH_DEAD_ZONE) {
      inputs.pitchUp = 1;
    } else if (localTargetDirection.y < -AI_PITCH_DEAD_ZONE) {
      inputs.pitchDown = 1;
    } else {
      inputs.pitchDown = 1;
    }

    if (distance <= AI_FLAME_RANGE) {
      inputs.weaponId = 'flamethrower';
    } else if (distance <= 55) {
      inputs.weaponId = 'bullets';
    } else if (
      distance >= AI_MISSILE_MIN_RANGE &&
      distance <= AI_MISSILE_MAX_RANGE
    ) {
      inputs.weaponId = 'missile';
    }

    inputs.thrust =
      navigationDistance > AI_WAYPOINT_REACHED_DISTANCE &&
      distance > AI_MIN_CHASE_DISTANCE &&
      navigationAimDot >= AI_NAV_THRUST_DOT
        ? 1
        : 0;

    if (!hasLineOfSight || distance > AI_FIRE_RANGE) {
      aiLockState = 'none';
      aiLockStrength = 0;
      aiLockGraceTimer = 0;
      return inputs;
    }

    const effectiveFireDot = AI_BULLET_FIRE_DOT - 0.0125;

    if (inputs.weaponId === 'flamethrower' && aimDot >= AI_FLAME_FIRE_DOT) {
      inputs.fire = 1;
    } else if (inputs.weaponId === 'missile' && aimDot >= AI_MISSILE_FIRE_DOT) {
      inputs.fire = 1;
    } else if (aimDot >= effectiveFireDot) {
      inputs.fire = 1;
    }

    const targetIsInFront = aimDot > 0;
    const angleToTarget = Math.acos(Math.min(1, Math.max(-1, aimDot)));
    const targetWithinReasonableAngle =
      angleToTarget <= AI_LOCK_BREAK_ANGLE_RAD;

    const canMaintainLock =
      targetIsInFront && hasLineOfSight && targetWithinReasonableAngle;

    const canAcquireLock = canMaintainLock && aimDot >= AI_MISSILE_FIRE_DOT;

    const hardBreak =
      !targetIsInFront || angleToTarget > AI_LOCK_BREAK_ANGLE_RAD;

    if (hardBreak && aiLockState !== 'none') {
      aiLockState = 'none';
      aiLockStrength = 0;
      aiLockGraceTimer = 0;
    }

    const acquireRate = 16 / AI_LOCK_ACQUIRE_TIME_MS;
    const decayRate = 16 / AI_LOCK_DECAY_TIME_MS;

    switch (aiLockState) {
      case 'none':
        aiLockStrength = 0;
        if (canAcquireLock) {
          aiLockState = 'acquiring';
        }
        break;
      case 'acquiring':
        if (canAcquireLock) {
          aiLockStrength += acquireRate;
          if (aiLockStrength >= 1) {
            aiLockStrength = 1;
            aiLockState = 'locked';
            aiLockGraceTimer = AI_LOCK_GRACE_TIME_MS;
          }
        } else {
          aiLockStrength -= decayRate;
          if (aiLockStrength <= 0) {
            aiLockStrength = 0;
            aiLockState = 'none';
          }
        }
        break;
      case 'locked':
        if (canMaintainLock) {
          aiLockStrength = 1;
          aiLockGraceTimer = AI_LOCK_GRACE_TIME_MS;
        } else {
          aiLockState = 'decaying';
        }
        break;
      case 'decaying':
        if (canMaintainLock) {
          aiLockState = 'locked';
          aiLockStrength = 1;
          aiLockGraceTimer = AI_LOCK_GRACE_TIME_MS;
        } else {
          aiLockGraceTimer -= 16;
          if (aiLockGraceTimer <= 0) {
            aiLockStrength -= decayRate;
          }
          if (aiLockStrength <= 0) {
            aiLockStrength = 0;
            aiLockState = 'none';
          }
        }
        break;
    }

    aiLockStrength = Math.max(0, Math.min(1, aiLockStrength));

    return inputs;
  }

  function getThreatInfo() {
    return {
      aimDot: currentAimDot,
      hasLineOfSight: cachedHasLineOfSight,
      distance: currentDistance,
    };
  }

  function getLockInfo() {
    return {
      lockState: aiLockState,
      lockStrength: aiLockStrength,
      isLocked: aiLockState === 'locked' || aiLockState === 'decaying',
    };
  }

  return {
    update,
    getThreatInfo,
    getLockInfo,
  };
}
