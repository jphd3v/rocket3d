import { createChamber, createTunnel } from '../terrain-generation.js';

var SPAWN = { x: 285, y: 168, z: 258 };
var MAIN = { x: 565, y: 185, z: 565 };
var MAIN_FLOOR_Y = MAIN.y - 145;

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

  // Major line-of-sight breakers: eroded pillars, arch remnants, and ledges.
  addSolid(
    chambers,
    createChamber(
      'vaultPillarWest',
      405,
      MAIN_FLOOR_Y + 132,
      575,
      42,
      132,
      34,
      MOSS,
      'erodedPillar'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'vaultPillarCenter',
      565,
      MAIN_FLOOR_Y + 138,
      650,
      52,
      138,
      42,
      MOSS,
      'erodedPillar'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'vaultPillarEast',
      735,
      MAIN_FLOOR_Y + 128,
      660,
      44,
      128,
      36,
      MOSS,
      'erodedPillar'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'lowerBrokenPier',
      625,
      MAIN_FLOOR_Y + 58,
      505,
      24,
      58,
      22,
      MOSS,
      'erodedPillar'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'lavaButtress',
      770,
      MAIN_FLOOR_Y + 74,
      725,
      36,
      74,
      30,
      AMBER,
      'erodedPillar'
    )
  );
  addSolid(
    chambers,
    createChamber('westArchCap', 470, 302, 625, 82, 22, 30, MOSS, 'archSlab')
  );
  addSolid(
    chambers,
    createChamber('eastArchCap', 680, 304, 675, 88, 22, 32, MOSS, 'archSlab')
  );
  addSolid(
    chambers,
    createChamber('farArchCap', 565, 316, 830, 106, 22, 30, MOSS, 'archSlab')
  );
  addSolid(
    chambers,
    createChamber('eastOverhang', 845, 262, 545, 92, 24, 42, MACHINE, 'island')
  );
  addSolid(
    chambers,
    createChamber(
      'northBridgeLeft',
      430,
      282,
      770,
      82,
      20,
      28,
      MOSS,
      'ceilingLip'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'northBridgeRight',
      715,
      284,
      790,
      86,
      20,
      30,
      MOSS,
      'ceilingLip'
    )
  );

  // Ceiling lips near the skylight keep the opening torn and asymmetric.
  addSolid(
    chambers,
    createChamber(
      'ceilingLipWest',
      412,
      330,
      520,
      62,
      18,
      34,
      MOSS,
      'ceilingLip'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'ceilingLipEast',
      705,
      334,
      555,
      72,
      18,
      38,
      MOSS,
      'ceilingLip'
    )
  );
  addSolid(
    chambers,
    createChamber(
      'ceilingFangFar',
      585,
      318,
      800,
      36,
      42,
      28,
      MOSS,
      'erodedPillar'
    )
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
  var baseY = MAIN.y + 116;
  var topY = MAIN.y + 320;

  return [
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x - 30, y: baseY, z: MAIN.z + 20 },
      radius: { x: 128, y: 0, z: 54 },
      topY: topY,
      angle: -0.28,
      flare: 0.18,
      roughness: 0.14,
    },
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x + 98, y: baseY + 4, z: MAIN.z + 84 },
      radius: { x: 86, y: 0, z: 42 },
      topY: topY + 12,
      angle: 0.42,
      flare: 0.16,
      roughness: 0.13,
    },
    {
      chamberId: 'skyVault',
      center: { x: MAIN.x - 122, y: baseY + 2, z: MAIN.z - 40 },
      radius: { x: 52, y: 0, z: 32 },
      topY: topY - 8,
      angle: 0.15,
      flare: 0.12,
      roughness: 0.15,
    },
    {
      chamberId: 'farSkyMouth',
      center: { x: 565, y: 280, z: 1015 },
      radius: { x: 116, y: 0, z: 62 },
      topY: 520,
      angle: -0.18,
      flare: 0.2,
      roughness: 0.16,
    },
    {
      chamberId: 'farLoadVista',
      center: { x: 565, y: 292, z: 1270 },
      radius: { x: 142, y: 0, z: 64 },
      topY: 548,
      angle: 0.2,
      flare: 0.22,
      roughness: 0.14,
    },
  ];
}

export var level03SkyVault = {
  id: 'level3',
  name: 'Sky Vault',
  seed: 'level3',
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
