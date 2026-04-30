import { makeNoise3D } from 'open-simplex-noise';
import { VOXEL_TYPES } from './voxel-types.js';
import { CHUNK_SIZE_VOXELS, WORLD_UNITS_PER_VOXEL } from './world-units.js';

const BIOMES = {
  machine: {
    id: 'machine',
    wallVoxelType: VOXEL_TYPES.MACHINE,
    lightVoxelType: VOXEL_TYPES.LAMP,
    lightFrequency: 0.11,
    lightThreshold: 0.54,
    lightBand: 1.3,
  },
  moss: {
    id: 'moss',
    wallVoxelType: VOXEL_TYPES.MOSS,
    lightVoxelType: VOXEL_TYPES.GLOW_POD,
    lightFrequency: 0.05,
    lightThreshold: 0.64,
    lightBand: 1.15,
  },
  amber: {
    id: 'amber',
    wallVoxelType: VOXEL_TYPES.AMBER,
    lightVoxelType: VOXEL_TYPES.EMBER_VENT,
    lightFrequency: 0.09,
    lightThreshold: 0.48,
    lightBand: 1.2,
  },
  ice: {
    id: 'ice',
    wallVoxelType: VOXEL_TYPES.ICE,
    lightVoxelType: VOXEL_TYPES.GLOW_POD,
    lightFrequency: 0.08,
    lightThreshold: 0.5,
    lightBand: 1.1,
  },
};

const DEFAULT_ACTIVE_BIOME_ID = 'moss';

function getActiveBiomeId(config) {
  const biomeId = config.activeBiomeId || DEFAULT_ACTIVE_BIOME_ID;

  return BIOMES[biomeId] ? biomeId : DEFAULT_ACTIVE_BIOME_ID;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function scaleScalar(value, factor) {
  return value * factor;
}

function scaleVector(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  };
}

function createChamber(id, x, y, z, radiusX, radiusY, radiusZ, biomeId, kind) {
  return {
    id,
    center: { x, y, z },
    radius: { x: radiusX, y: radiusY, z: radiusZ },
    biomeId,
    kind: kind || 'ellipsoid',
  };
}

function createTunnel(
  from,
  to,
  radius,
  sag = 0,
  biomeId = null,
  isMainRoute = false
) {
  return {
    from,
    to,
    radius,
    sag,
    biomeId,
    isMainRoute,
  };
}

function createScaledChamber(
  config,
  id,
  origin,
  offset,
  radius,
  biomeId,
  kind
) {
  const lane = config.layout.laneSpacing;
  const height = config.layout.heightStep;
  const scale = config.voxelScale * config.layout.chamberScale;

  return createChamber(
    id,
    origin.x + offset.x * lane,
    origin.y + offset.y * height,
    origin.z + offset.z * lane,
    radius.x * scale,
    radius.y * scale,
    radius.z * scale,
    biomeId,
    kind
  );
}

function isInsideEllipsoid(point, center, radius) {
  const dx = (point.x - center.x) / radius.x;
  const dy = (point.y - center.y) / radius.y;
  const dz = (point.z - center.z) / radius.z;

  return dx * dx + dy * dy + dz * dz <= 1;
}

function getGraphLayout(config) {
  const center = config.startingChamber.center;
  const activeBiomeId = getActiveBiomeId(config);
  const tunnelScale = config.voxelScale * config.layout.tunnelScale;
  // Offsets, chamber radii, and tunnel radii below are authored in world
  // units. With the default unit model, that also means voxel units.
  // The current standard-voxel rocket is about 7 voxels wide and 8 voxels
  // long, so route tunnels need generous radius to keep the arcade view clear.
  const spawnTunnelRadiusUnits = 10.4;
  const mainTunnelRadiusUnits = 10.6;
  const branchTunnelRadiusUnits = 9.2;
  const route = [
    {
      id: 'hub',
      offset: { x: 0, y: 0, z: 0.66 },
      radius: { x: 34, y: 21, z: 34 },
      biomeId: 'moss',
    },
    {
      id: 'gallery',
      offset: { x: -0.95, y: -0.3, z: 1.65 },
      radius: { x: 28, y: 17, z: 31 },
      biomeId: 'amber',
    },
    {
      id: 'basin',
      offset: { x: -0.35, y: 0.52, z: 2.62 },
      radius: { x: 32, y: 19, z: 30 },
      biomeId: 'ice',
    },
    {
      id: 'crossroads',
      offset: { x: 0.92, y: -0.12, z: 3.56 },
      radius: { x: 36, y: 20, z: 34 },
      biomeId: 'machine',
    },
    {
      id: 'deepHall',
      offset: { x: 1.45, y: 0.72, z: 4.52 },
      radius: { x: 30, y: 18, z: 35 },
      biomeId: 'moss',
    },
    {
      id: 'spireHall',
      offset: { x: 0.18, y: -0.9, z: 5.46 },
      radius: { x: 29, y: 24, z: 29 },
      biomeId: 'ice',
    },
    {
      id: 'vault',
      offset: { x: -1.16, y: -0.18, z: 6.38 },
      radius: { x: 34, y: 19, z: 32 },
      biomeId: 'amber',
    },
    {
      id: 'reservoir',
      offset: { x: -0.42, y: 0.78, z: 7.32 },
      radius: { x: 33, y: 18, z: 37 },
      biomeId: 'ice',
    },
    {
      id: 'forge',
      offset: { x: 1.05, y: 0.08, z: 8.24 },
      radius: { x: 35, y: 20, z: 31 },
      biomeId: 'machine',
    },
    {
      id: 'rim',
      offset: { x: 0.1, y: -0.68, z: 9.16 },
      radius: { x: 31, y: 18, z: 34 },
      biomeId: 'moss',
    },
    {
      id: 'terminus',
      offset: { x: -0.86, y: 0.18, z: 10.08 },
      radius: { x: 36, y: 21, z: 36 },
      biomeId: 'amber',
    },
  ];
  const sideChambers = [
    {
      id: 'westPocket',
      offset: { x: -1.92, y: 0.2, z: 1.0 },
      radius: { x: 22, y: 14, z: 23 },
      biomeId: 'machine',
      from: 'hub',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: 1,
    },
    {
      id: 'upperPocket',
      offset: { x: -0.15, y: -1.55, z: 2.42 },
      radius: { x: 21, y: 15, z: 22 },
      biomeId: 'ice',
      from: 'gallery',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: -5,
    },
    {
      id: 'lowerPocket',
      offset: { x: 0.32, y: 1.55, z: 3.14 },
      radius: { x: 24, y: 15, z: 22 },
      biomeId: 'amber',
      from: 'basin',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: 5,
    },
    {
      id: 'eastPocket',
      offset: { x: 2.1, y: -0.42, z: 3.72 },
      radius: { x: 24, y: 14, z: 24 },
      biomeId: 'moss',
      from: 'crossroads',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: -2,
    },
    {
      id: 'deepPocket',
      offset: { x: 2.08, y: 1.28, z: 5.06 },
      radius: { x: 23, y: 15, z: 25 },
      biomeId: 'machine',
      from: 'deepHall',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: 4,
    },
    {
      id: 'spirePocket',
      offset: { x: 0.88, y: -1.82, z: 5.84 },
      radius: { x: 22, y: 17, z: 22 },
      biomeId: 'ice',
      from: 'spireHall',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: -5,
    },
    {
      id: 'vaultPocket',
      offset: { x: -2.04, y: -0.58, z: 6.82 },
      radius: { x: 23, y: 14, z: 23 },
      biomeId: 'amber',
      from: 'vault',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: -2,
    },
    {
      id: 'reservoirPocket',
      offset: { x: -1.2, y: 1.78, z: 7.78 },
      radius: { x: 25, y: 15, z: 23 },
      biomeId: 'ice',
      from: 'reservoir',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: 5,
    },
    {
      id: 'forgePocket',
      offset: { x: 2.08, y: 0.58, z: 8.68 },
      radius: { x: 24, y: 15, z: 24 },
      biomeId: 'machine',
      from: 'forge',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: 2,
    },
    {
      id: 'rimPocket',
      offset: { x: 0.92, y: -1.42, z: 9.74 },
      radius: { x: 22, y: 15, z: 23 },
      biomeId: 'moss',
      from: 'rim',
      tunnelRadiusUnits: branchTunnelRadiusUnits,
      sag: -4,
    },
  ];

  const chambers = [
    createChamber(
      'spawn',
      center.x,
      center.y,
      center.z,
      config.startingChamber.radius.x,
      config.startingChamber.radius.y,
      config.startingChamber.radius.z,
      activeBiomeId
    ),
  ];

  for (const chamberConfig of route) {
    chambers.push(
      createScaledChamber(
        config,
        chamberConfig.id,
        center,
        chamberConfig.offset,
        chamberConfig.radius,
        activeBiomeId
      )
    );
  }

  for (const chamberConfig of sideChambers) {
    chambers.push(
      createScaledChamber(
        config,
        chamberConfig.id,
        center,
        chamberConfig.offset,
        chamberConfig.radius,
        activeBiomeId
      )
    );
  }

  const tunnels = [
    createTunnel(
      'spawn',
      'hub',
      spawnTunnelRadiusUnits * tunnelScale,
      -1,
      activeBiomeId,
      true
    ),
  ];
  let previousId = 'hub';
  for (const chamberConfig of route.slice(1)) {
    tunnels.push(
      createTunnel(
        previousId,
        chamberConfig.id,
        mainTunnelRadiusUnits * tunnelScale,
        0,
        activeBiomeId,
        true
      )
    );
    previousId = chamberConfig.id;
  }

  for (const chamberConfig of sideChambers) {
    tunnels.push(
      createTunnel(
        chamberConfig.from,
        chamberConfig.id,
        chamberConfig.tunnelRadiusUnits * tunnelScale,
        chamberConfig.sag * tunnelScale,
        activeBiomeId
      )
    );
  }

  tunnels.push(
    createTunnel(
      'gallery',
      'basin',
      branchTunnelRadiusUnits * tunnelScale,
      4 * tunnelScale,
      activeBiomeId
    )
  );
  tunnels.push(
    createTunnel(
      'crossroads',
      'deepPocket',
      branchTunnelRadiusUnits * tunnelScale,
      3 * tunnelScale,
      activeBiomeId
    )
  );
  tunnels.push(
    createTunnel(
      'vault',
      'reservoirPocket',
      branchTunnelRadiusUnits * tunnelScale,
      4 * tunnelScale,
      activeBiomeId
    )
  );
  tunnels.push(
    createTunnel(
      'forge',
      'rimPocket',
      branchTunnelRadiusUnits * tunnelScale,
      -4 * tunnelScale,
      activeBiomeId
    )
  );

  return { chambers, tunnels };
}

function getSegmentPoint(start, end, t, sag) {
  const position = {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t),
  };

  if (sag !== 0) {
    position.y += Math.sin(Math.PI * t) * sag;
  }

  return position;
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function pointToSegmentDistance(point, start, end) {
  const abX = end.x - start.x;
  const abY = end.y - start.y;
  const abZ = end.z - start.z;
  const apX = point.x - start.x;
  const apY = point.y - start.y;
  const apZ = point.z - start.z;
  const abLengthSq = abX * abX + abY * abY + abZ * abZ;

  if (abLengthSq === 0) {
    return Math.sqrt(distanceSquared(point, start));
  }

  const projection = clamp(
    (apX * abX + apY * abY + apZ * abZ) / abLengthSq,
    0,
    1
  );
  const closest = {
    x: start.x + abX * projection,
    y: start.y + abY * projection,
    z: start.z + abZ * projection,
  };

  return Math.sqrt(distanceSquared(point, closest));
}

function buildTunnelSegments(graph, chambersById) {
  const tunnels = [];

  for (const tunnel of graph.tunnels) {
    const startChamber = chambersById.get(tunnel.from);
    const endChamber = chambersById.get(tunnel.to);
    const start = startChamber.center;
    const end = endChamber.center;
    const pointCount = 6;
    const points = [];

    for (let i = 0; i <= pointCount; i++) {
      points.push(getSegmentPoint(start, end, i / pointCount, tunnel.sag));
    }

    tunnels.push({
      id: `${tunnel.from}:${tunnel.to}`,
      biomeId: tunnel.biomeId || startChamber.biomeId || endChamber.biomeId,
      radius: tunnel.radius,
      points,
    });
  }

  return tunnels;
}

function getDistanceToTunnel(point, tunnel) {
  let minDistance = Infinity;

  for (let i = 0; i < tunnel.points.length - 1; i++) {
    const segmentDistance = pointToSegmentDistance(
      point,
      tunnel.points[i],
      tunnel.points[i + 1]
    );

    if (segmentDistance < minDistance) {
      minDistance = segmentDistance;
    }
  }

  return minDistance - tunnel.radius;
}

function getDistanceToChamber(point, chamber) {
  const dx = (point.x - chamber.center.x) / chamber.radius.x;
  const dy = (point.y - chamber.center.y) / chamber.radius.y;
  const dz = (point.z - chamber.center.z) / chamber.radius.z;
  const scaledDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const averageRadius =
    (chamber.radius.x + chamber.radius.y + chamber.radius.z) / 3;

  return (scaledDistance - 1) * averageRadius;
}

function getDistanceToBounds(point, bounds) {
  const dx =
    point.x < bounds.minX
      ? bounds.minX - point.x
      : point.x > bounds.maxX
        ? point.x - bounds.maxX
        : 0;
  const dy =
    point.y < bounds.minY
      ? bounds.minY - point.y
      : point.y > bounds.maxY
        ? point.y - bounds.maxY
        : 0;
  const dz =
    point.z < bounds.minZ
      ? bounds.minZ - point.z
      : point.z > bounds.maxZ
        ? point.z - bounds.maxZ
        : 0;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getChamberFeatureBounds(chamber, padding) {
  return {
    minX: chamber.center.x - chamber.radius.x - padding,
    minY: chamber.center.y - chamber.radius.y - padding,
    minZ: chamber.center.z - chamber.radius.z - padding,
    maxX: chamber.center.x + chamber.radius.x + padding,
    maxY: chamber.center.y + chamber.radius.y + padding,
    maxZ: chamber.center.z + chamber.radius.z + padding,
  };
}

function getTunnelFeatureBounds(tunnel, padding) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  const radius = tunnel.radius + padding;

  for (const point of tunnel.points) {
    bounds.minX = Math.min(bounds.minX, point.x - radius);
    bounds.minY = Math.min(bounds.minY, point.y - radius);
    bounds.minZ = Math.min(bounds.minZ, point.z - radius);
    bounds.maxX = Math.max(bounds.maxX, point.x + radius);
    bounds.maxY = Math.max(bounds.maxY, point.y + radius);
    bounds.maxZ = Math.max(bounds.maxZ, point.z + radius);
  }

  return bounds;
}

function createCaveFeatures(chambers, tunnels, padding) {
  const features = [];

  for (const chamber of chambers) {
    features.push({
      kind: chamber.isSolid ? 'solid-chamber' : 'chamber',
      biomeId: chamber.biomeId,
      source: chamber,
      bounds: getChamberFeatureBounds(chamber, padding),
    });
  }

  for (const tunnel of tunnels) {
    features.push({
      kind: 'tunnel',
      biomeId: tunnel.biomeId,
      source: tunnel,
      bounds: getTunnelFeatureBounds(tunnel, padding),
    });
  }

  return features;
}

function getPlayfieldBounds(graph, margin) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };

  for (const chamber of graph.chambers) {
    bounds.minX = Math.min(bounds.minX, chamber.center.x - chamber.radius.x);
    bounds.minY = Math.min(bounds.minY, chamber.center.y - chamber.radius.y);
    bounds.minZ = Math.min(bounds.minZ, chamber.center.z - chamber.radius.z);
    bounds.maxX = Math.max(bounds.maxX, chamber.center.x + chamber.radius.x);
    bounds.maxY = Math.max(bounds.maxY, chamber.center.y + chamber.radius.y);
    bounds.maxZ = Math.max(bounds.maxZ, chamber.center.z + chamber.radius.z);
  }

  bounds.minX -= margin;
  bounds.minY -= margin;
  bounds.minZ -= margin;
  bounds.maxX += margin;
  bounds.maxY += margin;
  bounds.maxZ += margin;

  return bounds;
}

function createSkyOpenings(graph, activeBiomeId) {
  const candidates = graph.chambers.filter(function (chamber) {
    return chamber.id !== 'spawn' && chamber.biomeId === activeBiomeId;
  });

  if (candidates.length === 0) {
    return [];
  }

  const preferredIds = ['hub', 'deepHall', 'rim'];
  const openings = [];

  for (const chamberId of preferredIds) {
    const chamber = candidates.find(function (entry) {
      return entry.id === chamberId;
    });

    if (!chamber) {
      continue;
    }

    openings.push({
      chamberId: chamber.id,
      center: {
        x: chamber.center.x,
        y: chamber.center.y + chamber.radius.y * 0.88,
        z: chamber.center.z,
      },
      radius: {
        x: Math.max(10, chamber.radius.x * 0.22),
        y: Math.max(16, chamber.radius.y * 0.95),
        z: Math.max(10, chamber.radius.z * 0.22),
      },
      topY: chamber.center.y + chamber.radius.y + 64,
    });
  }

  return openings;
}

export function createTerrainGenerator(config = {}) {
  const voxelSize =
    typeof config.voxelSize === 'number' && config.voxelSize > 0
      ? config.voxelSize
      : WORLD_UNITS_PER_VOXEL;
  const voxelScale = 1 / voxelSize;
  // Authored terrain numbers are in world units. The generator stores and
  // samples voxel-grid coordinates internally, so changing voxel size only
  // affects this conversion boundary.
  const baseDefaultConfig = {
    seed: 12345,
    chunkSize: CHUNK_SIZE_VOXELS,
    worldMargin: 52,
    surfaceBiomeBand: 5.5,
    startingChamber: {
      center: { x: 160, y: 160, z: 160 },
      radius: { x: 56, y: 32, z: 56 },
      crystalSafeRadius: { x: 72, y: 44, z: 72 },
    },
    layout: {
      laneSpacing: 148,
      heightStep: 64,
      chamberScale: 1.6,
      tunnelScale: 1.65,
    },
    roughness: {
      frequency: 0.075,
      strength: 1.2,
      boundaryBand: 3.5,
    },
  };

  const rawStartingChamber = {
    ...baseDefaultConfig.startingChamber,
    ...(config.startingChamber || {}),
  };
  const rawLayout = {
    ...baseDefaultConfig.layout,
    ...(config.layout || {}),
  };
  const rawRoughness = {
    ...baseDefaultConfig.roughness,
    ...(config.roughness || {}),
  };

  const finalConfig = {
    ...baseDefaultConfig,
    ...config,
    chunkSize:
      typeof config.chunkSize === 'number'
        ? config.chunkSize
        : Math.round(baseDefaultConfig.chunkSize * voxelScale),
    activeBiomeId: getActiveBiomeId(config),
    voxelSize,
    voxelScale,
    startingChamber: {
      center: scaleVector(rawStartingChamber.center, voxelScale),
      radius: scaleVector(rawStartingChamber.radius, voxelScale),
      crystalSafeRadius: scaleVector(
        rawStartingChamber.crystalSafeRadius,
        voxelScale
      ),
    },
    layout: {
      ...rawLayout,
      laneSpacing: scaleScalar(rawLayout.laneSpacing, voxelScale),
      heightStep: scaleScalar(rawLayout.heightStep, voxelScale),
    },
    roughness: {
      ...rawRoughness,
      strength: scaleScalar(rawRoughness.strength, voxelScale),
      boundaryBand: scaleScalar(rawRoughness.boundaryBand, voxelScale),
    },
    worldMargin: scaleScalar(
      config.worldMargin !== undefined
        ? config.worldMargin
        : baseDefaultConfig.worldMargin,
      voxelScale
    ),
    surfaceBiomeBand: scaleScalar(
      config.surfaceBiomeBand !== undefined
        ? config.surfaceBiomeBand
        : baseDefaultConfig.surfaceBiomeBand,
      voxelScale
    ),
  };

  const graph = config.graph || getGraphLayout(finalConfig);
  const chambersById = new Map();

  for (const chamber of graph.chambers) {
    chambersById.set(chamber.id, chamber);
  }

  const playfieldBounds = getPlayfieldBounds(graph, finalConfig.worldMargin);
  const caveChambers = graph.chambers;
  const skyOpenings =
    config.skyOpenings || createSkyOpenings(graph, finalConfig.activeBiomeId);
  const noiseGenerators = {
    roughness: makeNoise3D(finalConfig.seed + 41),
    lights: makeNoise3D(finalConfig.seed + 53),
    terraces: makeNoise3D(finalConfig.seed + 67),
    hangings: makeNoise3D(finalConfig.seed + 79),
  };
  const tunnelSegments = buildTunnelSegments(
    {
      tunnels: graph.tunnels,
    },
    chambersById
  );
  const featureSearchDistance =
    finalConfig.surfaceBiomeBand +
    finalConfig.roughness.boundaryBand +
    finalConfig.roughness.strength +
    4 * finalConfig.voxelScale;
  const caveFeatures = createCaveFeatures(
    caveChambers,
    tunnelSegments,
    featureSearchDistance
  );
  return {
    config: finalConfig,
    graph,
    biomes: BIOMES,
    playfieldBounds,
    noise: noiseGenerators,
    skyOpenings,

    isInsideSkyOpening(x, y, z) {
      for (const opening of skyOpenings) {
        if (y < opening.center.y || y > opening.topY) {
          continue;
        }

        const dx = (x - opening.center.x) / opening.radius.x;
        const dz = (z - opening.center.z) / opening.radius.z;
        const radial = dx * dx + dz * dz;

        if (radial <= 1) {
          return true;
        }
      }

      return false;
    },

    isInsideSolidChamber(x, y, z, chamber) {
      const dx = (x - chamber.center.x) / chamber.radius.x;
      const dy = (y - chamber.center.y) / chamber.radius.y;
      const dz = (z - chamber.center.z) / chamber.radius.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > 2.5) {
        return false;
      }

      const kind = chamber.kind || 'ellipsoid';
      const noise =
        this.noise.roughness(
          x * 0.08 * finalConfig.voxelSize,
          y * 0.08 * finalConfig.voxelSize,
          z * 0.08 * finalConfig.voxelSize
        ) * 0.16;

      if (kind === 'spire') {
        const horizontalDistSq = dx * dx + dz * dz;
        const taper = 1.0 - Math.pow(Math.abs(dy), 6);
        return Math.abs(dy) <= 1.0 && horizontalDistSq <= taper + noise;
      }

      if (kind === 'island') {
        if (dy > 0.85) return false;
        if (dy < -1.0) return false;
        const horizontalDistSq = dx * dx + dz * dz;
        let profile = 1.0;
        if (dy > 0.35) {
          profile = 1.15;
        } else if (dy < 0) {
          profile = 1.0 + dy;
        }
        return horizontalDistSq <= profile * profile + noise;
      }

      return distSq <= 1.0 + noise;
    },

    generateChunk(chunkX, chunkY, chunkZ) {
      const chunk = new Uint8Array(
        finalConfig.chunkSize * finalConfig.chunkSize * finalConfig.chunkSize
      );
      const startX = chunkX * finalConfig.chunkSize;
      const startY = chunkY * finalConfig.chunkSize;
      const startZ = chunkZ * finalConfig.chunkSize;

      for (let y = 0; y < finalConfig.chunkSize; y++) {
        for (let z = 0; z < finalConfig.chunkSize; z++) {
          for (let x = 0; x < finalConfig.chunkSize; x++) {
            const worldX = startX + x;
            const worldY = startY + y;
            const worldZ = startZ + z;
            const voxelType = this.generateVoxel(worldX, worldY, worldZ);

            if (voxelType > 0) {
              const voxelIndex =
                x +
                y * finalConfig.chunkSize +
                z * finalConfig.chunkSize * finalConfig.chunkSize;
              chunk[voxelIndex] = voxelType;
            }
          }
        }
      }

      return chunk;
    },

    isInsidePlayfield(x, y, z) {
      return (
        x >= playfieldBounds.minX &&
        x <= playfieldBounds.maxX &&
        y >= playfieldBounds.minY &&
        y <= playfieldBounds.maxY &&
        z >= playfieldBounds.minZ &&
        z <= playfieldBounds.maxZ
      );
    },

    getFeatureInfo(x, y, z) {
      const point = { x, y, z };
      let bestDistance = featureSearchDistance;
      let bestBiomeId = 'moss';
      let bestKind = 'chamber';
      let bestSource = caveChambers[0];

      for (const feature of caveFeatures) {
        if (getDistanceToBounds(point, feature.bounds) > 0) {
          continue;
        }

        if (feature.kind === 'solid-chamber') {
          if (this.isInsideSolidChamber(x, y, z, feature.source)) {
            return {
              distance: -999,
              biomeId: feature.biomeId,
              biome: BIOMES[feature.biomeId] || BIOMES.moss,
              kind: 'solid-chamber',
              source: feature.source,
            };
          }
          continue;
        }

        const distance =
          feature.kind === 'chamber'
            ? getDistanceToChamber(point, feature.source)
            : getDistanceToTunnel(point, feature.source);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestBiomeId = feature.biomeId;
          bestKind = feature.kind;
          bestSource = feature.source;
        }
      }

      return {
        distance: bestDistance,
        biomeId: bestBiomeId,
        biome: BIOMES[bestBiomeId] || BIOMES.moss,
        kind: bestKind,
        source: bestSource,
      };
    },

    getBiomeType(x, y, z) {
      return this.getFeatureInfo(x, y, z).biomeId;
    },

    getChamberLocalMetrics(x, y, z, chamber) {
      const localX = (x - chamber.center.x) / chamber.radius.x;
      const localY = (y - chamber.center.y) / chamber.radius.y;
      const localZ = (z - chamber.center.z) / chamber.radius.z;

      return {
        localX,
        localY,
        localZ,
        horizontal: Math.sqrt(localX * localX + localZ * localZ),
      };
    },

    shouldForceMossClearing(x, y, z, feature, caveDistance) {
      if (
        !feature ||
        feature.biomeId !== 'moss' ||
        feature.kind !== 'chamber' ||
        !feature.source ||
        feature.source.id === 'spawn' ||
        caveDistance > -0.24
      ) {
        return false;
      }

      const metrics = this.getChamberLocalMetrics(x, y, z, feature.source);
      if (
        metrics.horizontal > 0.34 ||
        metrics.localY < -0.9 ||
        metrics.localY > -0.16
      ) {
        return false;
      }

      const clearingNoise = this.noise.terraces(
        x * 0.024 * finalConfig.voxelSize + 19.7,
        3.1,
        z * 0.024 * finalConfig.voxelSize - 11.2
      );

      return clearingNoise > -0.12;
    },

    shouldPlaceMossTerrace(x, y, z, feature, caveDistance) {
      if (
        !feature ||
        feature.biomeId !== 'moss' ||
        feature.kind !== 'chamber' ||
        !feature.source ||
        feature.source.id === 'spawn' ||
        caveDistance > -0.35
      ) {
        return false;
      }

      const metrics = this.getChamberLocalMetrics(x, y, z, feature.source);
      if (
        metrics.horizontal < 0.36 ||
        metrics.horizontal > 0.94 ||
        metrics.localY < -0.9 ||
        metrics.localY > -0.18
      ) {
        return false;
      }

      const terraceNoise = this.noise.terraces(
        x * 0.032 * finalConfig.voxelSize,
        y * 0.046 * finalConfig.voxelSize,
        z * 0.032 * finalConfig.voxelSize
      );
      const terraceStep = clamp(
        Math.floor(
          (metrics.horizontal - 0.32) * 5.4 + (terraceNoise + 1) * 0.7
        ),
        0,
        3
      );
      const terraceHeight = -0.84 + terraceStep * 0.14;

      return metrics.localY <= terraceHeight;
    },

    shouldPlaceMossHangingGrowth(x, y, z, feature, caveDistance) {
      if (
        !feature ||
        feature.biomeId !== 'moss' ||
        feature.kind !== 'chamber' ||
        !feature.source ||
        feature.source.id === 'spawn' ||
        caveDistance > -0.6
      ) {
        return false;
      }

      const metrics = this.getChamberLocalMetrics(x, y, z, feature.source);
      if (
        metrics.horizontal < 0.42 ||
        metrics.horizontal > 0.88 ||
        metrics.localY < 0.34
      ) {
        return false;
      }

      const clusterNoise = this.noise.hangings(
        x * 0.018 * finalConfig.voxelSize + 14.2,
        6.4,
        z * 0.018 * finalConfig.voxelSize - 9.1
      );
      if (clusterNoise < 0.28) {
        return false;
      }

      const hangingNoise = this.noise.hangings(
        x * 0.034 * finalConfig.voxelSize,
        y * 0.018 * finalConfig.voxelSize,
        z * 0.034 * finalConfig.voxelSize
      );
      const dropLength =
        0.1 +
        clamp((clusterNoise - 0.28) / 0.72, 0, 1) * 0.24 +
        Math.max(0, hangingNoise) * 0.05;

      return metrics.localY >= 0.92 - dropLength;
    },

    getInteriorFeatureVoxelType(x, y, z, feature, caveDistance) {
      if (this.shouldPlaceMossTerrace(x, y, z, feature, caveDistance)) {
        return feature.biome.wallVoxelType;
      }

      if (this.shouldPlaceMossHangingGrowth(x, y, z, feature, caveDistance)) {
        return feature.biome.wallVoxelType;
      }

      return VOXEL_TYPES.EMPTY;
    },

    generateVoxel(x, y, z) {
      if (this.isInsideSkyOpening(x, y, z)) {
        return VOXEL_TYPES.EMPTY;
      }

      if (!this.isInsidePlayfield(x, y, z)) {
        return VOXEL_TYPES.ROCK;
      }

      const spawnCenter = finalConfig.startingChamber.center;
      const point = { x, y, z };
      const feature = this.getFeatureInfo(x, y, z);
      const caveDistance = feature.distance;

      if (feature.kind === 'solid-chamber') {
        return feature.biome.wallVoxelType;
      }

      if (
        isInsideEllipsoid(
          point,
          spawnCenter,
          finalConfig.startingChamber.radius
        )
      ) {
        return VOXEL_TYPES.EMPTY;
      }

      if (this.shouldForceMossClearing(x, y, z, feature, caveDistance)) {
        return VOXEL_TYPES.EMPTY;
      }

      const interiorFeatureVoxel = this.getInteriorFeatureVoxelType(
        x,
        y,
        z,
        feature,
        caveDistance
      );
      if (interiorFeatureVoxel !== VOXEL_TYPES.EMPTY) {
        return interiorFeatureVoxel;
      }

      if (caveDistance <= -0.75) {
        return VOXEL_TYPES.EMPTY;
      }

      if (caveDistance <= finalConfig.roughness.boundaryBand) {
        const roughness =
          this.noise.roughness(
            x * finalConfig.roughness.frequency * finalConfig.voxelSize,
            y * finalConfig.roughness.frequency * finalConfig.voxelSize,
            z * finalConfig.roughness.frequency * finalConfig.voxelSize
          ) * finalConfig.roughness.strength;
        const carveThreshold = clamp(roughness, -2.5, 2.5);
        const carveAllowance =
          feature.kind === 'chamber'
            ? 0.28
            : feature.kind === 'tunnel'
              ? 0.14
              : 0.2;

        if (caveDistance - carveThreshold <= carveAllowance) {
          return VOXEL_TYPES.EMPTY;
        }
      }

      if (caveDistance <= finalConfig.surfaceBiomeBand) {
        return feature.biome.wallVoxelType;
      }

      return VOXEL_TYPES.ROCK;
    },
  };
}

export {
  BIOMES,
  getActiveBiomeId,
  createChamber,
  createTunnel,
  createScaledChamber,
  isInsideEllipsoid,
  getGraphLayout,
  clamp,
  lerp,
  scaleVector,
  scaleScalar,
  getPlayfieldBounds,
  createSkyOpenings,
  getChamberFeatureBounds,
  getTunnelFeatureBounds,
};
