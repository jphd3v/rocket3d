import * as THREE from 'three';
import { ROCKET_EXHAUST_POINTS, ROCKET_VOXEL_SIZE } from './rocket-voxels.js';
import {
  getRocketBackwardVector,
  getRocketUpVector,
  transformRocketLocalPoint,
} from './rocket-orientation.js';

function createFlameMaterial() {
  return new THREE.MeshBasicMaterial({
    color: getFlameColor(),
    transparent: true,
    opacity: 0.84,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createSmokeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x5c5049,
    transparent: true,
    opacity: 0.08,
  });
}

function createDamageSmokeMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0xd9d9d4,
    transparent: true,
    opacity: 0.12,
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getFlameColor() {
  const colorIndex = Math.floor(Math.random() * 4);

  if (colorIndex === 0) {
    return 0xffc24b;
  }

  if (colorIndex === 1) {
    return 0xff8f24;
  }

  if (colorIndex === 2) {
    return 0xff6418;
  }

  return 0xff3b12;
}

export function initFlameSystem(rocket, scene) {
  const flameParticles = [];
  const smokeParticles = [];
  const flameLifetime = 16;
  const smokeLifetime = 34;
  const maxFlameSpawnRate = 2;
  const minFlameSpawnRate = 6;
  const idleSmokeSpawnRate = 12;
  const damageSmokeSpawnRate = 8;
  const lowHealthSmokeThreshold = 30;
  const flameActivationThreshold = 0.08;
  const throttleRiseRate = 0.05;
  const throttleFallRate = 0.08;
  let frameCount = 0;
  let exhaustLevel = 0;
  let previousHealth = 100;

  const flameGeometry = new THREE.OctahedronGeometry(
    ROCKET_VOXEL_SIZE * 0.38,
    0
  );
  const smokeGeometry = new THREE.SphereGeometry(
    ROCKET_VOXEL_SIZE * 0.18,
    6,
    6
  );
  const rocketDirection = new THREE.Vector3();
  const rocketUp = new THREE.Vector3();
  const exhaustDirection = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  const randomOffset = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);

  const localExhaustPositions = ROCKET_EXHAUST_POINTS.map(function (point) {
    return new THREE.Vector3(point.x, point.y, point.z);
  });
  const flameLight = new THREE.PointLight(0xff6a1a, 1.6, 16);
  flameLight.position.set(0, 0, 0);
  rocket.add(flameLight);

  function spawnFlameParticle(localPosition, throttle) {
    const flame = new THREE.Mesh(flameGeometry, createFlameMaterial());

    transformRocketLocalPoint(rocket, localPosition, worldPosition);
    randomOffset.set(
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.18, 0.42, throttle),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.16, 0.32, throttle),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.18, 0.42, throttle)
    );
    flame.position.copy(worldPosition).add(randomOffset);

    exhaustDirection
      .copy(rocketDirection)
      .multiplyScalar(lerp(0.65, 1.95, throttle))
      .addScaledVector(rocketUp, lerp(-0.015, -0.08, throttle));

    const particleLife = Math.round(
      lerp(flameLifetime * 0.68, flameLifetime * 1.18, throttle)
    );

    flame.userData = {
      velocity: exhaustDirection.clone(),
      life: particleLife,
      maxLife: particleLife,
      spin: (Math.random() - 0.5) * lerp(0.05, 0.11, throttle),
      growth: lerp(0.014, 0.024, throttle),
      drag: lerp(0.92, 0.95, throttle),
      scale: lerp(0.52, 1.4, throttle),
    };
    flame.scale.setScalar(flame.userData.scale);

    flameParticles.push(flame);
    scene.add(flame);
  }

  function spawnSmokeParticle(localPosition, throttle) {
    const smoke = new THREE.Mesh(smokeGeometry, createSmokeMaterial());

    transformRocketLocalPoint(rocket, localPosition, worldPosition);
    randomOffset.set(
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.34, 0.7, throttle),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.2, 0.42, throttle),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.34, 0.7, throttle)
    );
    smoke.position.copy(worldPosition).add(randomOffset);

    exhaustDirection
      .copy(rocketDirection)
      .multiplyScalar(lerp(0.03, 0.36, throttle))
      .addScaledVector(worldUp, lerp(0.05, 0.06, throttle))
      .add(
        new THREE.Vector3(
          (Math.random() - 0.5) * lerp(0.008, 0.03, throttle),
          Math.random() * lerp(0.004, 0.02, throttle),
          (Math.random() - 0.5) * lerp(0.008, 0.03, throttle)
        )
      );

    smoke.userData = {
      kind: 'idle',
      velocity: exhaustDirection.clone(),
      life: Math.round(
        lerp(smokeLifetime * 1.15, smokeLifetime * 1.25, throttle)
      ),
      maxLife: Math.round(
        lerp(smokeLifetime * 1.15, smokeLifetime * 1.25, throttle)
      ),
      opacity: 0.08,
      lift: 0,
      growth: lerp(0.006, 0.02, throttle),
      scale: lerp(0.18, 0.42, throttle) * lerp(0.75, 1.2, Math.random()),
    };
    smoke.scale.setScalar(smoke.userData.scale);

    smokeParticles.push(smoke);
    scene.add(smoke);
  }

  function spawnDamageSmokeParticle(damageLevel) {
    const smoke = new THREE.Mesh(smokeGeometry, createDamageSmokeMaterial());

    transformRocketLocalPoint(
      rocket,
      new THREE.Vector3(
        (Math.random() - 0.5) * lerp(2.2, 6.2, damageLevel),
        1.2 + (Math.random() - 0.5) * lerp(0.8, 1.8, damageLevel),
        lerp(0.8, -3.6, Math.random())
      ),
      worldPosition
    );
    randomOffset.set(
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.4, 1.0, damageLevel),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.18, 0.4, damageLevel),
      (Math.random() - 0.5) * ROCKET_VOXEL_SIZE * lerp(0.4, 1.0, damageLevel)
    );
    smoke.position.copy(worldPosition).add(randomOffset);

    smoke.userData = {
      kind: 'damage',
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * lerp(0.025, 0.08, damageLevel),
        lerp(0.08, 0.2, damageLevel),
        (Math.random() - 0.5) * lerp(0.025, 0.08, damageLevel)
      ),
      life: Math.round(
        lerp(smokeLifetime * 1.2, smokeLifetime * 2.2, damageLevel)
      ),
      maxLife: Math.round(
        lerp(smokeLifetime * 1.2, smokeLifetime * 2.2, damageLevel)
      ),
      opacity: 0.22,
      lift: 0.006,
      growth: lerp(0.028, 0.06, damageLevel),
      scale: lerp(0.7, 1.8, damageLevel) * lerp(0.9, 1.45, Math.random()),
    };
    smoke.scale.setScalar(smoke.userData.scale);

    smokeParticles.push(smoke);
    scene.add(smoke);
  }

  function clearDamageSmokeParticles() {
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const smoke = smokeParticles[i];

      if (!smoke.userData || smoke.userData.kind !== 'damage') {
        continue;
      }

      scene.remove(smoke);
      if (smoke.material) {
        smoke.material.dispose();
      }
      smokeParticles.splice(i, 1);
    }
  }

  function updateFlameParticles() {
    for (let i = flameParticles.length - 1; i >= 0; i--) {
      const flame = flameParticles[i];
      flame.userData.life--;

      flame.position.add(flame.userData.velocity);
      flame.userData.velocity.multiplyScalar(flame.userData.drag);
      flame.rotation.z += flame.userData.spin;
      flame.scale.multiplyScalar(1 + flame.userData.growth);

      if (flame.material) {
        flame.material.opacity =
          (flame.userData.life / flame.userData.maxLife) * 0.84;
      }

      if (flame.userData.life <= 0) {
        scene.remove(flame);
        if (flame.material) {
          flame.material.dispose();
        }
        flameParticles.splice(i, 1);
      }
    }
  }

  function updateSmokeParticles() {
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
      const smoke = smokeParticles[i];
      smoke.userData.life--;

      smoke.position.add(smoke.userData.velocity);
      smoke.userData.velocity.multiplyScalar(0.985);
      smoke.userData.velocity.addScaledVector(
        worldUp,
        smoke.userData.lift || 0
      );
      smoke.scale.multiplyScalar(1 + smoke.userData.growth);

      if (smoke.material) {
        smoke.material.opacity =
          (smoke.userData.life / smoke.userData.maxLife) *
          (smoke.userData.opacity || 0.08);
      }

      if (smoke.userData.life <= 0) {
        scene.remove(smoke);
        if (smoke.material) {
          smoke.material.dispose();
        }
        smokeParticles.splice(i, 1);
      }
    }
  }

  return function updateFlames(inputs, physicsState = {}) {
    if (physicsState.active === false) {
      exhaustLevel = 0;
      flameLight.intensity = 0;
      flameLight.distance = 0;
      updateFlameParticles();
      updateSmokeParticles();
      return;
    }

    frameCount++;
    const targetExhaustLevel = clamp(inputs.thrust || 0, 0, 1);
    exhaustLevel = clamp(
      lerp(
        exhaustLevel,
        targetExhaustLevel,
        targetExhaustLevel > exhaustLevel ? throttleRiseRate : throttleFallRate
      ),
      0,
      1
    );
    const health = physicsState.health == null ? 100 : physicsState.health;
    const damageLevel = clamp(
      (lowHealthSmokeThreshold - health) / lowHealthSmokeThreshold,
      0,
      1
    );

    if (previousHealth < 100 && health >= 100) {
      clearDamageSmokeParticles();
    }
    previousHealth = health;

    getRocketBackwardVector(rocket, rocketDirection);
    getRocketUpVector(rocket, rocketUp);

    flameLight.intensity = lerp(0, 4.8, exhaustLevel);
    flameLight.distance = lerp(0, 22, exhaustLevel);

    const flameSpawnRate = Math.round(
      lerp(minFlameSpawnRate, maxFlameSpawnRate, exhaustLevel)
    );
    const smokeSpawnRate = idleSmokeSpawnRate;
    const shouldSpawnFlame =
      exhaustLevel > flameActivationThreshold &&
      frameCount % flameSpawnRate === 0;
    const shouldSpawnSmoke =
      exhaustLevel < flameActivationThreshold &&
      frameCount % smokeSpawnRate === 0;
    const shouldSpawnDamageSmoke =
      damageLevel > 0 &&
      frameCount %
        Math.max(2, Math.round(lerp(damageSmokeSpawnRate, 2, damageLevel))) ===
        0;

    if (shouldSpawnFlame) {
      for (const localPos of localExhaustPositions) {
        spawnFlameParticle(localPos, exhaustLevel);
      }
    }

    if (shouldSpawnSmoke) {
      for (const localPos of localExhaustPositions) {
        spawnSmokeParticle(localPos, exhaustLevel);
      }
    }

    if (shouldSpawnDamageSmoke) {
      spawnDamageSmokeParticle(damageLevel);
    }

    updateFlameParticles();
    updateSmokeParticles();
  };
}
