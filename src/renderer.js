import * as THREE from 'three';

const MAX_RENDER_PIXEL_RATIO = 1;

// https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html
// https://threejsfundamentals.org/threejs/lessons/threejs-responsive.html
function calculateDisplayDimensions(canvas) {
  const realToCSSPixels = Math.min(
    window.devicePixelRatio || 1,
    MAX_RENDER_PIXEL_RATIO
  );

  const displayWidth = (canvas.clientWidth * realToCSSPixels) | 0;
  const displayHeight = (canvas.clientHeight * realToCSSPixels) | 0;

  return { displayWidth, displayHeight };
}

function cameraAspect(width, height) {
  return width / height;
}

function setRendererSize(renderer, displayWidth, displayHeight) {
  renderer.setSize(displayWidth, displayHeight, false);
  renderer.setViewport(0, 0, displayWidth, displayHeight);
}

function onResize(renderer, camera) {
  const canvas = renderer.domElement;
  const { displayWidth, displayHeight } = calculateDisplayDimensions(canvas);

  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    camera.aspect = cameraAspect(displayWidth, displayHeight);
    camera.updateProjectionMatrix();
    setRendererSize(renderer, displayWidth, displayHeight);
  }
}

function isFullscreenActive() {
  return Boolean(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement
  );
}

function toggleFullscreen() {
  if (isFullscreenActive()) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    }
    return;
  }

  const target = document.documentElement;

  if (target.requestFullscreen) {
    target.requestFullscreen();
  } else if (target.webkitRequestFullscreen) {
    target.webkitRequestFullscreen();
  } else if (target.mozRequestFullScreen) {
    target.mozRequestFullScreen();
  }
}

function setupWindowing(renderer, camera) {
  window.addEventListener('resize', () => onResize(renderer, camera), false);
  document.addEventListener(
    'fullscreenchange',
    () => onResize(renderer, camera),
    false
  );
  document.addEventListener(
    'webkitfullscreenchange',
    () => onResize(renderer, camera),
    false
  );
  document.addEventListener(
    'mozfullscreenchange',
    () => onResize(renderer, camera),
    false
  );
}

function initRenderer() {
  const canvas = document.querySelector('#c');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    powerPreference: 'high-performance',
  });

  const { displayWidth, displayHeight } = calculateDisplayDimensions(canvas);
  setRendererSize(renderer, displayWidth, displayHeight);
  renderer.gammaFactor = 2.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.physicallyCorrectLights = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  return renderer;
}

export {
  calculateDisplayDimensions,
  cameraAspect,
  setRendererSize,
  onResize,
  isFullscreenActive,
  toggleFullscreen,
  setupWindowing,
  initRenderer,
};
