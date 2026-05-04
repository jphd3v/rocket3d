// Loading screen management
import { debugError } from './debug.js';

class LoadingManager {
  constructor() {
    this.progressSegmentCount = 24;
    this.progressBar = document.getElementById('progress-bar');
    this.progressFill = document.getElementById('progress-fill');
    this.progressSegments = [];
    this.progressText = document.getElementById('progress-text');
    this.loadingDetails = document.getElementById('loading-details');
    this.loadingCacheStatus = document.getElementById('loading-cache-status');
    this.loadingLevel = document.getElementById('loading-level');
    this.loadingSeed = document.getElementById('loading-seed');
    this.loadingWarning = document.getElementById('loading-warning');
    this.loadingScreen = document.getElementById('loading-screen');
    this.totalChunksToLoad = 0;
    this.loadedChunks = 0;
    this.meshedChunks = 0;
    this.emptyChunks = 0;
    this.totalChunksToMesh = 0;
    this.isLoading = true;
    this.manualProgress = null;
    this.terrainCacheLookups = 0;
    this.terrainCachePersistentHits = 0;
    this.terrainCacheClearRequested = false;

    if (this.loadingDetails) {
      this.loadingDetails.textContent = 'Initializing...';
    }
    this.setupProgressSegments();
    this.updateCacheStatus();
  }

  setupProgressSegments() {
    if (!this.progressFill) {
      debugError('Progress fill element not found!');
      return;
    }

    this.progressFill.innerHTML = '';
    this.progressSegments = [];

    for (let i = 0; i < this.progressSegmentCount; i += 1) {
      const segment = document.createElement('span');
      segment.className = 'progress-segment';
      this.progressFill.appendChild(segment);
      this.progressSegments.push(segment);
    }
  }

  setProgressFill(percent) {
    if (!this.progressSegments || this.progressSegments.length === 0) {
      debugError('Progress segments not initialized!');
      return;
    }

    var clampedPercent = Math.max(0, Math.min(100, percent));
    var activeSegments = Math.round(
      (clampedPercent / 100) * this.progressSegmentCount
    );

    for (let i = 0; i < this.progressSegments.length; i += 1) {
      this.progressSegments[i].classList.toggle(
        'is-active',
        i < activeSegments
      );
    }
  }

  setGameConfig(config) {
    if (this.loadingLevel) {
      this.loadingLevel.textContent =
        config && config.levelId ? config.levelId : '-';
    }

    if (this.loadingSeed) {
      this.loadingSeed.textContent =
        'seed ' + (config && config.seed ? config.seed : '-');
    }
  }

  setWarning(message) {
    if (!this.loadingWarning) {
      return;
    }

    this.loadingWarning.textContent = message || '';
    this.loadingWarning.style.display = message ? 'block' : 'none';
  }

  setTerrainCacheClearRequested(requested) {
    this.terrainCacheClearRequested = requested === true;
    this.updateCacheStatus();
  }

  setManualProgress(percent, details) {
    if (!this.isLoading) {
      return;
    }

    this.manualProgress = {
      percent: Math.max(0, Math.min(100, percent)),
      details: details || 'Preparing launch...',
    };
    this.updateCacheStatus();
    this.updateProgress();
  }

  terrainCacheLookup(persistentHit) {
    if (!this.isLoading) {
      return;
    }
    this.terrainCacheLookups++;
    if (persistentHit) {
      this.terrainCachePersistentHits++;
    }
    this.updateCacheStatus();
    this.updateProgress();
  }

  updateCacheStatus() {
    if (!this.loadingCacheStatus) {
      return;
    }

    if (this.terrainCacheClearRequested) {
      this.loadingCacheStatus.textContent = 'CLEARING CACHE';
      this.loadingCacheStatus.classList.remove('is-cache-hit');
      this.loadingCacheStatus.classList.add('is-cache-clear');
      this.loadingCacheStatus.style.visibility = 'visible';
      return;
    }

    if (
      this.terrainCacheLookups > 0 &&
      this.terrainCacheLookups === this.terrainCachePersistentHits
    ) {
      this.loadingCacheStatus.textContent = 'TERRAIN CACHE READY';
      this.loadingCacheStatus.classList.add('is-cache-hit');
      this.loadingCacheStatus.classList.remove('is-cache-clear');
      this.loadingCacheStatus.style.visibility = 'visible';
    } else {
      this.loadingCacheStatus.textContent = '';
      this.loadingCacheStatus.classList.remove('is-cache-hit');
      this.loadingCacheStatus.classList.remove('is-cache-clear');
      this.loadingCacheStatus.style.visibility = 'hidden';
    }
  }

  clearManualProgress() {
    this.manualProgress = null;
    this.updateProgress();
  }

  setTotalChunks(total) {
    this.totalChunksToLoad = total;
    this.totalChunksToMesh = total;
    this.updateProgress();
  }

  chunkLoaded() {
    if (!this.isLoading) {
      return;
    }
    this.loadedChunks++;
    this.updateProgress();
  }

  chunkMeshed() {
    if (!this.isLoading) {
      return;
    }
    this.meshedChunks++;
    this.updateProgress();
  }

  chunkEmpty() {
    if (!this.isLoading) {
      return;
    }
    this.emptyChunks++;
    this.updateProgress();
  }

  updateProgress() {
    if (this.manualProgress) {
      this.setProgressFill(this.manualProgress.percent);

      if (this.progressText) {
        this.progressText.textContent = `${Math.floor(
          this.manualProgress.percent
        )}%`;
      } else {
        debugError('Progress text element not found!');
      }

      if (this.loadingDetails) {
        this.loadingDetails.textContent = this.manualProgress.details;
      } else {
        debugError('Loading details element not found!');
      }
      return;
    }

    // Calculate loading progress (50% of total)
    const loadingProgress =
      this.totalChunksToLoad > 0
        ? (this.loadedChunks / this.totalChunksToLoad) * 50
        : 0;

    // Calculate effective meshing progress - empty chunks don't need meshing
    // Ensure we don't get negative numbers by clamping emptyChunks to totalChunks
    const clampedEmptyChunks = Math.min(
      this.emptyChunks,
      this.totalChunksToMesh
    );
    const effectiveChunksToMesh = Math.max(
      0,
      this.totalChunksToMesh - clampedEmptyChunks
    );

    // Calculate meshing progress (50% of total)
    let meshingProgress = 0; // Default to 0% if no chunks need meshing
    if (effectiveChunksToMesh > 0) {
      // Calculate meshing progress based on meshed chunks
      // Ensure meshedChunks doesn't exceed effectiveChunksToMesh
      const clampedMeshedChunks = Math.min(
        this.meshedChunks,
        effectiveChunksToMesh
      );
      meshingProgress = (clampedMeshedChunks / effectiveChunksToMesh) * 50;
    } else if (this.loadedChunks >= this.totalChunksToLoad) {
      // If all chunks are loaded but no meshing needed (all empty), consider meshing complete
      meshingProgress = 50;
    }

    const totalProgress = Math.min(100, loadingProgress + meshingProgress);

    // Force DOM updates - ensure progress bar elements exist
    this.setProgressFill(totalProgress);

    if (this.progressText) {
      this.progressText.textContent = `${Math.floor(totalProgress)}%`;
    } else {
      debugError('Progress text element not found!');
    }

    if (this.loadingDetails) {
      let details;
      if (this.loadedChunks < this.totalChunksToLoad) {
        details = 'Generating terrain...';
      } else if (
        effectiveChunksToMesh > 0 &&
        this.meshedChunks < effectiveChunksToMesh
      ) {
        details = 'Building world...';
      } else {
        details = 'Preparing launch...';
      }
      this.loadingDetails.textContent = details;
    } else {
      debugError('Loading details element not found!');
    }
  }

  hideLoadingScreen() {
    this.isLoading = false;
    if (this.loadingScreen) {
      this.loadingScreen.style.display = 'none';
    } else {
      debugError('Loading screen element not found!');
    }
  }

  isComplete() {
    // Consider loading complete only if ALL chunks are loaded AND either:
    // 1. All non-empty chunks are meshed, OR
    // 2. All chunks are loaded and meshing is complete (empty chunks don't need meshing)
    const allChunksLoaded = this.loadedChunks >= this.totalChunksToLoad;

    // Use the same clamping logic as updateProgress to ensure consistency
    const clampedEmptyChunks = Math.min(
      this.emptyChunks,
      this.totalChunksToMesh
    );
    const effectiveChunksToMesh = Math.max(
      0,
      this.totalChunksToMesh - clampedEmptyChunks
    );

    // If no chunks need meshing (all are empty), consider meshing complete
    const allChunksMeshed =
      effectiveChunksToMesh === 0 || this.meshedChunks >= effectiveChunksToMesh;

    return allChunksLoaded && allChunksMeshed;
  }
}

export { LoadingManager };
