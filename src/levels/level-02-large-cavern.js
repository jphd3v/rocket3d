import { createChamber, createTunnel } from '../terrain-generation.js';

var SPAWN = { x: 160, y: 160, z: 160 };
var MAIN = { x: 337, y: 175, z: 337 };

var MOSS = 'moss';
var ICE = 'ice';
var MACHINE = 'machine';
var AMBER = 'amber';

function buildChambers() {
  var chambers = [];

  chambers.push(
    createChamber('spawn', SPAWN.x, SPAWN.y, SPAWN.z, 56, 32, 56, MOSS)
  );

  chambers.push(createChamber('knot', 275, 165, 275, 18, 15, 18, MOSS));

  // Main cavern
  chambers.push(
    createChamber('mainChamber', MAIN.x, MAIN.y, MAIN.z, 240, 105, 195, MOSS)
  );

  // --- Sub-areas integrated into the main chamber ---

  // Landing pad on elevated west ledge (protected, left side)
  chambers.push(createChamber('landingLedge', 152, 208, 335, 28, 7, 20, MOSS));

  // Water basin in lower southwest
  chambers.push(createChamber('waterBasin', 265, 92, 262, 38, 9, 32, ICE));

  // Lava hazard on lower southeast
  chambers.push(createChamber('lavaTrench', 455, 100, 462, 34, 8, 28, AMBER));

  // Upper north ledge — elevated platform
  chambers.push(createChamber('northLedge', 328, 236, 472, 32, 7, 18, MOSS));

  // East alcove — machine biome side area
  chambers.push(
    createChamber('eastAlcove', 532, 175, 372, 20, 15, 20, MACHINE)
  );

  // South ridge — narrow elevated path
  chambers.push(createChamber('southRidge', 308, 196, 166, 18, 9, 10, MOSS));

  // --- Occlusion: pillars (floor to ceiling) ---

  chambers.push(createChamber('pillarCenter', 337, 175, 345, 5, 55, 5, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('pillarWest', 227, 170, 315, 7, 38, 7, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('pillarEast', 440, 170, 368, 8, 42, 8, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  // --- Occlusion: stalactites (hanging from ceiling) ---

  chambers.push(createChamber('stalactite_1', 302, 255, 298, 6, 12, 6, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('stalactite_2', 372, 258, 362, 5, 10, 5, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('stalactite_3', 282, 254, 372, 7, 14, 7, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('stalactite_4', 398, 260, 308, 5, 8, 5, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  // --- Occlusion: wall fragments ---

  chambers.push(createChamber('westWallFrag', 145, 178, 245, 5, 22, 8, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  chambers.push(createChamber('eastWallFrag', 498, 172, 485, 5, 18, 8, MOSS));
  chambers[chambers.length - 1].isSolid = true;

  return chambers;
}

function buildTunnels() {
  var tunnels = [];

  // Approach — player path into the cavern
  tunnels.push(createTunnel('spawn', 'knot', 14, 0, MOSS, true));

  tunnels.push(createTunnel('knot', 'mainChamber', 27, -3, MOSS, true));

  // Short tunnel to lava trench (barely outside main chamber)
  tunnels.push(createTunnel('mainChamber', 'lavaTrench', 14, 8, AMBER, false));

  // Cross-cavern route: landing ledge to east alcove
  tunnels.push(
    createTunnel('landingLedge', 'eastAlcove', 15, 2, MACHINE, false)
  );

  // Upper route: north ledge to east alcove
  tunnels.push(
    createTunnel('northLedge', 'eastAlcove', 12, -1, MACHINE, false)
  );

  // Vertical connection: water basin to south ridge
  tunnels.push(createTunnel('waterBasin', 'southRidge', 11, -8, MOSS, false));

  // Landing ledge to north ledge — upper path across the cavern
  tunnels.push(createTunnel('landingLedge', 'northLedge', 13, 1, MOSS, false));

  return tunnels;
}

function buildSkyOpenings() {
  var chamberCenter = { x: MAIN.x, y: MAIN.y, z: MAIN.z };
  var baseY = Math.round(chamberCenter.y + 105 * 0.88);
  var topY = chamberCenter.y + 105 + 96;

  // Large opening cluster at center-east for dramatic light shafts
  return [
    {
      chamberId: 'mainChamber',
      center: { x: chamberCenter.x + 25, y: baseY, z: chamberCenter.z + 15 },
      radius: { x: 40, y: 0, z: 35 },
      topY: topY,
    },
    {
      chamberId: 'mainChamber',
      center: { x: chamberCenter.x + 55, y: baseY, z: chamberCenter.z + 42 },
      radius: { x: 20, y: 0, z: 15 },
      topY: topY,
    },
    {
      chamberId: 'mainChamber',
      center: { x: chamberCenter.x - 10, y: baseY, z: chamberCenter.z - 18 },
      radius: { x: 18, y: 0, z: 22 },
      topY: topY,
    },
    {
      chamberId: 'mainChamber',
      center: { x: chamberCenter.x + 60, y: baseY, z: chamberCenter.z - 20 },
      radius: { x: 14, y: 0, z: 12 },
      topY: topY,
    },
  ];
}

export var level02LargeCavern = {
  id: 'level-02-large-cavern',
  name: 'Large Cavern',
  seed: 'level-02',
  startingChamber: {
    center: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
    radius: { x: 56, y: 32, z: 56 },
  },
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
        fadeNear: 224,
        fadeFar: 320,
        fadeOutNear: 640,
        fadeOutFar: 704,
        maxOpacity: 0.85,
        depthWrite: true,
      },
      {
        blockSize: 8,
        fadeNear: 576,
        fadeFar: 640,
        fadeOutNear: 99999,
        fadeOutFar: 99999,
        maxOpacity: 0.75,
        depthWrite: true,
      },
    ],
  },
  fog: {
    color: 0x6b8a7e,
    near: 50,
    far: 380,
  },
};
