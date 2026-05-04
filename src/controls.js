import {
  BUTTON,
  AXIS,
  buttonValue,
  buttonPressed,
  applyDeadzone,
  getConnectedGamepad,
  getGamepadProfile,
} from './gamepad.js';

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
  'cyclePerspectivePrev',
  'toggleHud',
  'toggleHelp',
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
    cameraHeightUp: 0,
    cameraHeightDown: 0,
    cameraReset: 0,
    cyclePerspective: 0,
    cyclePerspectivePrev: 0,
    toggleHud: 0,
    toggleHelp: 0,
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
    toggleReverseView: 0,
  };
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
      oneShotInputs.toggleHelp = 1;
      break;

    case 'KeyU':
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
  const inputs = createEmptyInputs();
  const gamepad = getConnectedGamepad();

  if (!gamepad) {
    return inputs;
  }

  if (getGamepadProfile(gamepad) !== 'standard') {
    return inputs;
  }

  inputs.thrust = buttonValue(gamepad.buttons[BUTTON.RT]);
  inputs.brake = buttonValue(gamepad.buttons[BUTTON.LT]);

  if (buttonPressed(gamepad.buttons[BUTTON.A])) {
    inputs.fire = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.X])) {
    inputs.cycleWeapon = 1;
  }

  const leftX = applyDeadzone(gamepad.axes[AXIS.LeftX] || 0);
  const leftY = applyDeadzone(gamepad.axes[AXIS.LeftY] || 0);

  if (leftX > 0) {
    inputs.rollRight = leftX;
  } else if (leftX < 0) {
    inputs.rollLeft = Math.abs(leftX);
  }

  if (leftY > 0) {
    inputs.pitchUp = leftY;
  } else if (leftY < 0) {
    inputs.pitchDown = Math.abs(leftY);
  }

  const rightX = applyDeadzone(gamepad.axes[AXIS.RightX] || 0);
  const rightY = applyDeadzone(gamepad.axes[AXIS.RightY] || 0);

  if (rightY > 0) {
    inputs.cameraHeightDown = rightY;
  } else if (rightY < 0) {
    inputs.cameraHeightUp = Math.abs(rightY);
  }

  if (rightX > 0) {
    inputs.cameraOrbitRight = rightX;
  } else if (rightX < 0) {
    inputs.cameraOrbitLeft = Math.abs(rightX);
  }

  if (buttonPressed(gamepad.buttons[BUTTON.DPadLeft])) {
    inputs.cyclePerspectivePrev = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.DPadRight])) {
    inputs.cyclePerspective = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.Start])) {
    inputs.forceOptions = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.Back])) {
    inputs.toggleMenu = 1;
  }

  if (buttonValue(gamepad.buttons[BUTTON.DPadDown]) || buttonValue(gamepad.buttons[BUTTON.LB])) {
    inputs.toggleReverseView = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.DPadUp])) {
    inputs.cameraReset = 1;
  }

  if (buttonPressed(gamepad.buttons[BUTTON.RightStick])) {
    inputs.cameraReset = 1;
  }

  return inputs;
}
