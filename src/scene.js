import * as THREE from 'three';

function initScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8eaaa0);

  const ambientLight = new THREE.AmbientLight(0x3a4d43, 0.5);
  scene.add(ambientLight);

  const hemisphereLight = new THREE.HemisphereLight(0xa8c8b8, 0x3a4a30, 1.12);
  hemisphereLight.position.set(0, 1, 0);
  scene.add(hemisphereLight);

  const directionalLight = new THREE.DirectionalLight(0xfff3d2, 1.5);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.bias = -0.0002;
  directionalLight.shadow.normalBias = 0.06;
  directionalLight.shadow.camera.left = -48;
  directionalLight.shadow.camera.right = 48;
  directionalLight.shadow.camera.top = 48;
  directionalLight.shadow.camera.bottom = -48;
  directionalLight.shadow.camera.near = 1;
  directionalLight.shadow.camera.far = 180;
  directionalLight.position.set(150, 268, 72);

  const sunTarget = new THREE.Object3D();
  sunTarget.position.set(160, 160, 160);
  scene.add(sunTarget);
  directionalLight.target = sunTarget;
  scene.add(directionalLight);

  scene.userData.sunLight = directionalLight;
  scene.userData.sunTarget = sunTarget;
  scene.userData.sunDirection = new THREE.Vector3(-0.28, -1, -0.18).normalize();
  scene.userData.sunDistance = 180;
  scene.userData.hemisphereLight = hemisphereLight;

  scene.fog = new THREE.Fog(0x6b8a7e, 40, 220);

  return scene;
}

export { initScene };
