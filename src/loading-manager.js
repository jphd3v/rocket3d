// Loading screen management
import { debugError } from './debug.js';

class LoadingManager {
  constructor() {
    this.progressBar = document.getElementById('progress-bar');
    this.progressText = document.getElementById('progress-text');
    this.loadingDetails = document.getElementById('loading-details');
    this.loadingScreen = document.getElementById('loading-screen');
    this.totalChunksToLoad = 0;
    this.loadedChunks = 0;
    this.meshedChunks = 0;
    this.emptyChunks = 0;
    this.totalChunksToMesh = 0;
    this.isLoading = true;

    if (this.loadingDetails) {
      this.loadingDetails.textContent = 'Initializing...';
    }
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
    if (this.progressBar) {
      this.progressBar.style.width = `${totalProgress}%`;
    } else {
      debugError('Progress bar element not found!');
    }

    if (this.progressText) {
      this.progressText.textContent = `${Math.floor(totalProgress)}%`;
    } else {
      debugError('Progress text element not found!');
    }

    if (this.loadingDetails) {
      if (this.loadedChunks < this.totalChunksToLoad) {
        var loadPercent = Math.floor(
          (this.loadedChunks / this.totalChunksToLoad) * 100
        );
        this.loadingDetails.textContent =
          'Generating terrain... ' + loadPercent + '%';
      } else if (
        effectiveChunksToMesh > 0 &&
        this.meshedChunks < effectiveChunksToMesh
      ) {
        var meshPercent = Math.floor(
          (this.meshedChunks / effectiveChunksToMesh) * 100
        );
        this.loadingDetails.textContent =
          'Building world... ' + meshPercent + '%';
      } else {
        this.loadingDetails.textContent = 'Preparing launch...';
      }
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
