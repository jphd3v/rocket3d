import * as THREE from 'three';

function initWindField(activeLevel) {
  var globalDirection = new THREE.Vector3(0.15, -0.03, 0.2).normalize();
  var globalStrength = 8.0;
  var zones = [];

  function addZone(zone) {
    zones.push(zone);
  }

  // Build zones from level data
  if (activeLevel) {
    // Sky openings → downdraft with pollen
    if (activeLevel.skyOpenings) {
      for (var si = 0; si < activeLevel.skyOpenings.length; si++) {
        var opening = activeLevel.skyOpenings[si];
        addZone({
          type: 'downdraft',
          center: new THREE.Vector3(
            opening.center.x,
            opening.center.y,
            opening.center.z
          ),
          radius: Math.max(opening.radius.x, opening.radius.z) * 1.6,
          strength: 14.0,
          turbulence: 0.15,
          particleType: 'pollen',
        });
      }
    }

    // Chambers with special biomes
    if (activeLevel.graph && activeLevel.graph.chambers) {
      for (var ci = 0; ci < activeLevel.graph.chambers.length; ci++) {
        var ch = activeLevel.graph.chambers[ci];
        if (ch.biomeId === 'amber') {
          addZone({
            type: 'updraft',
            center: new THREE.Vector3(ch.center.x, ch.center.y, ch.center.z),
            radius: Math.max(ch.radius.x, ch.radius.y, ch.radius.z),
            strength: 10.0,
            turbulence: 0.5,
            particleType: 'ember',
          });
        }

        if (ch.biomeId === 'ice') {
          addZone({
            type: 'mist',
            center: new THREE.Vector3(ch.center.x, ch.center.y, ch.center.z),
            radius: Math.max(ch.radius.x, ch.radius.y, ch.radius.z),
            strength: 6.0,
            turbulence: 0.4,
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
              ) * 1.8,
            strength: 12.0,
            turbulence: 0.3,
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
          resultDir.copy(zone.direction).multiplyScalar(influence).add(blendDir);
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
