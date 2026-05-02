import * as THREE from 'three';

function hashString(value) {
  var hash = 2166136261;

  for (var i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function seededValue(seedRoot, localKey) {
  return hashString(String(seedRoot) + ':' + localKey);
}

function initWindField(activeLevel, seedRoot) {
  var windSeedRoot = String(seedRoot || 'default-wind-seed') + ':wind';
  var globalDirection = new THREE.Vector3(0.15, -0.03, 0.2);
  var globalStrength = 7.2 + seededValue(windSeedRoot, 'global-strength') * 2.2;
  var zones = [];

  globalDirection.applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -0.35 + seededValue(windSeedRoot, 'global-yaw') * 0.7
  );
  globalDirection.y += -0.05 + seededValue(windSeedRoot, 'global-pitch') * 0.1;
  globalDirection.normalize();

  function addZone(zone) {
    zones.push(zone);
  }

  // Build zones from level data
  if (activeLevel) {
    // Sky openings → downdraft with pollen
    if (activeLevel.skyOpenings) {
      for (var si = 0; si < activeLevel.skyOpenings.length; si++) {
        var opening = activeLevel.skyOpenings[si];
        var openingSeedKey = 'sky-opening:' + si;
        addZone({
          type: 'downdraft',
          center: new THREE.Vector3(
            opening.center.x,
            opening.center.y,
            opening.center.z
          ),
          radius:
            Math.max(opening.radius.x, opening.radius.z) *
            (1.45 +
              seededValue(windSeedRoot, openingSeedKey + ':radius') * 0.3),
          strength:
            12.5 +
            seededValue(windSeedRoot, openingSeedKey + ':strength') * 3.5,
          turbulence:
            0.1 +
            seededValue(windSeedRoot, openingSeedKey + ':turbulence') * 0.12,
          particleType: 'pollen',
        });
      }
    }

    // Chambers with special biomes
    if (activeLevel.graph && activeLevel.graph.chambers) {
      for (var ci = 0; ci < activeLevel.graph.chambers.length; ci++) {
        var ch = activeLevel.graph.chambers[ci];
        if (ch.biomeId === 'amber') {
          var amberSeedKey = ch.id + ':amber-zone';
          addZone({
            type: 'updraft',
            center: new THREE.Vector3(ch.center.x, ch.center.y, ch.center.z),
            radius:
              Math.max(ch.radius.x, ch.radius.y, ch.radius.z) *
              (0.9 +
                seededValue(windSeedRoot, amberSeedKey + ':radius') * 0.22),
            strength:
              8.6 + seededValue(windSeedRoot, amberSeedKey + ':strength') * 2.8,
            turbulence:
              0.34 +
              seededValue(windSeedRoot, amberSeedKey + ':turbulence') * 0.3,
            particleType: 'ember',
          });
        }

        if (ch.biomeId === 'ice') {
          var iceSeedKey = ch.id + ':ice-zone';
          addZone({
            type: 'mist',
            center: new THREE.Vector3(ch.center.x, ch.center.y, ch.center.z),
            radius:
              Math.max(ch.radius.x, ch.radius.y, ch.radius.z) *
              (0.92 + seededValue(windSeedRoot, iceSeedKey + ':radius') * 0.2),
            strength:
              5.2 + seededValue(windSeedRoot, iceSeedKey + ':strength') * 1.8,
            turbulence:
              0.26 +
              seededValue(windSeedRoot, iceSeedKey + ':turbulence') * 0.24,
            particleType: 'mist',
          });
        }
      }
    }

    // Tunnels → directional flow along tunnel axis
    if (
      activeLevel.graph &&
      activeLevel.graph.chambers &&
      activeLevel.graph.tunnels
    ) {
      var chambers = activeLevel.graph.chambers;
      var chamberMap = {};
      for (var cmi = 0; cmi < chambers.length; cmi++) {
        chamberMap[chambers[cmi].id] = chambers[cmi];
      }

      for (var ti = 0; ti < activeLevel.graph.tunnels.length; ti++) {
        var tunnel = activeLevel.graph.tunnels[ti];
        var fromCh = chamberMap[tunnel.from];
        var toCh = chamberMap[tunnel.to];
        if (fromCh && toCh) {
          var tunnelSeedKey = tunnel.from + ':' + tunnel.to + ':wind-zone';
          var fromVec = new THREE.Vector3(
            fromCh.center.x,
            fromCh.center.y,
            fromCh.center.z
          );
          var toVec = new THREE.Vector3(
            toCh.center.x,
            toCh.center.y,
            toCh.center.z
          );
          var mid = new THREE.Vector3()
            .addVectors(fromVec, toVec)
            .multiplyScalar(0.5);
          var dir = new THREE.Vector3().subVectors(toVec, fromVec).normalize();
          addZone({
            type: 'tunnel',
            center: mid,
            direction: dir,
            radius:
              Math.max(
                fromCh.radius.x,
                fromCh.radius.z,
                toCh.radius.x,
                toCh.radius.z
              ) *
              (1.55 +
                seededValue(windSeedRoot, tunnelSeedKey + ':radius') * 0.35),
            strength:
              10.2 +
              seededValue(windSeedRoot, tunnelSeedKey + ':strength') * 2.6,
            turbulence:
              0.18 +
              seededValue(windSeedRoot, tunnelSeedKey + ':turbulence') * 0.18,
            particleType: 'dust',
          });
        }
      }
    }
  }

  var tempVec = new THREE.Vector3();
  var resultDir = new THREE.Vector3();
  var blendDir = new THREE.Vector3();

  function getWindAt(position, out) {
    resultDir.copy(globalDirection);
    var strength = globalStrength;
    var turbulence = 0.3;
    var particleType = 'dust';

    for (var zi = 0; zi < zones.length; zi++) {
      var zone = zones[zi];
      tempVec.copy(zone.center).sub(position);
      var dist = tempVec.length();
      if (dist < zone.radius) {
        var influence = 1 - dist / zone.radius;
        influence = influence * influence;

        if (zone.type === 'downdraft') {
          resultDir.y += -1 * influence * 0.6;
          resultDir.normalize();
          strength += (zone.strength - strength) * influence;
        } else if (zone.type === 'updraft') {
          resultDir.y += 1 * influence * 0.6;
          resultDir.normalize();
          strength += (zone.strength - strength) * influence;
        } else if (zone.type === 'tunnel' && zone.direction) {
          blendDir.copy(resultDir).multiplyScalar(1 - influence);
          resultDir
            .copy(zone.direction)
            .multiplyScalar(influence)
            .add(blendDir);
          resultDir.normalize();
          strength += (zone.strength - strength) * influence;
        } else if (zone.type === 'mist') {
          turbulence += (zone.turbulence - turbulence) * influence;
          strength += (zone.strength - strength) * influence;
        }

        turbulence += (zone.turbulence - turbulence) * influence;
        if (influence > 0.5) {
          particleType = zone.particleType;
        }
      }
    }

    if (out) {
      out.direction.copy(resultDir);
      out.strength = strength;
      out.turbulence = turbulence;
      out.particleType = particleType;
      return out;
    }

    return {
      direction: resultDir.clone(),
      strength: strength,
      turbulence: turbulence,
      particleType: particleType,
    };
  }

  return {
    getWindAt: getWindAt,
    addZone: addZone,
  };
}

export { initWindField };
