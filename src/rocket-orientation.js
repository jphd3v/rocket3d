import { Vector3 } from 'three';

// Treat these local-space axes as read-only.
const ROCKET_FORWARD_LOCAL = new Vector3(0, 0, 1);
const ROCKET_BACKWARD_LOCAL = new Vector3(0, 0, -1);
const ROCKET_UP_LOCAL = new Vector3(0, 1, 0);
const ROCKET_RIGHT_LOCAL = new Vector3(1, 0, 0);

function transformRocketLocalVector(rocket, localVector, target) {
  return target.copy(localVector).applyQuaternion(rocket.quaternion);
}

function transformRocketLocalPoint(rocket, localPoint, target) {
  return target.copy(localPoint).applyMatrix4(rocket.matrixWorld);
}

function getRocketForwardVector(rocket, target) {
  return transformRocketLocalVector(
    rocket,
    ROCKET_FORWARD_LOCAL,
    target
  ).normalize();
}

function getRocketBackwardVector(rocket, target) {
  return transformRocketLocalVector(
    rocket,
    ROCKET_BACKWARD_LOCAL,
    target
  ).normalize();
}

function getRocketUpVector(rocket, target) {
  return transformRocketLocalVector(
    rocket,
    ROCKET_UP_LOCAL,
    target
  ).normalize();
}

function getRocketRightVector(rocket, target) {
  return transformRocketLocalVector(
    rocket,
    ROCKET_RIGHT_LOCAL,
    target
  ).normalize();
}

export {
  ROCKET_FORWARD_LOCAL,
  ROCKET_BACKWARD_LOCAL,
  ROCKET_UP_LOCAL,
  ROCKET_RIGHT_LOCAL,
  transformRocketLocalVector,
  transformRocketLocalPoint,
  getRocketForwardVector,
  getRocketBackwardVector,
  getRocketUpVector,
  getRocketRightVector,
};
