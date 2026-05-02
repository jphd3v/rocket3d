import * as THREE from 'three';

function initWindParticles(scene) {
  var MAX_PARTICLES = 80;
  var particles = [];

  // Create soft circle texture for particles
  var texSize = 64;
  var canvas = document.createElement('canvas');
  canvas.width = texSize;
  canvas.height = texSize;
  var ctx = canvas.getContext('2d');
  var gradient = ctx.createRadialGradient(
    texSize / 2,
    texSize / 2,
    0,
    texSize / 2,
    texSize / 2,
    texSize / 2
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, texSize, texSize);
  var texture = new THREE.CanvasTexture(canvas);

  // Geometry attributes
  var positions = new Float32Array(MAX_PARTICLES * 3);
  var sizes = new Float32Array(MAX_PARTICLES);
  var alphas = new Float32Array(MAX_PARTICLES);

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  // Custom shader for per-vertex alpha and size
  var material = new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: texture },
    },
    vertexShader: [
      'attribute float aSize;',
      'attribute float aAlpha;',
      'varying float vAlpha;',
      'void main() {',
      '  vAlpha = aAlpha;',
      '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
      '  gl_PointSize = aSize * (250.0 / -mvPosition.z);',
      '  gl_Position = projectionMatrix * mvPosition;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uTexture;',
      'varying float vAlpha;',
      'void main() {',
      '  vec4 texColor = texture2D(uTexture, gl_PointCoord);',
      '  gl_FragColor = vec4(1.0, 1.0, 1.0, texColor.a * vAlpha);',
      '}',
    ].join('\n'),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  var points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'windParticles';

  // Initialize particle state
  for (var i = 0; i < MAX_PARTICLES; i++) {
    particles.push({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      age: 0,
      lifetime: 0,
      baseAlpha: 0,
      size: 0,
      phase: 0,
      active: false,
    });
  }

  var tempVec = new THREE.Vector3();
  var tempDir = new THREE.Vector3();
  var noiseVec = new THREE.Vector3();
  var windResult = {
    direction: new THREE.Vector3(),
    strength: 0,
    turbulence: 0,
    particleType: '',
  };

  function spawnParticle(index, camera, windField) {
    var p = particles[index];
    var camPos = camera.position;

    camera.getWorldDirection(tempDir);

    // Random direction with forward bias
    var spawnDir = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    ).normalize();
    spawnDir.lerp(tempDir, 0.25).normalize();

    var spawnDist = 6 + Math.random() * 28;
    p.position.copy(camPos).addScaledVector(spawnDir, spawnDist);

    windField.getWindAt(p.position, windResult);
    p.velocity.copy(windResult.direction).multiplyScalar(windResult.strength);

    // Small random variation per particle
    p.velocity.x += (Math.random() - 0.5) * windResult.strength * 0.12;
    p.velocity.y += (Math.random() - 0.5) * windResult.strength * 0.12;
    p.velocity.z += (Math.random() - 0.5) * windResult.strength * 0.12;

    p.age = 0;
    p.lifetime = 4 + Math.random() * 5;
    p.baseAlpha = 0.03 + Math.random() * 0.09;
    p.size = 0.3 + Math.random() * 0.9;
    p.phase = Math.random() * Math.PI * 2;
    p.active = true;
  }

  // Initial positions for all particles (set to origin until first update)
  for (var j = 0; j < MAX_PARTICLES; j++) {
    positions[j * 3] = 0;
    positions[j * 3 + 1] = 0;
    positions[j * 3 + 2] = 0;
    sizes[j] = 0;
    alphas[j] = 0;
  }

  scene.add(points);

  function updateWindParticles(camera, elapsed, deltaSeconds, windField) {
    camera.updateMatrixWorld(true);

    var camPos = camera.position;
    camera.getWorldDirection(tempDir);

    for (var i = 0; i < MAX_PARTICLES; i++) {
      var p = particles[i];

      if (!p.active) {
        spawnParticle(i, camera, windField);
        // Set initial buffer values
        positions[i * 3] = p.position.x;
        positions[i * 3 + 1] = p.position.y;
        positions[i * 3 + 2] = p.position.z;
        sizes[i] = p.size;
        alphas[i] = 0;
        continue;
      }

      p.age += deltaSeconds;

      // Fade in / out
      var fadeIn = Math.min(1, p.age / 0.8);
      var fadeOut = Math.min(1, (p.lifetime - p.age) / 1.5);
      var alpha = p.baseAlpha * fadeIn * fadeOut;

      // Get current wind at particle position
      windField.getWindAt(p.position, windResult);
      var turbStrength = windResult.turbulence * 0.4;

      // Smooth turbulence noise
      noiseVec.set(
        Math.sin(p.position.x * 0.04 + elapsed * 0.3 + p.phase) * turbStrength,
        Math.sin(p.position.y * 0.05 + elapsed * 0.25 + p.phase * 1.3) *
          turbStrength,
        Math.sin(p.position.z * 0.045 + elapsed * 0.35 + p.phase * 0.7) *
          turbStrength
      );

      p.position.x +=
        (windResult.direction.x * windResult.strength + noiseVec.x) *
        deltaSeconds;
      p.position.y +=
        (windResult.direction.y * windResult.strength + noiseVec.y) *
        deltaSeconds;
      p.position.z +=
        (windResult.direction.z * windResult.strength + noiseVec.z) *
        deltaSeconds;

      // Check if particle should be respawned
      tempVec.copy(p.position).sub(camPos);
      var behind = tempVec.dot(tempDir) < -8;
      var tooFar = tempVec.length() > 90;
      var expired = p.age >= p.lifetime;

      if (behind || tooFar || expired) {
        spawnParticle(i, camera, windField);
        positions[i * 3] = p.position.x;
        positions[i * 3 + 1] = p.position.y;
        positions[i * 3 + 2] = p.position.z;
        sizes[i] = p.size;
        alphas[i] = 0;
        continue;
      }

      // Update buffer data
      positions[i * 3] = p.position.x;
      positions[i * 3 + 1] = p.position.y;
      positions[i * 3 + 2] = p.position.z;
      sizes[i] = p.size;
      alphas[i] = alpha;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
  }

  function dispose() {
    scene.remove(points);
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { update: updateWindParticles, dispose: dispose };
}

export { initWindParticles };
