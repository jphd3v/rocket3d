import { ChiptuneJsPlayer } from 'chiptune3/chiptune3.js';
import { debugError } from './debug.js';

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function getTrackLabel(track) {
  if (track && track.label) {
    return String(track.label);
  }

  if (!track || !track.url) {
    return 'OFF';
  }

  const parts = String(track.url).split('/');

  return decodeURIComponent(parts[parts.length - 1] || track.url);
}

function normalizeTracks(tracks) {
  const normalizedTracks = [{ label: 'OFF', url: '' }];
  const seenUrls = new Set(['']);
  const playableTracks = [];

  for (const track of tracks || []) {
    if (!track || !track.url) {
      continue;
    }

    const url = String(track.url);

    if (seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    playableTracks.push({
      label: getTrackLabel(track),
      url,
    });
  }

  playableTracks.sort(function (first, second) {
    return first.label.localeCompare(second.label);
  });

  normalizedTracks.push(...playableTracks);

  return normalizedTracks;
}

function createSoundtrackController(options = {}) {
  const tracks = normalizeTracks(options.tracks);
  const masterVolume =
    typeof options.volume === 'number' ? clamp(options.volume, 0, 1) : 0.18;

  let currentTrackIndex = 0;
  let currentModuleData = null;
  let player = null;
  let playerReady = false;
  let isDisposed = false;
  let loadRequestId = 0;

  const unlockListeners = [];
  const moduleCache = new Map();

  const state = {
    isLoaded: false,
    isPlaying: false,
    hasUserGesture: false,
    error: null,
    isEnabled: false,
    statusText: 'OFF (PRESS M TO CYCLE)',
    statusColor: '#ff6666',
  };

  function hasPlayableTracks() {
    return tracks.length > 1;
  }

  function getCurrentTrack() {
    return tracks[currentTrackIndex] || tracks[0];
  }

  function getCurrentTrackLabel() {
    return getTrackLabel(getCurrentTrack());
  }

  function isCurrentTrackOff() {
    return !getCurrentTrack().url;
  }

  function setStatus(statusText, statusColor) {
    state.statusText = statusText;
    state.statusColor = statusColor;
  }

  function getUiState() {
    return {
      text: state.statusText,
      color: state.statusColor,
      isPlaying: state.isPlaying,
      isLoaded: state.isLoaded,
      isEnabled: state.isEnabled,
      error: state.error,
      trackLabel: getCurrentTrackLabel(),
      trackIndex: currentTrackIndex,
      trackCount: tracks.length,
    };
  }

  function getContextState() {
    if (!player || !player.context) {
      return 'suspended';
    }

    return player.context.state;
  }

  function updateStatus() {
    const trackLabel = getCurrentTrackLabel();

    state.isEnabled = !isCurrentTrackOff();

    if (!hasPlayableTracks()) {
      setStatus('No soundtrack files found', '#ffffff');
      return;
    }

    if (isCurrentTrackOff()) {
      setStatus('OFF (Press M to cycle)', '#888888');
      return;
    }

    if (state.error) {
      setStatus(`${trackLabel} FAILED (Press M to cycle)`, '#888888');
      return;
    }

    if (!state.isLoaded) {
      setStatus(`Loading ${trackLabel}...`, '#aaaaaa');
      return;
    }

    if (!playerReady) {
      setStatus(`Initializing ${trackLabel}...`, '#aaaaaa');
      return;
    }

    if (state.isPlaying && getContextState() === 'running') {
      setStatus(`${trackLabel} ON (Press M to cycle)`, '#fff0a8');
      return;
    }

    if (getContextState() === 'running') {
      setStatus(`${trackLabel} ON (Press M to cycle)`, '#fff0a8');
      return;
    }

    setStatus(`${trackLabel} ON (Press M to cycle)`, '#fff0a8');
  }

  function ensurePlayer() {
    if (player || !hasPlayableTracks() || isDisposed) {
      return;
    }

    try {
      player = new ChiptuneJsPlayer({
        repeatCount: -1,
      });
      player.setVol(masterVolume);

      player.onInitialized(function () {
        playerReady = true;

        if (!isCurrentTrackOff() && state.isLoaded && state.hasUserGesture) {
          startPlayback();
          return;
        }

        updateStatus();
      });

      player.onMetadata(function () {
        state.error = null;
        updateStatus();
      });

      player.onEnded(function () {
        state.isPlaying = false;
        updateStatus();
      });

      player.onError(function (error) {
        state.error = new Error('Tracker module playback failed.');
        state.isPlaying = false;
        updateStatus();
        debugError('Failed to play soundtrack module:', error);
      });
    } catch (error) {
      state.error = error;
      setStatus('AUDIO UNAVAILABLE', '#ff6666');
      debugError('Failed to initialize soundtrack player:', error);
    }
  }

  async function resumeAudio() {
    if (
      !player ||
      !player.context ||
      typeof player.context.resume !== 'function'
    ) {
      return false;
    }

    if (player.context.state === 'running') {
      return true;
    }

    await player.context.resume();
    return player.context.state === 'running';
  }

  async function startPlayback() {
    if (
      isCurrentTrackOff() ||
      !state.hasUserGesture ||
      !state.isLoaded ||
      !currentModuleData ||
      !player ||
      !playerReady ||
      isDisposed
    ) {
      updateStatus();
      return;
    }

    if (state.isPlaying) {
      return;
    }

    try {
      const isRunning = await resumeAudio();

      if (!isRunning) {
        updateStatus();
        return;
      }

      state.error = null;
      player.setVol(masterVolume);
      player.setRepeatCount(-1);
      player.play(currentModuleData.slice(0));
      state.isPlaying = true;
      updateStatus();
    } catch (error) {
      state.error = error;
      state.isPlaying = false;
      updateStatus();
      debugError('Failed to start soundtrack playback:', error);
    }
  }

  function stopPlayback() {
    if (player) {
      player.stop();
    }

    state.isPlaying = false;
  }

  function removeUnlockListeners() {
    while (unlockListeners.length > 0) {
      const listener = unlockListeners.pop();
      listener.target.removeEventListener(listener.type, listener.handler);
    }
  }

  async function unlockAudio() {
    state.hasUserGesture = true;
    ensurePlayer();

    try {
      if (player) {
        await resumeAudio();

        if (getContextState() === 'running') {
          removeUnlockListeners();
        }
      }

      if (!isCurrentTrackOff() && state.isLoaded) {
        await startPlayback();
      } else {
        updateStatus();
      }
    } catch (error) {
      state.error = error;
      setStatus('AUDIO UNAVAILABLE', '#ff6666');
      debugError('Failed to unlock soundtrack audio:', error);
    }
  }

  function installUnlockHandlers(target) {
    if (!target || !hasPlayableTracks()) {
      return;
    }

    function handleUnlock() {
      unlockAudio();
    }

    const listenerTypes = ['pointerdown', 'keydown', 'touchstart'];

    for (const type of listenerTypes) {
      target.addEventListener(type, handleUnlock);
      unlockListeners.push({ target, type, handler: handleUnlock });
    }
  }

  async function loadCurrentTrack() {
    const track = getCurrentTrack();
    const requestId = ++loadRequestId;

    currentModuleData = null;
    state.error = null;
    state.isLoaded = false;
    stopPlayback();

    if (!track.url) {
      updateStatus();
      return getUiState();
    }

    updateStatus();

    try {
      let moduleData = moduleCache.get(track.url);

      if (!moduleData) {
        const response = await fetch(track.url);

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        moduleData = await response.arrayBuffer();
        moduleCache.set(track.url, moduleData);
      }

      if (
        isDisposed ||
        requestId !== loadRequestId ||
        track.url !== getCurrentTrack().url
      ) {
        return getUiState();
      }

      currentModuleData = moduleData;
      state.isLoaded = true;
      state.error = null;

      if (state.hasUserGesture) {
        await startPlayback();
      } else {
        updateStatus();
      }
    } catch (error) {
      if (
        isDisposed ||
        requestId !== loadRequestId ||
        track.url !== getCurrentTrack().url
      ) {
        return getUiState();
      }

      state.error = error;
      state.isPlaying = false;
      updateStatus();
      debugError('Failed to load soundtrack module:', error);
    }

    return getUiState();
  }

  function setTrackIndex(nextTrackIndex) {
    if (!hasPlayableTracks()) {
      updateStatus();
      return;
    }

    const trackCount = tracks.length;
    const wrappedIndex =
      ((nextTrackIndex % trackCount) + trackCount) % trackCount;

    currentTrackIndex = wrappedIndex;
    loadCurrentTrack();
  }

  function cycleTrack(direction = 1) {
    const step = direction < 0 ? -1 : 1;

    setTrackIndex(currentTrackIndex + step);
  }

  function load() {
    return loadCurrentTrack();
  }

  function suspend() {
    if (player && state.isPlaying) {
      player.stop();
      state.isPlaying = false;
    }
  }

  function dispose() {
    isDisposed = true;
    removeUnlockListeners();
    stopPlayback();

    if (!player) {
      return;
    }

    try {
      if (player.processNode) {
        player.processNode.disconnect();
      }

      if (player.gain) {
        player.gain.disconnect();
      }

      if (player.context && player.context.state !== 'closed') {
        player.context.close();
      }
    } catch (error) {
      debugError('Failed to dispose soundtrack player cleanly:', error);
    }

    player = null;
    playerReady = false;
  }

  updateStatus();

  return {
    cycleTrack,
    dispose,
    getUiState,
    installUnlockHandlers,
    load,
    setTrackIndex,
    suspend,
    toggleEnabled: cycleTrack,
  };
}

export { createSoundtrackController };
