import { createChamber, createTunnel } from '../terrain-generation.js';

var SPAWN = { x: 160, y: 160, z: 120 };
var MAIN = { x: 565, y: 185, z: 565 };

var MOSS = 'moss';
var ICE = 'ice';
var MACHINE = 'machine';
var AMBER = 'amber';

function addSolid(chambers, chamber) {
  chamber.isSolid = true;
  chambers.push(chamber);
}

function buildChambers() {
  var chambers = [];

  chambers.push(
    createChamber('spawn', SPAWN.x, SPAWN.y, SPAWN.z, 56, 32, 56, MOSS)
  );

  // Large hybrid chamber. It is intentionally bigger than level 2, but
  // divided by embedded side chambers and solid occluders.
  chambers.push(
    createChamber('skyVault', MAIN.x, MAIN.y, MAIN.z, 385, 145, 335, MOSS)
  );

  // Soft rooms inside and around the main volume.
  chambers.push(createChamber('westLanding', 265, 248, 570, 45, 11, 34, MOSS));
  chambers.push(createChamber('northRim', 545, 285, 810, 66, 13, 34, MOSS));
  chambers.push(
    createChamber('eastHangar', 870, 202, 575, 52, 28, 48, MACHINE)
  );
  chambers.push(createChamber('southRidge', 538, 236, 275, 50, 13, 28, MOSS));
  chambers.push(createChamber('waterBasin', 418, 92, 480, 78, 13, 62, ICE));
  chambers.push(createChamber('lowerFalls', 660, 84, 430, 54, 12, 44, ICE));
  chambers.push(createChamber('lavaTrench', 760, 98, 735, 92, 14, 54, AMBER));
  chambers.push(createChamber('emberAlcove', 925, 145, 790, 48, 25, 42, AMBER));
  chambers.push(
    createChamber('farSkyMouth', 565, 225, 1015, 105, 54, 84, MOSS)
  );
  chambers.push(
    createChamber('farLoadVista', 565, 235, 1270, 145, 62, 92, MOSS)
  );

  // Major line-of-sight breakers: selective spires and formations.
  addSolid(
    chambers,
    createChamber('spireMain', 545, 185, 610, 34, 165, 30, MOSS, 'spire')
  );
  addSolid(
    chambers,
    createChamber('spireMinor', 390, 160, 520, 14, 65, 14, MOSS, 'spire')
  );
  addSolid(
    chambers,
    createChamber('lavaSpire', 742, 152, 700, 22, 85, 18, AMBER, 'spire')
  );
  addSolid(
    chambers,
    createChamber('eastOverhang', 820, 260, 545, 88, 22, 38, MACHINE, 'island')
  );
  addSolid(
    chambers,
    createChamber('northBridgeLeft', 440, 276, 760, 70, 18, 22, MOSS, 'island')
  );
  addSolid(
    chambers,
    createChamber('northBridgeRight', 700, 278, 790, 76, 18, 24, MOSS, 'island')
  );

  // Ceiling teeth near the sky holes keep the opening irregular.
  addSolid(
    chambers,
    createChamber('ceilingToothWest', 430, 302, 620, 22, 46, 24, MOSS, 'spire')
  );
  addSolid(
    chambers,
    createChamber('ceilingToothEast', 695, 310, 640, 24, 48, 26, MOSS, 'spire')
  );
  addSolid(
    chambers,
    createChamber('ceilingToothFar', 570, 324, 805, 26, 44, 22, MOSS, 'spire')
  );

  return chambers;
}

function buildTunnels() {
  var tunnels = [];

  tunnels.push(createTunnel('spawn', 'skyVault', 25, -2, MOSS, true));

  tunnels.push(createTunnel('westLanding', 'northRim', 16, 2, MOSS, false));
  tunnels.push(createTunnel('northRim', 'farSkyMouth', 18, -4, MOSS, false));
  tunnels.push(createTunnel('farSkyMouth', 'farLoadVista', 28, 2, MOSS, true));
  tunnels.push(
    createTunnel('eastHangar', 'emberAlcove', 16, 3, MACHINE, false)
  );
  tunnels.push(createTunnel('emberAlcove', 'lavaTrench', 16, -4, AMBER, false));
  tunnels.push(createTunnel('waterBasin', 'lowerFalls', 15, -6, ICE, false));
  tunnels.push(createTunnel('lowerFalls', 'lavaTrench', 14, 5, AMBER, false));
  tunnels.push(createTunnel('southRidge', 'westLanding', 15, 4, MOSS, false));
  tunnels.push(
    createTunnel('southRidge', 'eastHangar', 15, -1, MACHINE, false)
  );
  tunnels.push(
    createTunnel('westLanding', 'eastHangar', 18, 0, MACHINE, false)
  );
  tunnels.push(createTunnel('northRim', 'lavaTrench', 15, -8, AMBER, false));

  return tunnels;
}

function buildSkyOpenings() {
  var baseY = MAIN.y + 128;
  var topY = MAIN.y + 286;

  return [
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x - 45, y: baseY, z: MAIN.z + 28 },
      radius: { x: 74, y: 0, z: 58 },
      topY: topY,
    },
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x + 48, y: baseY + 6, z: MAIN.z + 78 },
      radius: { x: 56, y: 0, z: 46 },
      topY: topY + 12,
    },
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x + 5, y: baseY - 8, z: MAIN.z - 90 },
      radius: { x: 44, y: 0, z: 34 },
      topY: topY - 18,
    },
    {
      chamberId: 'farSkyMouth',
      center: { x: 565, y: 288, z: 1015 },
      radius: { x: 68, y: 0, z: 52 },
      topY: 485,
    },
    {
      chamberId: 'farLoadVista',
      center: { x: 565, y: 306, z: 1270 },
      radius: { x: 88, y: 0, z: 58 },
      topY: 520,
    },
  ];
}

export var level03SkyVault = {
  id: 'level-03-sky-vault',
  name: 'Sky Vault',
  seed: 'level-03',
  startingChamber: {
    center: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    radius: { x: 56, y: 32, z: 56 },
  },
  startingRotation: { x: 0, y: Math.atan2(405, 445), z: 0 },
  graph: {
    chambers: buildChambers(),
    tunnels: buildTunnels(),
  },
  skyOpenings: buildSkyOpenings(),
  farShell: {
    enabled: true,
    shells: [
      {
        blockSize: 4,
        fadeNear: 320,
        fadeFar: 420,
        fadeOutNear: 760,
        fadeOutFar: 840,
        maxOpacity: 0.82,
        depthWrite: true,
      },
      {
        blockSize: 8,
        fadeNear: 700,
        fadeFar: 800,
        fadeOutNear: 99999,
        fadeOutFar: 99999,
        maxOpacity: 0.72,
        depthWrite: true,
      },
    ],
  },
  fog: {
    color: 0x789486,
    near: 58,
    far: 520,
  },
};
