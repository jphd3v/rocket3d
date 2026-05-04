import * as THREE from 'three';

// Perspective constants
const PERSPECTIVE_FIRST_PERSON = 'first-person';
const PERSPECTIVE_THIRD_PERSON = 'third-person';
const PERSPECTIVE_OBSERVER = 'observer';

// Perspective configuration
const PERSPECTIVE_CONFIGS = {
  [PERSPECTIVE_FIRST_PERSON]: {
    distance: 0.5, // Not used in calculateCameraPosition for first-person
    heightOffset: 0.45,
    horizontalAngle: 0.0,
    description: 'First-person view from rocket cockpit',
  },
  [PERSPECTIVE_THIRD_PERSON]: {
    distance: 16.8,
    heightOffset: 2.75,
    horizontalAngle: 0.0,
    description: 'Third-person chase view',
  },
  [PERSPECTIVE_OBSERVER]: {
    distance: 26.0,
    heightOffset: 9.5,
    horizontalAngle: -0.98,
    description: 'Static observer view',
  },
};

// Camera control constants
const CAMERA_MIN_DISTANCE = 0.5; // First-person view minimum
const CAMERA_MAX_DISTANCE = 34.0;
const CAMERA_DEFAULT_DISTANCE = 16.8;
const CAMERA_DEFAULT_VERTICAL_OFFSET = 2.75;
const CAMERA_SENSITIVITY = 0.018;
const CAMERA_HEIGHT_SENSITIVITY = 0.045;
const CAMERA_RESET_SPEED = 0.0667; // Speed of reset animation
const PERSPECTIVE_TRANSITION_SPEED = 0.05; // Speed of perspective transitions

/**
 * Initialize camera state with default values
 * @returns {Object} Camera state object
 */
function initCameraState() {
  return {
    // Existing properties
    distance: CAMERA_DEFAULT_DISTANCE,
    minDistance: CAMERA_MIN_DISTANCE,
    maxDistance: CAMERA_MAX_DISTANCE,
    horizontalAngle: 0.0,
    verticalOffset: CAMERA_DEFAULT_VERTICAL_OFFSET,
    isResetting: false,
    targetDistance: CAMERA_DEFAULT_DISTANCE,
    targetHorizontalAngle: 0.0,

    // New perspective properties
    currentPerspective: PERSPECTIVE_THIRD_PERSON,
    targetPerspective: null,
    perspectiveTransitionProgress: 0.0,
    perspectiveTransitionSpeed: PERSPECTIVE_TRANSITION_SPEED,

    // Height control (replaces zoom)
    heightOffset: CAMERA_DEFAULT_VERTICAL_OFFSET,
    minHeightOffset: -1.5,
    maxHeightOffset: 8.0,
    targetHeightOffset: CAMERA_DEFAULT_VERTICAL_OFFSET,

    // Transition state
    isTransitioning: false,
    transitionStartDistance: CAMERA_DEFAULT_DISTANCE,
    transitionStartHeight: CAMERA_DEFAULT_VERTICAL_OFFSET,
    transitionStartAngle: 0.0,
    transitionTargetDistance: CAMERA_DEFAULT_DISTANCE,
    transitionTargetHeight: CAMERA_DEFAULT_VERTICAL_OFFSET,
    transitionTargetAngle: 0.0,

    // Reverse view state for first-person
    isReversed: false,
  };
}

/**
 * Process camera control inputs and update camera state
 * @param {Object} inputs - Input state from controls module
 * @param {Object} cameraState - Current camera state
 */
function updateCameraState(inputs, cameraState) {
  // Handle camera reset
  if (inputs.cameraReset) {
    resetCamera(cameraState);
    return;
  }

  // Skip input processing if resetting or transitioning
  if (cameraState.isResetting || cameraState.isTransitioning) {
    return;
  }

  // Handle perspective switching
  if (inputs.cyclePerspective) {
    cycleToNextPerspective(cameraState);
  } else if (inputs.cyclePerspectivePrev) {
    cycleToPrevPerspective(cameraState);
  } else {
    if (inputs.perspectiveFirst) {
      switchPerspective(cameraState, PERSPECTIVE_FIRST_PERSON);
    }
    if (inputs.perspectiveThird) {
      switchPerspective(cameraState, PERSPECTIVE_THIRD_PERSON);
    }
    if (inputs.perspectiveObserver) {
      switchPerspective(cameraState, PERSPECTIVE_OBSERVER);
    }
  }

  // Handle reverse view (first-person and third-person) - requires holding button
  if (
    cameraState.currentPerspective === PERSPECTIVE_FIRST_PERSON ||
    cameraState.currentPerspective === PERSPECTIVE_THIRD_PERSON
  ) {
    cameraState.isReversed = inputs.toggleReverseView === 1;
  } else {
    cameraState.isReversed = false;
  }

  // Handle height control (replaces zoom)
  updateHeightControl(inputs, cameraState);

  // Handle orbit left/right
  if (inputs.cameraOrbitLeft) {
    cameraState.horizontalAngle += inputs.cameraOrbitLeft * CAMERA_SENSITIVITY;
  }

  if (inputs.cameraOrbitRight) {
    cameraState.horizontalAngle -= inputs.cameraOrbitRight * CAMERA_SENSITIVITY;
  }
}

/**
 * Cycle to the next perspective in the sequence
 * @param {Object} cameraState - Current camera state
 */
function cycleToNextPerspective(cameraState) {
  const perspectives = [
    PERSPECTIVE_FIRST_PERSON,
    PERSPECTIVE_THIRD_PERSON,
    PERSPECTIVE_OBSERVER,
  ];

  const currentIndex = perspectives.indexOf(cameraState.currentPerspective);
  const nextIndex = (currentIndex + 1) % perspectives.length;
  const nextPerspective = perspectives[nextIndex];

  switchPerspective(cameraState, nextPerspective);
}

/**
 * Switch to a different perspective with smooth transition
 * @param {Object} cameraState - Current camera state
 * @param {string} targetPerspective - Target perspective constant
 */
function cycleToPrevPerspective(cameraState) {
  const perspectives = [
    PERSPECTIVE_FIRST_PERSON,
    PERSPECTIVE_THIRD_PERSON,
    PERSPECTIVE_OBSERVER,
  ];

  const currentIndex = perspectives.indexOf(cameraState.currentPerspective);
  const prevIndex =
    (currentIndex - 1 + perspectives.length) % perspectives.length;
  const prevPerspective = perspectives[prevIndex];

  switchPerspective(cameraState, prevPerspective);
}

function switchPerspective(
  cameraState,
  targetPerspective,
  transitionSpeed = PERSPECTIVE_TRANSITION_SPEED
) {
  if (
    cameraState.isTransitioning &&
    cameraState.targetPerspective === targetPerspective
  ) {
    return; // Already transitioning to target perspective
  }

  if (
    !cameraState.isTransitioning &&
    cameraState.currentPerspective === targetPerspective
  ) {
    return; // Already in target perspective
  }

  const config = PERSPECTIVE_CONFIGS[targetPerspective];
  cameraState.targetPerspective = targetPerspective;
  cameraState.isTransitioning = true;
  cameraState.perspectiveTransitionProgress = 0.0;
  cameraState.perspectiveTransitionSpeed = transitionSpeed;

  // Store transition start values
  cameraState.transitionStartDistance = cameraState.distance;
  cameraState.transitionStartHeight = cameraState.heightOffset;
  cameraState.transitionStartAngle = cameraState.horizontalAngle;

  // Set transition targets
  cameraState.transitionTargetDistance = config.distance;
  cameraState.transitionTargetHeight = config.heightOffset;
  cameraState.transitionTargetAngle = config.horizontalAngle;
}

/**
 * Update height control based on input
 * @param {Object} inputs - Input state from controls module
 * @param {Object} cameraState - Current camera state
 */
function updateHeightControl(inputs, cameraState) {
  if (inputs.cameraHeightUp) {
    cameraState.heightOffset +=
      inputs.cameraHeightUp * CAMERA_HEIGHT_SENSITIVITY;
  }

  if (inputs.cameraHeightDown) {
    cameraState.heightOffset -=
      inputs.cameraHeightDown * CAMERA_HEIGHT_SENSITIVITY;
  }

  // Apply limits
  cameraState.heightOffset = Math.max(
    cameraState.minHeightOffset,
    Math.min(cameraState.maxHeightOffset, cameraState.heightOffset)
  );
}

/**
 * Update perspective transition animation
 * @param {Object} cameraState - Current camera state
 */
function updatePerspectiveTransition(cameraState) {
  if (!cameraState.isTransitioning) {
    return;
  }

  cameraState.perspectiveTransitionProgress +=
    cameraState.perspectiveTransitionSpeed || PERSPECTIVE_TRANSITION_SPEED;

  if (cameraState.perspectiveTransitionProgress >= 1.0) {
    // Transition complete
    cameraState.perspectiveTransitionProgress = 1.0;
    cameraState.isTransitioning = false;
    cameraState.currentPerspective = cameraState.targetPerspective;
    cameraState.targetPerspective = null;
  }

  // Smooth interpolation using ease-in-out
  const t = easeInOutCubic(cameraState.perspectiveTransitionProgress);

  cameraState.distance = lerp(
    cameraState.transitionStartDistance,
    cameraState.transitionTargetDistance,
    t
  );

  cameraState.heightOffset = lerp(
    cameraState.transitionStartHeight,
    cameraState.transitionTargetHeight,
    t
  );
  cameraState.horizontalAngle = lerp(
    cameraState.transitionStartAngle,
    cameraState.transitionTargetAngle,
    t
  );
}

/**
 * Linear interpolation between two values
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Ease-in-out cubic interpolation
 * @param {number} t - Input value (0-1)
 * @returns {number} Eased value
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Calculate camera position using spherical coordinates
 * @param {Object} cameraState - Current camera state
 * @returns {THREE.Vector3} Camera position in local space
 */
function calculateCameraPosition(cameraState) {
  let x, z, y;

  if (cameraState.currentPerspective === PERSPECTIVE_FIRST_PERSON) {
    // In first-person mode, position the camera near the rocket's nose.
    let noseDistance = 2.5;

    // Reverse the direction if in reverse view
    if (cameraState.isReversed) {
      noseDistance = -noseDistance; // Flip the sign to look backward
    }

    x = noseDistance * Math.sin(cameraState.horizontalAngle);
    z = noseDistance * Math.cos(cameraState.horizontalAngle);
    y = cameraState.heightOffset;
  } else {
    // Third-person and observer modes use offset vectors, with negative Z
    // staying behind the rocket.
    x = cameraState.distance * Math.sin(cameraState.horizontalAngle);
    z = -cameraState.distance * Math.cos(cameraState.horizontalAngle);
    y = cameraState.heightOffset;

    return new THREE.Vector3(x, y, z);
  }

  return new THREE.Vector3(x, y, z);
}

/**
 * Initiate camera reset animation
 * @param {Object} cameraState - Current camera state
 */
function resetCamera(cameraState) {
  const config = PERSPECTIVE_CONFIGS[cameraState.currentPerspective];
  cameraState.isResetting = true;
  cameraState.targetDistance = config.distance;
  cameraState.targetHeightOffset = config.heightOffset;
  cameraState.targetHorizontalAngle = config.horizontalAngle;
}

/**
 * Update camera reset animation
 * @param {Object} cameraState - Current camera state
 */
function updateCameraReset(cameraState) {
  if (cameraState.isResetting) {
    // Smooth interpolation to target values
    cameraState.distance +=
      (cameraState.targetDistance - cameraState.distance) * CAMERA_RESET_SPEED;
    cameraState.heightOffset +=
      (cameraState.targetHeightOffset - cameraState.heightOffset) *
      CAMERA_RESET_SPEED;
    cameraState.horizontalAngle +=
      (cameraState.targetHorizontalAngle - cameraState.horizontalAngle) *
      CAMERA_RESET_SPEED;

    // Check if reset is complete
    if (
      Math.abs(cameraState.distance - cameraState.targetDistance) < 0.01 &&
      Math.abs(cameraState.heightOffset - cameraState.targetHeightOffset) <
        0.01 &&
      Math.abs(
        cameraState.horizontalAngle - cameraState.targetHorizontalAngle
      ) < 0.01
    ) {
      cameraState.isResetting = false;
    }
  }
}

export {
  PERSPECTIVE_FIRST_PERSON,
  PERSPECTIVE_THIRD_PERSON,
  PERSPECTIVE_OBSERVER,
  initCameraState,
  updateCameraState,
  calculateCameraPosition,
  switchPerspective,
  resetCamera,
  updateCameraReset,
  updatePerspectiveTransition,
};
