import { getVoxel, voxelToWorldCoord, worldToVoxelCoord } from './voxel.js';
import { isVoxelSolid } from './voxel-materials.js';

const EPSILON = 1e-8;
const ZERO_NORMAL = { x: 0, y: 0, z: 0 };
const POS_X_NORMAL = { x: 1, y: 0, z: 0 };
const NEG_X_NORMAL = { x: -1, y: 0, z: 0 };
const POS_Y_NORMAL = { x: 0, y: 1, z: 0 };
const NEG_Y_NORMAL = { x: 0, y: -1, z: 0 };
const POS_Z_NORMAL = { x: 0, y: 0, z: 1 };
const NEG_Z_NORMAL = { x: 0, y: 0, z: -1 };

function isSolidVoxel(world, x, y, z) {
  return isVoxelSolid(getVoxel(world, x, y, z));
}

function recordRaycast(world) {
  if (!world || !world.performanceStats) {
    return;
  }

  world.performanceStats.raycastsPerFrame++;
}

function canRunBudgetedRaycast(world, priority = 'critical') {
  if (!world || !world.performanceStats || !world.runtimeLimits) {
    return true;
  }

  const totalRaycasts = world.performanceStats.raycastsPerFrame;
  const criticalBudget =
    typeof world.runtimeLimits.maxCriticalRaycastsPerFrame === 'number'
      ? world.runtimeLimits.maxCriticalRaycastsPerFrame
      : Number.POSITIVE_INFINITY;
  const totalBudget =
    typeof world.runtimeLimits.maxRaycastsPerFrame === 'number'
      ? world.runtimeLimits.maxRaycastsPerFrame
      : Number.POSITIVE_INFINITY;
  const lowPriorityBudget =
    typeof world.runtimeLimits.maxLowPriorityRaycastsPerFrame === 'number'
      ? world.runtimeLimits.maxLowPriorityRaycastsPerFrame
      : Number.POSITIVE_INFINITY;

  if (priority === 'low') {
    return (
      totalRaycasts < totalBudget &&
      totalRaycasts - criticalBudget < lowPriorityBudget
    );
  }

  return totalRaycasts < totalBudget && totalRaycasts < criticalBudget;
}

function getAxisNormal(stepX, stepY, stepZ, steppedAxis) {
  if (steppedAxis === 0) {
    return stepX > 0 ? NEG_X_NORMAL : POS_X_NORMAL;
  }
  if (steppedAxis === 1) {
    return stepY > 0 ? NEG_Y_NORMAL : POS_Y_NORMAL;
  }
  return stepZ > 0 ? NEG_Z_NORMAL : POS_Z_NORMAL;
}

// Amanatides and Woo fast voxel traversal for a ray segment.
export function raycastVoxel(world, origin, direction, maxDistance) {
  if (!world || maxDistance < 0) {
    return null;
  }

  const dirLength = Math.sqrt(
    direction.x * direction.x +
      direction.y * direction.y +
      direction.z * direction.z
  );

  if (dirLength < EPSILON) {
    const voxelX = Math.floor(origin.x);
    const voxelY = Math.floor(origin.y);
    const voxelZ = Math.floor(origin.z);
    if (isSolidVoxel(world, voxelX, voxelY, voxelZ)) {
      return {
        voxelX,
        voxelY,
        voxelZ,
        distance: 0,
        normal: ZERO_NORMAL,
      };
    }
    return null;
  }

  const dirX = direction.x / dirLength;
  const dirY = direction.y / dirLength;
  const dirZ = direction.z / dirLength;

  let voxelX = Math.floor(origin.x);
  let voxelY = Math.floor(origin.y);
  let voxelZ = Math.floor(origin.z);

  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;

  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY);
  const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirZ);

  const nextBoundaryX = stepX > 0 ? voxelX + 1 : voxelX;
  const nextBoundaryY = stepY > 0 ? voxelY + 1 : voxelY;
  const nextBoundaryZ = stepZ > 0 ? voxelZ + 1 : voxelZ;

  let tMaxX =
    stepX === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryX - origin.x) / dirX;
  let tMaxY =
    stepY === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryY - origin.y) / dirY;
  let tMaxZ =
    stepZ === 0 ? Number.POSITIVE_INFINITY : (nextBoundaryZ - origin.z) / dirZ;

  if (isSolidVoxel(world, voxelX, voxelY, voxelZ)) {
    return {
      voxelX,
      voxelY,
      voxelZ,
      distance: 0,
      normal: ZERO_NORMAL,
    };
  }

  let distance = 0;
  const maxSteps = Math.ceil(maxDistance * 3) + 3;

  for (let step = 0; step < maxSteps && distance <= maxDistance; step++) {
    let steppedAxis;

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        voxelX += stepX;
        distance = tMaxX;
        tMaxX += tDeltaX;
        steppedAxis = 0;
      } else {
        voxelZ += stepZ;
        distance = tMaxZ;
        tMaxZ += tDeltaZ;
        steppedAxis = 2;
      }
    } else if (tMaxY < tMaxZ) {
      voxelY += stepY;
      distance = tMaxY;
      tMaxY += tDeltaY;
      steppedAxis = 1;
    } else {
      voxelZ += stepZ;
      distance = tMaxZ;
      tMaxZ += tDeltaZ;
      steppedAxis = 2;
    }

    if (distance > maxDistance) {
      return null;
    }

    if (isSolidVoxel(world, voxelX, voxelY, voxelZ)) {
      return {
        voxelX,
        voxelY,
        voxelZ,
        distance,
        normal: getAxisNormal(stepX, stepY, stepZ, steppedAxis),
      };
    }
  }

  return null;
}

export function raycastVoxelSegment(world, start, end, padding = 0) {
  recordRaycast(world);

  const startX = worldToVoxelCoord(world, start.x);
  const startY = worldToVoxelCoord(world, start.y);
  const startZ = worldToVoxelCoord(world, start.z);
  const endX = worldToVoxelCoord(world, end.x);
  const endY = worldToVoxelCoord(world, end.y);
  const endZ = worldToVoxelCoord(world, end.z);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const deltaZ = endZ - startZ;
  const distance = Math.sqrt(
    deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ
  );

  if (distance < EPSILON) {
    const voxelX = Math.floor(endX);
    const voxelY = Math.floor(endY);
    const voxelZ = Math.floor(endZ);
    if (isSolidVoxel(world, voxelX, voxelY, voxelZ)) {
      return {
        voxelX,
        voxelY,
        voxelZ,
        distance: 0,
        normal: ZERO_NORMAL,
      };
    }
    return null;
  }

  const hit = raycastVoxel(
    world,
    { x: startX, y: startY, z: startZ },
    { x: deltaX, y: deltaY, z: deltaZ },
    distance + worldToVoxelCoord(world, padding)
  );

  if (!hit) {
    return null;
  }

  return {
    ...hit,
    distance: voxelToWorldCoord(world, hit.distance),
  };
}

export function raycastVoxelSegmentBudgeted(
  world,
  start,
  end,
  padding = 0,
  priority = 'critical'
) {
  if (!canRunBudgetedRaycast(world, priority)) {
    return null;
  }

  return raycastVoxelSegment(world, start, end, padding);
}

export function canRunVoxelRaycast(world, priority = 'critical') {
  return canRunBudgetedRaycast(world, priority);
}
