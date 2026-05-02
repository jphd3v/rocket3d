const ONE_SHOT_INPUT_KEYS = [
  'cycleWeapon',
  'toggleBoundaries',
  'toggleMusic',
  'toggleMusicReverse',
  'toggleSfx',
  'toggleAi',
  'toggleFullscreen',
  'cameraReset',
  'cyclePerspective',
  'toggleHud',
  'toggleCrosshair',
  'toggleDevMode',
  'toggleMenu',
  'forceOptions',
  'toggleLod0',
  'toggleLod1',
  'toggleLod2',
  'toggleLod3',
  'toggleLodAll',
  'toggleLodDebug',
];

function createEmptyInputs() {
  return {
    rollLeft: 0,
    rollRight: 0,
    pitchDown: 0,
    pitchUp: 0,
    thrust: 0,
    brake: 0,
    fire: 0,
    cycleWeapon: 0,
    toggleBoundaries: 0,
    toggleMusic: 0,
    toggleMusicReverse: 0,
    toggleSfx: 0,
    toggleAi: 0,
    toggleFullscreen: 0,
    cameraZoomIn: 0,
    cameraZoomOut: 0,
    cameraOrbitLeft: 0,
    cameraOrbitRight: 0,
    cameraReset: 0,
    perspectiveFirst: 0,
    perspectiveThird: 0,
    perspectiveObserver: 0,
    cyclePerspective: 0,
    cameraHeightUp: 0,
    cameraHeightDown: 0,
    toggleReverseView: 0,
    toggleHud: 0,
    toggleCrosshair: 0,
    toggleDevMode: 0,
    toggleMenu: 0,
    forceOptions: 0,
    toggleLod0: 0,
    toggleLod1: 0,
    toggleLod2: 0,
    toggleLod3: 0,
    toggleLodAll: 0,
    toggleLodDebug: 0,
  };
}

function buttonValue(button) {
  if (typeof button === 'object' && button) {
    if (typeof button.value === 'number') {
      return button.value;
    }

    return button.pressed ? 1 : 0;
  }

  return typeof button === 'number' ? button : 0;
}

function buttonPressed(button) {
  return buttonValue(button) > 0.5;
}

function applyDeadzone(value, deadZone = 0.1) {
  return Math.abs(value) < deadZone ? 0 : value;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function triggerAxisValue(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  if (value >= 0 && value <= 1) {
    return value;
  }

  return clamp01((value + 1) * 0.5);
}

function isStandardGamepad(gamepad) {
  return gamepad && gamepad.mapping === 'standard';
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  var tagName = typeof target.tagName === 'string' ? target.tagName : '';

  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    tagName === 'BUTTON'
  );
}

function keydown(heldInputs, oneShotInputs, event) {
  if (event.altKey || event.repeat) {
    return;
  }

  if (isEditableTarget(event.target) && event.code !== 'Escape') {
    return;
  }

  switch (event.code) {
    case 'Space':
      heldInputs.thrust = 1;
      event.preventDefault();
      break;

    case 'KeyX':
      heldInputs.fire = 1;
      event.preventDefault();
      break;

    case 'KeyB':
      oneShotInputs.toggleBoundaries = 1;
      break;

    case 'KeyM':
      if (event.shiftKey) {
        oneShotInputs.toggleMusicReverse = 1;
      } else {
        oneShotInputs.toggleMusic = 1;
      }
      break;

    case 'KeyN':
      oneShotInputs.toggleSfx = 1;
      break;

    case 'KeyI':
      oneShotInputs.toggleAi = 1;
      break;

    case 'KeyF':
      oneShotInputs.toggleFullscreen = 1;
      break;

    case 'ArrowUp':
      heldInputs.pitchDown = 1;
      event.preventDefault();
      break;

    case 'ArrowDown':
      heldInputs.pitchUp = 1;
      event.preventDefault();
      break;

    case 'ArrowLeft':
      heldInputs.rollLeft = 1;
      event.preventDefault();
      break;

    case 'ArrowRight':
      heldInputs.rollRight = 1;
      event.preventDefault();
      break;

    case 'KeyW':
      heldInputs.cameraHeightUp = 1;
      break;

    case 'KeyA':
      heldInputs.cameraOrbitLeft = 1;
      break;

    case 'KeyS':
      heldInputs.cameraHeightDown = 1;
      break;

    case 'KeyD':
      heldInputs.cameraOrbitRight = 1;
      break;

    case 'KeyZ':
      oneShotInputs.cyclePerspective = 1;
      break;

    case 'KeyH':
      oneShotInputs.toggleHud = 1;
      break;

    case 'KeyY':
      oneShotInputs.toggleCrosshair = 1;
      break;

    case 'KeyC':
      oneShotInputs.cycleWeapon = 1;
      break;

    case 'KeyT':
      oneShotInputs.toggleDevMode = 1;
      break;

    case 'Escape':
      oneShotInputs.toggleMenu = 1;
      break;

    case 'KeyP':
      oneShotInputs.forceOptions = 1;
      break;

    case 'KeyR':
      oneShotInputs.cameraReset = 1;
      break;

    case 'Digit0':
      oneShotInputs.toggleLod0 = 1;
      break;

    case 'Digit1':
      oneShotInputs.toggleLod1 = 1;
      break;

    case 'Digit2':
      oneShotInputs.toggleLod2 = 1;
      break;

    case 'Digit3':
      oneShotInputs.toggleLod3 = 1;
      break;

    case 'KeyL':
      oneShotInputs.toggleLodAll = 1;
      break;

    case 'KeyO':
      oneShotInputs.toggleLodDebug = 1;
      break;
  }
}

function keyup(heldInputs, event) {
  switch (event.code) {
    case 'Space':
      heldInputs.thrust = 0;
      break;

    case 'KeyX':
      heldInputs.fire = 0;
      break;

    case 'ArrowUp':
      heldInputs.pitchDown = 0;
      break;

    case 'ArrowDown':
      heldInputs.pitchUp = 0;
      break;

    case 'ArrowLeft':
      heldInputs.rollLeft = 0;
      break;

    case 'ArrowRight':
      heldInputs.rollRight = 0;
      break;

    case 'KeyW':
      heldInputs.cameraHeightUp = 0;
      break;

    case 'KeyA':
      heldInputs.cameraOrbitLeft = 0;
      break;

    case 'KeyS':
      heldInputs.cameraHeightDown = 0;
      break;

    case 'KeyD':
      heldInputs.cameraOrbitRight = 0;
      break;
  }
}

function mergeInputs(inputsA, inputsB) {
  const mergedInputs = createEmptyInputs();

  for (const key of Object.keys(mergedInputs)) {
    mergedInputs[key] = Math.max(inputsA[key] || 0, inputsB[key] || 0);
  }

  return mergedInputs;
}

function detectPressedEdges(currentInputs, previousInputs) {
  const nextInputs = createEmptyInputs();

  for (const key of ONE_SHOT_INPUT_KEYS) {
    nextInputs[key] = currentInputs[key] && !previousInputs[key] ? 1 : 0;
  }

  return nextInputs;
}

export function initControls(domWindow) {
  const keyboardHeldInputs = createEmptyInputs();
  const keyboardOneShotInputs = createEmptyInputs();
  let previousGamepadInputs = createEmptyInputs();

  domWindow.addEventListener(
    'keydown',
    function (event) {
      keydown(keyboardHeldInputs, keyboardOneShotInputs, event);
    },
    false
  );
  domWindow.addEventListener(
    'keyup',
    function (event) {
      keyup(keyboardHeldInputs, event);
    },
    false
  );
  domWindow.addEventListener('gamepadconnected', function () {
    // Gamepad connected
  });

  domWindow.addEventListener('gamepaddisconnected', function () {
    // Gamepad disconnected
  });

  function pollInputs() {
    const gamepadInputs = pollGamepadInputs();
    const inputs = mergeInputs(keyboardHeldInputs, gamepadInputs);
    const gamepadOneShotInputs = detectPressedEdges(
      gamepadInputs,
      previousGamepadInputs
    );

    previousGamepadInputs = { ...gamepadInputs };

    for (const key of ONE_SHOT_INPUT_KEYS) {
      inputs[key] =
        keyboardOneShotInputs[key] || gamepadOneShotInputs[key] ? 1 : 0;
      keyboardOneShotInputs[key] = 0;
    }

    return inputs;
  }

  return pollInputs;
}

function pollGamepadInputs() {
  const gamepads = navigator.getGamepads
    ? navigator.getGamepads()
    : navigator.webkitGetGamepads
      ? navigator.webkitGetGamepads()
      : [];

  const inputs = createEmptyInputs();

  if (
    !gamepads ||
    typeof gamepads.length !== 'number' ||
    gamepads.length <= 0
  ) {
    return inputs;
  }

  let gamepad = null;

  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      gamepad = gamepads[i];
      break;
    }
  }

  if (!gamepad) {
    return inputs;
  }

  const standardGamepad = isStandardGamepad(gamepad);
  const thrustButtonIndex = standardGamepad ? 7 : -1;
  const brakeButtonIndex = standardGamepad ? 6 : -1;
  const cycleWeaponButtonIndex = standardGamepad ? 3 : 4;
  const fireButtonIndex = standardGamepad ? 5 : 1;
  const reverseViewButtonIndex = standardGamepad ? -1 : 5;
  const flightHorizontalAxisIndex = standardGamepad ? 0 : 1;
  const flightVerticalAxisIndex = standardGamepad ? 1 : 2;
  const toggleMenuButtonIndex = 10;
  const forceOptionsButtonIndex = 11;
  const cameraResetButtonIndex = 14;
  const thrustButtonValue =
    thrustButtonIndex >= 0
      ? buttonValue(gamepad.buttons[thrustButtonIndex])
      : 0;
  const brakeButtonValue =
    brakeButtonIndex >= 0 ? buttonValue(gamepad.buttons[brakeButtonIndex]) : 0;

  inputs.thrust = Math.max(
    thrustButtonValue,
    triggerAxisValue(gamepad.axes[5])
  );
  inputs.brake = Math.max(brakeButtonValue, triggerAxisValue(gamepad.axes[6]));

  if (buttonPressed(gamepad.buttons[cycleWeaponButtonIndex])) {
    inputs.cycleWeapon = 1;
  }

  if (buttonPressed(gamepad.buttons[fireButtonIndex])) {
    inputs.fire = 1;
  }

  if (
    reverseViewButtonIndex >= 0 &&
    buttonPressed(gamepad.buttons[reverseViewButtonIndex])
  ) {
    inputs.toggleReverseView = 1;
  }

  const leftStickHorizontal = applyDeadzone(
    gamepad.axes[flightHorizontalAxisIndex] || 0
  );
  const leftStickVertical = applyDeadzone(
    gamepad.axes[flightVerticalAxisIndex] || 0
  );

  if (leftStickHorizontal > 0) {
    inputs.rollRight = leftStickHorizontal;
  } else if (leftStickHorizontal < 0) {
    inputs.rollLeft = Math.abs(leftStickHorizontal);
  }

  if (leftStickVertical > 0) {
    inputs.pitchUp = leftStickVertical;
  } else if (leftStickVertical < 0) {
    inputs.pitchDown = Math.abs(leftStickVertical);
  }

  const rightStickHorizontalIndex =
    gamepad.mapping === 'standard' || gamepad.axes.length < 5 ? 2 : 3;
  const rightStickVerticalIndex =
    gamepad.mapping === 'standard' || gamepad.axes.length < 5 ? 3 : 4;
  const rightStickHorizontal = applyDeadzone(
    gamepad.axes[rightStickHorizontalIndex] || 0
  );
  const rightStickVertical = applyDeadzone(
    gamepad.axes[rightStickVerticalIndex] || 0
  );

  if (rightStickVertical > 0) {
    inputs.cameraHeightDown = rightStickVertical;
  } else if (rightStickVertical < 0) {
    inputs.cameraHeightUp = Math.abs(rightStickVertical);
  }

  if (rightStickHorizontal > 0) {
    inputs.cameraOrbitRight = rightStickHorizontal;
  } else if (rightStickHorizontal < 0) {
    inputs.cameraOrbitLeft = Math.abs(rightStickHorizontal);
  }

  if (buttonPressed(gamepad.buttons[13])) {
    inputs.cyclePerspective = 1;
  }

  if (buttonPressed(gamepad.buttons[toggleMenuButtonIndex])) {
    inputs.toggleMenu = 1;
  }

  if (buttonPressed(gamepad.buttons[forceOptionsButtonIndex])) {
    inputs.forceOptions = 1;
  }

  if (buttonPressed(gamepad.buttons[cameraResetButtonIndex])) {
    inputs.cameraReset = 1;
  }

  return inputs;
}
