var BUTTON = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LeftStick: 10,
  RightStick: 11,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
};

var AXIS = {
  LeftX: 0,
  LeftY: 1,
  RightX: 2,
  RightY: 3,
};

var AXIS_DEADZONE = 0.1;
var STICK_DEADZONE = 0.45;

function isPressed(button) {
  return Boolean(button && button.pressed);
}

function axisPressed(value, direction) {
  if (typeof value !== 'number') return false;
  return direction < 0 ? value < -STICK_DEADZONE : value > STICK_DEADZONE;
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

function applyDeadzone(value, deadZone) {
  if (deadZone === undefined) deadZone = AXIS_DEADZONE;
  return Math.abs(value) < deadZone ? 0 : value;
}

function getGamepadProfile(gamepad) {
  if (gamepad && gamepad.mapping === 'standard') {
    return 'standard';
  }
  return 'unknown';
}

function readStandardGamepad(gamepad) {
  return {
    confirm: isPressed(gamepad.buttons[BUTTON.A]),
    back: isPressed(gamepad.buttons[BUTTON.B]),
    pause: isPressed(gamepad.buttons[BUTTON.Start]),
    up:
      isPressed(gamepad.buttons[BUTTON.DPadUp]) ||
      axisPressed(gamepad.axes[AXIS.LeftY], -1),
    down:
      isPressed(gamepad.buttons[BUTTON.DPadDown]) ||
      axisPressed(gamepad.axes[AXIS.LeftY], 1),
    left:
      isPressed(gamepad.buttons[BUTTON.DPadLeft]) ||
      axisPressed(gamepad.axes[AXIS.LeftX], -1),
    right:
      isPressed(gamepad.buttons[BUTTON.DPadRight]) ||
      axisPressed(gamepad.axes[AXIS.LeftX], 1),
  };
}

function getConnectedGamepad() {
  var gamepads = navigator.getGamepads
    ? navigator.getGamepads()
    : navigator.webkitGetGamepads
      ? navigator.webkitGetGamepads()
      : [];

  if (
    !gamepads ||
    typeof gamepads.length !== 'number' ||
    gamepads.length <= 0
  ) {
    return null;
  }

  for (var i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      return gamepads[i];
    }
  }

  return null;
}

export {
  BUTTON,
  AXIS,
  isPressed,
  axisPressed,
  buttonValue,
  buttonPressed,
  applyDeadzone,
  getGamepadProfile,
  readStandardGamepad,
  getConnectedGamepad,
};
