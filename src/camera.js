import * as THREE from 'three';
import { calculateDisplayDimensions, cameraAspect } from './renderer.js';

function initCamera(canvas) {
  const fov = 82;
  const { displayWidth, displayHeight } = calculateDisplayDimensions(canvas);
  const aspect = cameraAspect(displayWidth, displayHeight);
  const near = 0.01; // Reduced near plane for better close-up visibility (first-person view)
  const far = 1000;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);

  return camera;
}

export { initCamera };
