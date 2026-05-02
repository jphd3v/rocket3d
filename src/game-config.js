import { hasLevelId } from './levels/index.js';

export const DEFAULT_GAME_CONFIG = {
  levelId: 'level-01',
  seed: 'rocket3d-dev-seed-01',
};

export const START_POSITION = { x: 160, y: 160, z: 160 };
export const INITIAL_LOAD_RADIUS = 2;
export const STREAM_LOAD_RADIUS = 3;
export const STARTUP_WARMUP_RADIUS = 5;
export const STARTUP_WARMUP_BUDGET_MS = 30000;
export const STARTUP_MID_LOD_PRIORITY_CHUNKS = 3600;
export const STARTUP_MID_LOD_BUDGET_MS = 90000;
export const STARTUP_FAR_SHELL_PRIORITY_SHELLS = 1;
export const STARTUP_FAR_SHELL_BUDGET_MS = 8000;
export const SOUNDTRACK_VOLUME = 0.16;

export function normalizeGameSeed(seed) {
  var normalized = String(seed == null ? '' : seed).trim();

  return normalized || DEFAULT_GAME_CONFIG.seed;
}

export function normalizeGameLevelId(levelId) {
  var normalized = String(levelId == null ? '' : levelId).trim();

  if (hasLevelId(normalized)) {
    return normalized;
  }

  return DEFAULT_GAME_CONFIG.levelId;
}

export function normalizeGameConfig(config) {
  var source = config || {};

  return {
    levelId: normalizeGameLevelId(source.levelId),
    seed: normalizeGameSeed(source.seed),
  };
}

export function hasExplicitGameConfigInUrl(locationSearch) {
  if (locationSearch == null && typeof window === 'undefined') {
    return false;
  }

  var params = new URLSearchParams(
    locationSearch != null ? locationSearch : window.location.search
  );

  return params.has('level') || params.has('seed');
}

export function getGameConfigFromUrl(locationSearch) {
  if (locationSearch == null && typeof window === 'undefined') {
    return normalizeGameConfig(DEFAULT_GAME_CONFIG);
  }

  var params = new URLSearchParams(
    locationSearch != null ? locationSearch : window.location.search
  );

  return normalizeGameConfig({
    levelId: params.get('level'),
    seed: params.get('seed'),
  });
}

export function shouldClearTerrainCacheFromUrl(locationSearch) {
  if (locationSearch == null && typeof window === 'undefined') {
    return false;
  }

  var params = new URLSearchParams(
    locationSearch != null ? locationSearch : window.location.search
  );

  return params.get('clearTerrainCache') === '1';
}

export function buildGameUrl(config, locationInfo) {
  var sourceLocation =
    locationInfo || (typeof window !== 'undefined' ? window.location : null);
  var params = new URLSearchParams(
    sourceLocation && sourceLocation.search ? sourceLocation.search : ''
  );
  var normalized = normalizeGameConfig(config);
  var shouldClearTerrainCache = Boolean(
    config && config.clearTerrainCache === true
  );
  var path =
    sourceLocation && sourceLocation.pathname ? sourceLocation.pathname : '/';
  var hash = sourceLocation && sourceLocation.hash ? sourceLocation.hash : '';

  params.delete('clearTerrainCache');
  if (shouldClearTerrainCache) {
    params.set('clearTerrainCache', '1');
  }
  params.set('level', normalized.levelId);
  params.set('seed', normalized.seed);

  return path + '?' + params.toString() + hash;
}

export function restartGame(config) {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }

  window.location.href = buildGameUrl(config, window.location);
}

export function createRandomGameSeed(length) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var targetLength =
    typeof length === 'number' && length > 0 ? Math.floor(length) : 8;
  var chars = [];
  var values = new Uint32Array(targetLength);
  var i;

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(values);
    for (i = 0; i < targetLength; i++) {
      chars.push(alphabet.charAt(values[i] % alphabet.length));
    }
    return chars.join('');
  }

  for (i = 0; i < targetLength; i++) {
    chars.push(alphabet.charAt(Math.floor(Math.random() * alphabet.length)));
  }

  return chars.join('');
}
