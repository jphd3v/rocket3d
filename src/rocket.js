import * as THREE from 'three';
import { ROCKET_VOXEL_SIZE, ROCKET_VOXELS } from './rocket-voxels.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function createRocket(color) {
  const rocketRoot = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x441500,
    emissiveIntensity: 0.6,
    vertexColors: true,
  });

  const geometries = [];
  const voxelGeometry = new THREE.BoxGeometry(
    ROCKET_VOXEL_SIZE,
    ROCKET_VOXEL_SIZE,
    ROCKET_VOXEL_SIZE
  );

  for (const voxel of ROCKET_VOXELS) {
    const geometry = voxelGeometry.clone();
    geometry.translate(
      voxel.x * ROCKET_VOXEL_SIZE,
      voxel.y * ROCKET_VOXEL_SIZE,
      voxel.z * ROCKET_VOXEL_SIZE
    );

    geometries.push(geometry);
  }

  // Combine geometries manually
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const baseColor = new THREE.Color(color);

  let offset = 0;

  for (const geometry of geometries) {
    if (geometry.attributes && geometry.attributes.position) {
      const posArray = geometry.attributes.position.array;
      const normArray = geometry.attributes.normal
        ? geometry.attributes.normal.array
        : new Float32Array(posArray.length).fill(0);

      // Add positions and normals
      for (let i = 0; i < posArray.length; i += 3) {
        positions.push(posArray[i], posArray[i + 1], posArray[i + 2]);
        if (normArray && normArray.length > i) {
          normals.push(normArray[i], normArray[i + 1], normArray[i + 2]);
        }
      }

      // Add indices
      if (geometry.index) {
        const indexArray = geometry.index.array;
        for (let i = 0; i < indexArray.length; i++) {
          indices.push(indexArray[i] + offset);
        }
      } else {
        // Create basic triangle indices if none exist
        for (let i = 0; i < posArray.length / 3; i += 3) {
          indices.push(offset + i, offset + i + 1, offset + i + 2);
        }
      }

      offset += posArray.length / 3;
    }
  }

  const combinedGeometry = new THREE.BufferGeometry();
  combinedGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  if (normals.length > 0) {
    combinedGeometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );
  }

  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    const normalY = normals.length > 0 ? normals[i + 1] : 0;
    const voxelX = Math.round(positions[i] / ROCKET_VOXEL_SIZE);
    const voxelZ = Math.round(positions[i + 2] / ROCKET_VOXEL_SIZE);
    const topBias = clamp((y / (ROCKET_VOXEL_SIZE * 1.2) + 1) * 0.5, 0, 1);
    const normalBias = clamp((normalY + 1) * 0.5, 0, 1);
    const voxelTint =
      Math.abs(Math.sin(voxelX * 12.9898 + voxelZ * 37.719)) * 0.12;
    const brightness =
      lerp(0.62, 1.08, topBias * 0.55 + normalBias * 0.45) + voxelTint;
    const coolTint = lerp(0, 0.12, topBias * 0.65 + normalBias * 0.35);
    const warmTint = lerp(0.16, 0, topBias);

    colors.push(
      clamp(baseColor.r * brightness + coolTint * 0.35, 0, 1),
      clamp(baseColor.g * brightness + coolTint * 0.48 - warmTint * 0.18, 0, 1),
      clamp(baseColor.b * brightness + coolTint * 0.85 - warmTint * 0.28, 0, 1)
    );
  }

  combinedGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(colors, 3)
  );
  combinedGeometry.setIndex(indices);

  const combinedMesh = new THREE.Mesh(combinedGeometry, material);
  combinedMesh.castShadow = true;
  combinedMesh.receiveShadow = true;
  rocketRoot.add(combinedMesh);
  rocketRoot.userData.visualMesh = combinedMesh;
  rocketRoot.material = material;

  voxelGeometry.dispose();

  return rocketRoot;
}
