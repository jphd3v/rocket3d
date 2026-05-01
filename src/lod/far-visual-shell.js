import * as THREE from 'three';
import {
  getCoarseCellSampleOffsets,
  getCoarseSolidThreshold,
  buildCoarseLodGeometry,
} from './lod-worker-logic.js';
import {
  debugError,
  debugLog,
  debugTime,
  debugTimeEnd,
  debugWarn,
} from '../debug.js';

export function applyLodDistanceFade(material) {
  if (!material || !material.userData || material.userData.lodDistanceFade) {
    return;
  }

  var useAlphaHashFade = material.userData.alphaHashFade === true;
  var useFadeCenter = material.userData.useFadeCenter === true;

  material.userData.lodDistanceFade = true;
  material.transparent = !useAlphaHashFade;
  material.depthWrite = useAlphaHashFade;
  material.alphaHash = false;
  material.needsUpdate = true;

  material.onBeforeCompile = function (shader) {
    shader.uniforms.lodFadeNear = { value: material.userData.fadeNear || 0 };
    shader.uniforms.lodFadeFar = { value: material.userData.fadeFar || 1 };
    shader.uniforms.lodFadeOutNear = {
      value: material.userData.fadeOutNear || 99999,
    };
    shader.uniforms.lodFadeOutFar = {
      value: material.userData.fadeOutFar || 99999,
    };
    shader.uniforms.lodFadeCenter = {
      value: material.userData.fadeCenter || new THREE.Vector3(),
    };
    material.userData.lodShader = shader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vLodWorldPosition;'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      'vec4 lodWorldPosition = modelMatrix * vec4(transformed, 1.0);\nvLodWorldPosition = lodWorldPosition.xyz;\n#include <project_vertex>'
    );
    var distanceSource = useFadeCenter ? 'lodFadeCenter' : 'cameraPosition';
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float lodFadeNear;\nuniform float lodFadeFar;\nuniform float lodFadeOutNear;\nuniform float lodFadeOutFar;\nuniform vec3 lodFadeCenter;\nvarying vec3 vLodWorldPosition;\nfloat lodSmoothFade(float edge0, float edge1, float value) {\n  if (edge1 <= edge0) return value >= edge1 ? 1.0 : 0.0;\n  float t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);\n  return t * t * (3.0 - 2.0 * t);\n}'
    );
    var fadeShader =
      'float lodDistance = distance(' +
      distanceSource +
      ', vLodWorldPosition);\nfloat lodFadeIn = lodSmoothFade(lodFadeNear, lodFadeFar, lodDistance);\nfloat lodFadeOut = 1.0 - lodSmoothFade(lodFadeOutNear, lodFadeOutFar, lodDistance);\ndiffuseColor.a *= lodFadeIn * lodFadeOut;\nif (diffuseColor.a < 0.02) discard;';

    if (useAlphaHashFade) {
      fadeShader =
        'float lodDistance = distance(' +
        distanceSource +
        ', vLodWorldPosition);\nfloat lodFadeIn = lodSmoothFade(lodFadeNear, lodFadeFar, lodDistance);\nfloat lodFadeOut = 1.0 - lodSmoothFade(lodFadeOutNear, lodFadeOutFar, lodDistance);\nfloat lodVisibility = lodFadeIn * lodFadeOut;\nif (lodVisibility < 0.99) discard;\ndiffuseColor.a = 1.0;';
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n' + fadeShader
    );
  };
}

export function updateLodFadeCenter(root, center) {
  if (!root || !center) {
    return;
  }

  root.traverse(function (child) {
    var material = child.material;
    var shader =
      material && material.userData ? material.userData.lodShader : null;

    if (
      shader &&
      shader.uniforms &&
      shader.uniforms.lodFadeCenter &&
      shader.uniforms.lodFadeCenter.value
    ) {
      shader.uniforms.lodFadeCenter.value.copy(center);
    }
  });
}

function createMeshFromLodData(
  result,
  blockSize,
  startX,
  startY,
  startZ,
  materialOptions
) {
  if (result.faceCount === 0) {
    return null;
  }

  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(result.positions, 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(result.normals, 3)
  );
  geometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(result.colors, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geometry.computeBoundingBox();

  var material = new THREE.MeshLambertMaterial({
    vertexColors: materialOptions.vertexColors !== false,
    color:
      materialOptions.color !== undefined ? materialOptions.color : 0xffffff,
    transparent: materialOptions.transparent || false,
    depthWrite:
      materialOptions.transparent === true
        ? false
        : materialOptions.depthWrite !== undefined
          ? materialOptions.depthWrite
          : true,
    side: materialOptions.side || THREE.FrontSide,
    opacity:
      materialOptions.opacity !== undefined ? materialOptions.opacity : 1.0,
    polygonOffset:
      materialOptions.polygonOffset === true ||
      materialOptions.transparent === true,
    polygonOffsetFactor:
      materialOptions.polygonOffsetFactor !== undefined
        ? materialOptions.polygonOffsetFactor
        : 1.0,
    polygonOffsetUnits:
      materialOptions.polygonOffsetUnits !== undefined
        ? materialOptions.polygonOffsetUnits
        : 1.0,
  });

  if (materialOptions.userData) {
    material.userData = materialOptions.userData;
  }

  if (materialOptions.distanceFade === true) {
    applyLodDistanceFade(material);
  }

  var mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled =
    materialOptions.frustumCulled !== undefined
      ? materialOptions.frustumCulled
      : true;
  mesh.renderOrder = 0;
  mesh.name = materialOptions.name || 'lodMesh_' + blockSize;
  mesh.position.set(startX, startY, startZ);

  if (materialOptions.shellCenter) {
    mesh.userData.shellCenter = materialOptions.shellCenter;
  }

  return mesh;
}

function buildFarVisualShell(generator, options) {
  var blockSize =
    options && typeof options.blockSize === 'number' ? options.blockSize : 8;
  var fadeNear =
    options && typeof options.fadeNear === 'number' ? options.fadeNear : 64;
  var fadeFar =
    options && typeof options.fadeFar === 'number' ? options.fadeFar : 176;
  var fadeOutNear =
    options && typeof options.fadeOutNear === 'number'
      ? options.fadeOutNear
      : 99999;
  var fadeOutFar =
    options && typeof options.fadeOutFar === 'number'
      ? options.fadeOutFar
      : 99999;
  var maxOpacity =
    options && typeof options.maxOpacity === 'number'
      ? options.maxOpacity
      : 0.72;

  var bounds = generator.playfieldBounds;

  var maxY = bounds.maxY;
  if (generator.skyOpenings) {
    for (var i = 0; i < generator.skyOpenings.length; i++) {
      var opening = generator.skyOpenings[i];
      if (opening.topY > maxY) {
        maxY = opening.topY;
      }
    }
  }

  var pad = blockSize * 4;
  var startX = Math.floor((bounds.minX - pad) / blockSize) * blockSize;
  var startY = Math.floor((bounds.minY - pad) / blockSize) * blockSize;
  var startZ = Math.floor((bounds.minZ - pad) / blockSize) * blockSize;
  var endX = Math.ceil((bounds.maxX + pad) / blockSize) * blockSize;
  var endY = Math.ceil((maxY + pad) / blockSize) * blockSize;
  var endZ = Math.ceil((bounds.maxZ + pad) / blockSize) * blockSize;

  var gridW = Math.ceil((endX - startX) / blockSize) + 1;
  var gridH = Math.ceil((endY - startY) / blockSize) + 1;
  var gridD = Math.ceil((endZ - startZ) / blockSize) + 1;

  debugLog(
    'Far shell: grid ' +
      gridW +
      'x' +
      gridH +
      'x' +
      gridD +
      ' blocks (blockSize=' +
      blockSize +
      ')'
  );

  debugTime('far-shell-build');
  var samples = getCoarseCellSampleOffsets(blockSize);
  var threshold = getCoarseSolidThreshold(blockSize);
  var diagnostics = { generateVoxelCalls: 0 };

  var result = buildCoarseLodGeometry({
    levelName: 'farShell_' + blockSize,
    generator: generator,
    blockSize: blockSize,
    regionMinX: startX,
    regionMinY: startY,
    regionMinZ: startZ,
    cellsX: gridW,
    cellsY: gridH,
    cellsZ: gridD,
    threshold: threshold,
    samples: samples,
    diagnostics: diagnostics,
  });

  if (result.faceCount === 0) {
    debugWarn('Far visual shell: no surface faces generated');
    return null;
  }

  debugTimeEnd('far-shell-build');

  var shellCenterX = startX + (gridW * blockSize) / 2;
  var shellCenterY = startY + (gridH * blockSize) / 2;
  var shellCenterZ = startZ + (gridD * blockSize) / 2;

  var mesh = createMeshFromLodData(result, blockSize, startX, startY, startZ, {
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    opacity: maxOpacity,
    name: 'farVisualShell_' + blockSize,
    userData: {
      fadeNear: fadeNear,
      fadeFar: fadeFar,
      fadeOutNear: fadeOutNear,
      fadeOutFar: fadeOutFar,
      maxOpacity: maxOpacity,
    },
    distanceFade: true,
    shellCenter: new THREE.Vector3(shellCenterX, shellCenterY, shellCenterZ),
  });

  var geoDiag = result.diagnostics;
  debugLog('[CoarseLODBuild]', {
    levelName: 'farShell_' + blockSize,
    blockSize: blockSize,
    cellsX: geoDiag.cellsX,
    cellsY: geoDiag.cellsY,
    cellsZ: geoDiag.cellsZ,
    halo: true,
    solidCells: geoDiag.solidCells,
    emptyCells: geoDiag.emptyCells,
    facesEmitted: result.faceCount,
    borderNeighborChecks: geoDiag.borderNeighborChecks,
    borderFacesEmitted: geoDiag.borderFacesEmitted,
    unalignedVertexWarnings: 0,
    coordinateMode: 'local+meshPosition',
    material: {
      type: 'MeshLambertMaterial',
      vertexColors: true,
      transparent: true,
      opacity: maxOpacity,
      depthWrite: true,
      side: THREE.FrontSide,
    },
    generateVoxelCalls: diagnostics.generateVoxelCalls,
  });

  return mesh;
}

var DEFAULT_SHELLS = [
  {
    blockSize: 4,
    fadeNear: 192,
    fadeFar: 256,
    fadeOutNear: 384,
    fadeOutFar: 448,
    maxOpacity: 0.65,
  },
  {
    blockSize: 8,
    fadeNear: 384,
    fadeFar: 448,
    fadeOutNear: 99999,
    fadeOutFar: 99999,
    maxOpacity: 0.55,
  },
];

var FAR_SHELL_TILE_CELLS = 64;

function getLodBounds(generator, blockSize) {
  var bounds = generator.playfieldBounds;
  var maxY = bounds.maxY;

  if (generator.skyOpenings) {
    for (var i = 0; i < generator.skyOpenings.length; i++) {
      var opening = generator.skyOpenings[i];
      if (opening.topY > maxY) {
        maxY = opening.topY;
      }
    }
  }

  var pad = blockSize * 4;
  var startX = Math.floor((bounds.minX - pad) / blockSize) * blockSize;
  var startY = Math.floor((bounds.minY - pad) / blockSize) * blockSize;
  var startZ = Math.floor((bounds.minZ - pad) / blockSize) * blockSize;
  var endX = Math.ceil((bounds.maxX + pad) / blockSize) * blockSize;
  var endY = Math.ceil((maxY + pad) / blockSize) * blockSize;
  var endZ = Math.ceil((bounds.maxZ + pad) / blockSize) * blockSize;

  return {
    startX: startX,
    startY: startY,
    startZ: startZ,
    endX: endX,
    endY: endY,
    endZ: endZ,
    gridW: Math.ceil((endX - startX) / blockSize) + 1,
    gridH: Math.ceil((endY - startY) / blockSize) + 1,
    gridD: Math.ceil((endZ - startZ) / blockSize) + 1,
  };
}

function createLodGeoOptions(levelName, blockSize, bounds) {
  return {
    levelName: levelName,
    blockSize: blockSize,
    regionMinX: bounds.startX,
    regionMinY: bounds.startY,
    regionMinZ: bounds.startZ,
    cellsX: bounds.gridW,
    cellsY: bounds.gridH,
    cellsZ: bounds.gridD,
    threshold: getCoarseSolidThreshold(blockSize),
    samples: getCoarseCellSampleOffsets(blockSize),
  };
}

export async function createStartupPreviewLodAsync(
  chunkManager,
  minimumDistance,
  options = {}
) {
  var blockSize =
    typeof options.blockSize === 'number' ? options.blockSize : 16;
  var opacity = typeof options.opacity === 'number' ? options.opacity : 1;
  var tileWorldSize =
    typeof options.tileWorldSize === 'number' ? options.tileWorldSize : 128;
  var fadeNear =
    typeof options.fadeNear === 'number'
      ? options.fadeNear
      : minimumDistance + blockSize;
  var fadeFar =
    typeof options.fadeFar === 'number'
      ? options.fadeFar
      : minimumDistance + blockSize * 6;
  var generator = chunkManager.generator;
  var workerInterface = chunkManager.workerInterface;

  if (!workerInterface) {
    return null;
  }

  var bounds = getLodBounds(generator, blockSize);
  var chunkWorldSize =
    chunkManager.world.chunkSize * chunkManager.world.voxelSize;
  var tileStartX = Math.floor(bounds.startX / tileWorldSize) * tileWorldSize;
  var tileStartY = Math.floor(bounds.startY / tileWorldSize) * tileWorldSize;
  var tileStartZ = Math.floor(bounds.startZ / tileWorldSize) * tileWorldSize;
  var tileEndX = Math.ceil(bounds.endX / tileWorldSize) * tileWorldSize;
  var tileEndY = Math.ceil(bounds.endY / tileWorldSize) * tileWorldSize;
  var tileEndZ = Math.ceil(bounds.endZ / tileWorldSize) * tileWorldSize;
  var group = new THREE.Group();
  var tilePromises = [];
  var tileCount = 0;

  debugTime('[StartupPreviewLOD] build');

  for (var z = tileStartZ; z < tileEndZ; z += tileWorldSize) {
    for (var y = tileStartY; y < tileEndY; y += tileWorldSize) {
      for (var x = tileStartX; x < tileEndX; x += tileWorldSize) {
        (function (tileX, tileY, tileZ) {
          var maxX = Math.min(tileX + tileWorldSize, bounds.endX);
          var maxY = Math.min(tileY + tileWorldSize, bounds.endY);
          var maxZ = Math.min(tileZ + tileWorldSize, bounds.endZ);
          var cellsX = Math.max(1, Math.ceil((maxX - tileX) / blockSize));
          var cellsY = Math.max(1, Math.ceil((maxY - tileY) / blockSize));
          var cellsZ = Math.max(1, Math.ceil((maxZ - tileZ) / blockSize));
          var tileIndex = tileCount++;
          var lodKey = 'startupPreviewLod_' + blockSize + '_' + tileIndex;
          var geoOptions = createLodGeoOptions(lodKey, blockSize, {
            startX: tileX,
            startY: tileY,
            startZ: tileZ,
            gridW: cellsX,
            gridH: cellsY,
            gridD: cellsZ,
          });

          tilePromises.push(
            workerInterface
              .generateLodGeometry(
                lodKey,
                chunkManager.terrainWorkerConfig,
                geoOptions,
                { front: true }
              )
              .then(function (result) {
                var shellCenterX = tileX + (cellsX * blockSize) / 2;
                var shellCenterY = tileY + (cellsY * blockSize) / 2;
                var shellCenterZ = tileZ + (cellsZ * blockSize) / 2;

                var mesh = createMeshFromLodData(
                  result,
                  blockSize,
                  tileX,
                  tileY,
                  tileZ,
                  {
                    transparent: false,
                    depthWrite: true,
                    side: THREE.FrontSide,
                    opacity: opacity,
                    name: lodKey,
                    userData: {
                      fadeNear: fadeNear,
                      fadeFar: fadeFar,
                      fadeOutNear: 99999,
                      fadeOutFar: 99999,
                      maxOpacity: opacity,
                      alphaHashFade: true,
                      useFadeCenter: true,
                    },
                    distanceFade: true,
                    shellCenter: new THREE.Vector3(
                      shellCenterX,
                      shellCenterY,
                      shellCenterZ
                    ),
                  }
                );

                if (!mesh) {
                  return null;
                }

                mesh.userData.previewChunkKeys = [];
                var minChunkX = Math.floor(tileX / chunkWorldSize);
                var minChunkY = Math.floor(tileY / chunkWorldSize);
                var minChunkZ = Math.floor(tileZ / chunkWorldSize);
                var maxChunkX = Math.ceil(maxX / chunkWorldSize);
                var maxChunkY = Math.ceil(maxY / chunkWorldSize);
                var maxChunkZ = Math.ceil(maxZ / chunkWorldSize);

                for (var cz = minChunkZ; cz < maxChunkZ; cz++) {
                  for (var cy = minChunkY; cy < maxChunkY; cy++) {
                    for (var cx = minChunkX; cx < maxChunkX; cx++) {
                      mesh.userData.previewChunkKeys.push(
                        getChunkKey(cx, cy, cz)
                      );
                    }
                  }
                }

                group.add(mesh);
                return mesh;
              })
          );
        })(x, y, z);
      }
    }
  }

  await Promise.all(tilePromises);
  debugTimeEnd('[StartupPreviewLOD] build');

  if (group.children.length === 0) {
    return null;
  }

  group.name = 'startupPreviewLodSystem';
  group.userData.blockSize = blockSize;
  group.userData.opacity = opacity;
  group.userData.tileWorldSize = tileWorldSize;

  debugLog('[StartupPreviewLOD]', {
    blockSize: blockSize,
    tileWorldSize: tileWorldSize,
    tileCount: group.children.length,
  });

  return group;
}

export function createFarShellSystem(
  generator,
  shells,
  fogOptions,
  minimumDistance
) {
  var shellConfigs = shells && shells.length > 0 ? shells : DEFAULT_SHELLS;
  var minDist = typeof minimumDistance === 'number' ? minimumDistance : 0;

  var group = new THREE.Group();
  group.name = 'farShellSystem';

  for (var i = 0; i < shellConfigs.length; i++) {
    var config = shellConfigs[i];
    if (config.blockSize <= 2) {
      continue;
    }
    var options = {
      blockSize: config.blockSize,
      fadeNear: config.fadeNear,
      fadeFar: config.fadeFar,
      fadeOutNear: config.fadeOutNear != null ? config.fadeOutNear : 99999,
      fadeOutFar: config.fadeOutFar != null ? config.fadeOutFar : 99999,
      maxOpacity: config.maxOpacity,
      minDistance: config.minDistance != null ? config.minDistance : minDist,
    };

    if (config.displacementAmount != null) {
      options.displacementAmount = config.displacementAmount;
    }

    if (config.depthWrite != null) {
      options.depthWrite = config.depthWrite;
    }

    if (config.fogBlendStart != null) {
      options.fogBlendStart = config.fogBlendStart;
    }

    if (config.fogBlendEnd != null) {
      options.fogBlendEnd = config.fogBlendEnd;
    }

    if (config.fogBlendRange != null) {
      options.fogBlendRange = config.fogBlendRange;
    }

    if (fogOptions) {
      if (fogOptions.color != null) {
        options.fogColor = fogOptions.color;
      }
      if (fogOptions.near != null) {
        options.fogNear = fogOptions.near;
      }
      if (fogOptions.far != null) {
        options.fogFar = fogOptions.far;
      }
    }

    var shellMesh = buildFarVisualShell(generator, options);
    if (shellMesh) {
      group.add(shellMesh);
    }
  }

  if (group.children.length === 0) {
    return null;
  }

  return group;
}

export function createFarShellSystemAsync(
  chunkManager,
  shells,
  fogOptions,
  minimumDistance,
  options = {}
) {
  var shellConfigs = shells && shells.length > 0 ? shells : DEFAULT_SHELLS;
  var minDist = typeof minimumDistance === 'number' ? minimumDistance : 0;
  var generator = chunkManager.generator;
  var workerInterface = chunkManager.workerInterface;
  var terrainWorkerConfig = chunkManager.terrainWorkerConfig;
  var priorityShellCount =
    typeof options.priorityShellCount === 'number'
      ? options.priorityShellCount
      : 0;

  var group = new THREE.Group();
  group.name = 'farShellSystem';
  group.userData.totalShells = shellConfigs.length;
  group.userData.loadedShells = 0;
  group.userData.totalShellTiles = 0;
  group.userData.loadedShellTiles = 0;
  group.userData.totalShellCells = 0;
  group.userData.loadedShellCells = 0;
  group.userData.priorityTotalShells = 0;
  group.userData.priorityLoadedShells = 0;
  var resolvePriorityShellsReady;
  group.userData.priorityShellsReady = new Promise(function (resolve) {
    resolvePriorityShellsReady = resolve;
  });
  var expectedPriorityShells = Math.min(
    priorityShellCount,
    shellConfigs.length
  );
  group.userData.priorityTotalShells = expectedPriorityShells;
  var priorityShellsSettled = 0;

  if (expectedPriorityShells === 0) {
    resolvePriorityShellsReady();
  }

  shellConfigs.forEach(function (config, shellIndex) {
    if (config.blockSize <= 2) {
      return;
    }
    var isPriorityShell = shellIndex < priorityShellCount;

    var options = {
      blockSize: config.blockSize,
      fadeNear: config.fadeNear,
      fadeFar: config.fadeFar,
      fadeOutNear: config.fadeOutNear != null ? config.fadeOutNear : 99999,
      fadeOutFar: config.fadeOutFar != null ? config.fadeOutFar : 99999,
      maxOpacity: config.maxOpacity,
      minDistance: config.minDistance != null ? config.minDistance : minDist,
    };

    var bounds = generator.playfieldBounds;
    var maxY = bounds.maxY;
    if (generator.skyOpenings) {
      for (var i = 0; i < generator.skyOpenings.length; i++) {
        var opening = generator.skyOpenings[i];
        if (opening.topY > maxY) {
          maxY = opening.topY;
        }
      }
    }

    var pad = options.blockSize * 4;
    var startX =
      Math.floor((bounds.minX - pad) / options.blockSize) * options.blockSize;
    var startY =
      Math.floor((bounds.minY - pad) / options.blockSize) * options.blockSize;
    var startZ =
      Math.floor((bounds.minZ - pad) / options.blockSize) * options.blockSize;
    var endX =
      Math.ceil((bounds.maxX + pad) / options.blockSize) * options.blockSize;
    var endY = Math.ceil((maxY + pad) / options.blockSize) * options.blockSize;
    var endZ =
      Math.ceil((bounds.maxZ + pad) / options.blockSize) * options.blockSize;

    var gridW = Math.ceil((endX - startX) / options.blockSize) + 1;
    var gridH = Math.ceil((endY - startY) / options.blockSize) + 1;
    var gridD = Math.ceil((endZ - startZ) / options.blockSize) + 1;

    var samples = getCoarseCellSampleOffsets(options.blockSize);
    var threshold = getCoarseSolidThreshold(options.blockSize);

    var shellCenterX = startX + (gridW * options.blockSize) / 2;
    var shellCenterY = startY + (gridH * options.blockSize) / 2;
    var shellCenterZ = startZ + (gridD * options.blockSize) / 2;
    var shellCenter = new THREE.Vector3(
      shellCenterX,
      shellCenterY,
      shellCenterZ
    );
    var tileCells = options.blockSize <= 4 ? FAR_SHELL_TILE_CELLS : 48;
    var shellTileCount = 0;
    var shellSettledTiles = 0;

    for (var tileZ = 0; tileZ < gridD; tileZ += tileCells) {
      for (var tileX = 0; tileX < gridW; tileX += tileCells) {
        shellTileCount++;
      }
    }

    group.userData.totalShellTiles += shellTileCount;
    group.userData.totalShellCells += gridW * gridH * gridD;

    function settleTile(cellCount) {
      group.userData.loadedShellTiles++;
      group.userData.loadedShellCells += cellCount;
      shellSettledTiles++;
      if (shellSettledTiles < shellTileCount) {
        return;
      }

      group.userData.loadedShells++;
      if (isPriorityShell) {
        priorityShellsSettled++;
        group.userData.priorityLoadedShells = priorityShellsSettled;
        if (priorityShellsSettled >= expectedPriorityShells) {
          resolvePriorityShellsReady();
        }
      }
    }

    for (var cellZ = 0; cellZ < gridD; cellZ += tileCells) {
      for (var cellX = 0; cellX < gridW; cellX += tileCells) {
        var tileGridW = Math.min(tileCells, gridW - cellX);
        var tileGridD = Math.min(tileCells, gridD - cellZ);
        var tileStartX = startX + cellX * options.blockSize;
        var tileStartZ = startZ + cellZ * options.blockSize;
        var tileCellCount = tileGridW * gridH * tileGridD;
        var lodKey =
          'farShell_' + options.blockSize + '_' + cellX + '_' + cellZ;
        var geoOptions = {
          levelName: lodKey,
          blockSize: options.blockSize,
          regionMinX: tileStartX,
          regionMinY: startY,
          regionMinZ: tileStartZ,
          cellsX: tileGridW,
          cellsY: gridH,
          cellsZ: tileGridD,
          threshold: threshold,
          samples: samples,
        };

        workerInterface
          .generateLodGeometry(lodKey, terrainWorkerConfig, geoOptions, {
            priority: isPriorityShell,
          })
          .then(
            (function (tileOriginX, tileOriginZ, tileCellsCount, tileKey) {
              return function (result) {
                var mesh = createMeshFromLodData(
                  result,
                  options.blockSize,
                  tileOriginX,
                  startY,
                  tileOriginZ,
                  {
                    transparent: true,
                    depthWrite: true,
                    side: THREE.FrontSide,
                    opacity: options.maxOpacity,
                    name: 'farVisualShell_' + options.blockSize + '_tile',
                    userData: {
                      fadeNear: options.fadeNear,
                      fadeFar: options.fadeFar,
                      fadeOutNear: options.fadeOutNear,
                      fadeOutFar: options.fadeOutFar,
                      maxOpacity: options.maxOpacity,
                    },
                    distanceFade: true,
                    shellCenter: shellCenter,
                  }
                );

                if (mesh) {
                  group.add(mesh);
                  debugLog('[LODAsync] Added ' + tileKey);
                }
                settleTile(tileCellsCount);
              };
            })(tileStartX, tileStartZ, tileCellCount, lodKey)
          )
          .catch(
            (function (tileCellsCount, tileKey) {
              return function (err) {
                settleTile(tileCellsCount);
                debugError('[LODAsync] Failed to build ' + tileKey, err);
              };
            })(tileCellCount, lodKey)
          );
      }
    }
  });

  return group;
}

function buildMidLodChunkMesh(generator, cx, cy, cz) {
  var blockSize = 2;
  var chunkWorldSize = 32;
  var originX = cx * chunkWorldSize;
  var originY = cy * chunkWorldSize;
  var originZ = cz * chunkWorldSize;
  var cellsPerAxis = Math.floor(chunkWorldSize / blockSize);

  var samples = getCoarseCellSampleOffsets(blockSize);
  var threshold = getCoarseSolidThreshold(blockSize);
  var diagnostics = { generateVoxelCalls: 0 };

  var result = buildCoarseLodGeometry({
    levelName: 'midLodChunk_' + cx + '_' + cy + '_' + cz,
    generator: generator,
    blockSize: blockSize,
    regionMinX: originX,
    regionMinY: originY,
    regionMinZ: originZ,
    cellsX: cellsPerAxis,
    cellsY: cellsPerAxis,
    cellsZ: cellsPerAxis,
    threshold: threshold,
    samples: samples,
    diagnostics: diagnostics,
  });

  if (result.faceCount === 0) {
    return null;
  }

  var geoDiag = result.diagnostics;
  if (geoDiag.solidCells === 0 || geoDiag.emptyCells === 0) {
    return null;
  }

  return createMeshFromLodData(result, blockSize, originX, originY, originZ, {
    transparent: false,
    depthWrite: true,
    side: THREE.FrontSide,
    frustumCulled: false,
    name: 'midLodChunk_' + cx + '_' + cy + '_' + cz,
    polygonOffset: true,
    polygonOffsetFactor: 2.0,
    polygonOffsetUnits: 2.0,
  });
}

function getChunkDistanceToPoint(cx, cy, cz, chunkWorldSize, position) {
  if (!position) {
    return 0;
  }

  var minX = cx * chunkWorldSize;
  var minY = cy * chunkWorldSize;
  var minZ = cz * chunkWorldSize;
  var maxX = minX + chunkWorldSize;
  var maxY = minY + chunkWorldSize;
  var maxZ = minZ + chunkWorldSize;
  var dx = Math.max(minX - position.x, 0, position.x - maxX);
  var dy = Math.max(minY - position.y, 0, position.y - maxY);
  var dz = Math.max(minZ - position.z, 0, position.z - maxZ);

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getChunkKey(cx, cy, cz) {
  return cx + ',' + cy + ',' + cz;
}

function hasFullDetailCoverage(chunkManager, key) {
  var state = chunkManager.chunkStates
    ? chunkManager.chunkStates.get(key)
    : null;
  if (chunkManager.chunkMeshes.has(key) || state === 'meshed') {
    return true;
  }

  if (state !== 'loaded') {
    return false;
  }

  if (
    chunkManager.pendingChunkMeshKeys &&
    chunkManager.pendingChunkMeshKeys.has(key)
  ) {
    return false;
  }

  // A loaded chunk with no pending mesh is either empty or already resolved.
  return true;
}

function isFullChunkBoundary(chunkManager, coords) {
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) {
          continue;
        }

        if (
          !hasFullDetailCoverage(
            chunkManager,
            getChunkKey(coords.x + dx, coords.y + dy, coords.z + dz)
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function shouldShowMidLodChunk(chunkManager, chunkKey, coords) {
  if (!hasFullDetailCoverage(chunkManager, chunkKey)) {
    return true;
  }

  return isFullChunkBoundary(chunkManager, coords);
}

export function createMidLodSystem(
  generator,
  chunkWorldSize,
  levelBounds,
  outerDistance
) {
  var blockSize = 2;
  var pad = blockSize * 4;
  var minChunkX = Math.floor((levelBounds.minX - pad) / chunkWorldSize);
  var minChunkY = Math.floor((levelBounds.minY - pad) / chunkWorldSize);
  var minChunkZ = Math.floor((levelBounds.minZ - pad) / chunkWorldSize);
  var maxChunkX = Math.ceil((levelBounds.maxX + pad) / chunkWorldSize);
  var maxChunkY = Math.ceil((levelBounds.maxY + pad) / chunkWorldSize);
  var maxChunkZ = Math.ceil((levelBounds.maxZ + pad) / chunkWorldSize);

  var meshesByChunkKey = new Map();
  var chunkCoordsByKey = new Map();
  var maxDistance = typeof outerDistance === 'number' ? outerDistance : 384;
  var group = new THREE.Group();
  group.name = 'midLodSystem';

  for (var cz = minChunkZ; cz <= maxChunkZ; cz++) {
    for (var cy = minChunkY; cy <= maxChunkY; cy++) {
      for (var cx = minChunkX; cx <= maxChunkX; cx++) {
        var key = getChunkKey(cx, cy, cz);
        var mesh = buildMidLodChunkMesh(generator, cx, cy, cz);
        if (mesh) {
          meshesByChunkKey.set(key, mesh);
          chunkCoordsByKey.set(key, { x: cx, y: cy, z: cz });
          group.add(mesh);
        }
      }
    }
  }

  if (meshesByChunkKey.size === 0) {
    return null;
  }

  debugLog('[MidLOD] built ' + meshesByChunkKey.size + ' chunk meshes');

  function syncVisibility(chunkManager, centerPosition) {
    for (var entry of meshesByChunkKey.entries()) {
      var chunkKey = entry[0];
      var mesh = entry[1];
      var coords = chunkCoordsByKey.get(chunkKey);
      var distance = getChunkDistanceToPoint(
        coords.x,
        coords.y,
        coords.z,
        chunkWorldSize,
        centerPosition
      );
      mesh.visible =
        shouldShowMidLodChunk(chunkManager, chunkKey, coords) &&
        distance <= maxDistance;
    }
  }

  function getVisibleCount() {
    var count = 0;
    for (var mesh of meshesByChunkKey.values()) {
      if (mesh.visible) count++;
    }
    return count;
  }

  var overlapCount = 0;
  var overlapExamples = [];

  function computeOverlaps(chunkManager) {
    overlapCount = 0;
    overlapExamples = [];
    for (var entry of meshesByChunkKey.entries()) {
      var chunkKey = entry[0];
      var mesh = entry[1];
      if (mesh.visible && chunkManager.chunkMeshes.has(chunkKey)) {
        overlapCount++;
        if (overlapExamples.length < 8) {
          overlapExamples.push(chunkKey);
        }
      }
    }
  }

  function logOwnership(chunkManager, centerPosition) {
    syncVisibility(chunkManager, centerPosition);
    computeOverlaps(chunkManager);
    debugLog('[LODOwnership]', {
      fullChunks: chunkManager.chunkMeshes.size,
      midLodChunks: meshesByChunkKey.size,
      visibleMidLodChunks: getVisibleCount(),
      overlapCount: overlapCount,
      overlapExamples: overlapExamples,
      farShellBlockSizes: [4, 8],
    });
  }

  return {
    group: group,
    meshesByChunkKey: meshesByChunkKey,
    syncVisibility: syncVisibility,
    logOwnership: logOwnership,
  };
}

export function createMidLodSystemAsync(
  chunkManager,
  chunkWorldSize,
  levelBounds,
  outerDistance,
  centerPosition,
  options = {}
) {
  var blockSize = 2;
  var pad = blockSize * 4;
  var minChunkX = Math.floor((levelBounds.minX - pad) / chunkWorldSize);
  var minChunkY = Math.floor((levelBounds.minY - pad) / chunkWorldSize);
  var minChunkZ = Math.floor((levelBounds.minZ - pad) / chunkWorldSize);
  var maxChunkX = Math.ceil((levelBounds.maxX + pad) / chunkWorldSize);
  var maxChunkY = Math.ceil((levelBounds.maxY + pad) / chunkWorldSize);
  var maxChunkZ = Math.ceil((levelBounds.maxZ + pad) / chunkWorldSize);

  var workerInterface = chunkManager.workerInterface;
  var terrainWorkerConfig = chunkManager.terrainWorkerConfig;

  var meshesByChunkKey = new Map();
  var chunkCoordsByKey = new Map();
  var maxDistance = typeof outerDistance === 'number' ? outerDistance : 384;
  var priorityChunkCount =
    typeof options.priorityChunkCount === 'number'
      ? options.priorityChunkCount
      : 0;
  var priorityDirection = options.priorityDirection || null;
  var group = new THREE.Group();
  group.name = 'midLodSystem';

  var totalChunksCount =
    (maxChunkX - minChunkX + 1) *
    (maxChunkY - minChunkY + 1) *
    (maxChunkZ - minChunkZ + 1);

  var resolvePriorityChunksReady;
  var priorityChunksReady = new Promise(function (resolve) {
    resolvePriorityChunksReady = resolve;
  });
  var priorityChunksSettled = 0;
  var expectedPriorityChunks = 0;

  var system = {
    group: group,
    meshesByChunkKey: meshesByChunkKey,
    totalChunks: totalChunksCount,
    loadedChunks: 0,
    priorityChunks: 0,
    priorityTotalChunks: 0,
    priorityChunksReady: priorityChunksReady,
    syncVisibility: function (cm, centerPosition) {
      for (var entry of meshesByChunkKey.entries()) {
        var chunkKey = entry[0];
        var mesh = entry[1];
        var coords = chunkCoordsByKey.get(chunkKey);
        var distance = getChunkDistanceToPoint(
          coords.x,
          coords.y,
          coords.z,
          chunkWorldSize,
          centerPosition
        );
        mesh.visible =
          shouldShowMidLodChunk(cm, chunkKey, coords) &&
          distance <= maxDistance;
      }
    },
    logOwnership: function (cm, centerPosition) {
      this.syncVisibility(cm, centerPosition);
      var visibleCount = 0;
      for (var mesh of meshesByChunkKey.values()) {
        if (mesh.visible) visibleCount++;
      }
      debugLog('[LODOwnershipAsync]', {
        fullChunks: cm.chunkMeshes.size,
        midLodChunks: meshesByChunkKey.size,
        visibleMidLodChunks: visibleCount,
        midLodOuterDistance: maxDistance,
      });
    },
  };

  var cellsPerAxis = Math.floor(chunkWorldSize / blockSize);
  var samples = getCoarseCellSampleOffsets(blockSize);
  var threshold = getCoarseSolidThreshold(blockSize);
  var centerChunkX = centerPosition
    ? Math.floor(centerPosition.x / chunkWorldSize)
    : 0;
  var centerChunkY = centerPosition
    ? Math.floor(centerPosition.y / chunkWorldSize)
    : 0;
  var centerChunkZ = centerPosition
    ? Math.floor(centerPosition.z / chunkWorldSize)
    : 0;

  var lodJobs = [];

  for (var cz = minChunkZ; cz <= maxChunkZ; cz++) {
    for (var cy = minChunkY; cy <= maxChunkY; cy++) {
      for (var cx = minChunkX; cx <= maxChunkX; cx++) {
        lodJobs.push({
          x: cx,
          y: cy,
          z: cz,
          distance: getChunkDistanceToPoint(
            cx,
            cy,
            cz,
            chunkWorldSize,
            centerPosition
          ),
        });
      }
    }
  }

  lodJobs.sort(function (a, b) {
    var aPriority = a.distance;
    var bPriority = b.distance;

    if (priorityDirection) {
      aPriority -=
        (a.x - centerChunkX) * priorityDirection.x * chunkWorldSize +
        (a.y - centerChunkY) * priorityDirection.y * chunkWorldSize +
        (a.z - centerChunkZ) * priorityDirection.z * chunkWorldSize;
      bPriority -=
        (b.x - centerChunkX) * priorityDirection.x * chunkWorldSize +
        (b.y - centerChunkY) * priorityDirection.y * chunkWorldSize +
        (b.z - centerChunkZ) * priorityDirection.z * chunkWorldSize;
    }

    return aPriority - bPriority;
  });

  expectedPriorityChunks = Math.min(priorityChunkCount, lodJobs.length);
  system.priorityTotalChunks = expectedPriorityChunks;
  if (expectedPriorityChunks === 0) {
    resolvePriorityChunksReady();
  }

  for (var jobIndex = 0; jobIndex < lodJobs.length; jobIndex++) {
    var job = lodJobs[jobIndex];
    (function (cx, cy, cz, isPriorityJob) {
      var originX = cx * chunkWorldSize;
      var originY = cy * chunkWorldSize;
      var originZ = cz * chunkWorldSize;
      var key = getChunkKey(cx, cy, cz);
      var lodKey = 'midLodChunk_' + key;

      var geoOptions = {
        levelName: lodKey,
        blockSize: blockSize,
        regionMinX: originX,
        regionMinY: originY,
        regionMinZ: originZ,
        cellsX: cellsPerAxis,
        cellsY: cellsPerAxis,
        cellsZ: cellsPerAxis,
        threshold: threshold,
        samples: samples,
      };

      workerInterface
        .generateLodGeometry(lodKey, terrainWorkerConfig, geoOptions, {
          priority: isPriorityJob,
        })
        .then(function (result) {
          system.loadedChunks++;
          var mesh = createMeshFromLodData(
            result,
            blockSize,
            originX,
            originY,
            originZ,
            {
              transparent: false,
              depthWrite: true,
              side: THREE.FrontSide,
              frustumCulled: false,
              name: lodKey,
              polygonOffset: true,
              polygonOffsetFactor: 2.0,
              polygonOffsetUnits: 2.0,
            }
          );

          if (mesh) {
            meshesByChunkKey.set(key, mesh);
            chunkCoordsByKey.set(key, { x: cx, y: cy, z: cz });
            group.add(mesh);
            // Initial visibility check
            mesh.visible = false;
          }

          if (isPriorityJob) {
            priorityChunksSettled++;
            system.priorityChunks = priorityChunksSettled;
            if (priorityChunksSettled >= expectedPriorityChunks) {
              resolvePriorityChunksReady();
            }
          }
        })
        .catch(function () {
          system.loadedChunks++;
          if (isPriorityJob) {
            priorityChunksSettled++;
            system.priorityChunks = priorityChunksSettled;
            if (priorityChunksSettled >= expectedPriorityChunks) {
              resolvePriorityChunksReady();
            }
          }
          // Silently fail for some chunks if they are empty
        });
    })(job.x, job.y, job.z, jobIndex < priorityChunkCount);
  }

  return system;
}
