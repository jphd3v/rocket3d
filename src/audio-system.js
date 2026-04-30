import * as Tone from 'tone';
import { debugError } from './debug.js';

// Attempt to silence Tone.js version log
if (Tone.context) {
  Tone.context.silent = true;
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clampVolume(value = 1) {
  return clamp(value, 0, 1);
}

function createAudioSystem() {
  const unlockListeners = [];

  let enabled = false;
  let started = false;
  let thrusterNoise = null;
  let thrusterFilter = null;
  let thrusterGain = null;
  let thrusterRumble = null;
  let thrusterRumbleGain = null;
  let flamethrowerFilter = null;
  let flamethrowerNoise = null;
  let flamethrowerNoiseGain = null;
  let flamethrowerTone = null;
  let flamethrowerToneGain = null;
  let flamethrowerBodyFilter = null;
  let flamethrowerBodyTone = null;
  let flamethrowerBodyGain = null;
  let flamethrowerPulseTone = null;
  let flamethrowerPulseGain = null;
  let shotSynth = null;
  let weaponSwitchSynth = null;
  let shotgunFilter = null;
  let shotgunNoiseSynth = null;
  let shotgunBodySynth = null;
  let missileLaunchFilter = null;
  let missileLaunchNoiseSynth = null;
  let missileLaunchBodySynth = null;
  let missileLaunchWhineSynth = null;
  let missileCooldownSynth = null;
  let missileExplosionOutput = null;
  let missileExplosionFilter = null;
  let missileExplosionNoiseSynth = null;
  let missileExplosionBodySynth = null;
  let missileExplosionRoarGain = null;
  let missileExplosionRoarNoise = null;
  let missileExplosionRumbleGain = null;
  let missileExplosionRumble = null;
  let missileExplosionThunderFilter = null;
  let missileExplosionThunderGain = null;
  let missileExplosionThunderNoise = null;
  let missileExplosionThunderOsc = null;
  let missileExplosionThunderOscGain = null;
  let missileExplosionThunderBedFilter = null;
  let missileExplosionThunderBedGain = null;
  let missileExplosionThunderBedNoise = null;
  let missileExplosionThunderBedOsc = null;
  let missileExplosionThunderBedOscGain = null;
  let missileExplosionCrackFilter = null;
  let missileExplosionCrackSynth = null;
  let impactNoise = null;
  let impactFilter = null;
  let impactGain = null;
  let collisionNoise = null;
  let collisionFilter = null;
  let collisionGain = null;
  let collisionOutput = null;
  let collisionThunkSynth = null;
  let warningSynth = null;
  let targetingPingSynth = null;
  let lockAcquiredSynth = null;
  let lockLostSynth = null;
  let enemyLockPingSynth = null;
  let enemyLockPingFilter = null;
  let enemyLockPingDelay = null;
  let enemyLockPingDelayGain = null;
  let pauseSynth = null;
  let lastWarningTime = Number.NEGATIVE_INFINITY;
  let lastCollisionTime = Number.NEGATIVE_INFINITY;
  let lastShotTriggerTime = Number.NEGATIVE_INFINITY;
  let lastWeaponSwitchTriggerTime = Number.NEGATIVE_INFINITY;
  let lastShotgunTriggerTime = Number.NEGATIVE_INFINITY;
  let lastMissileLaunchTriggerTime = Number.NEGATIVE_INFINITY;
  let lastMissileExplosionTriggerTime = Number.NEGATIVE_INFINITY;
  let lastWarningTriggerTime = Number.NEGATIVE_INFINITY;
  let lastTargetingThreatLevel = 0;
  let nextTargetingPingTime = 0;
  let nextEnemyLockPingTime = 0;
  let enemyLockPingInterval = 1200;
  let lastThrustInput = 0;
  let lastFlamethrowerInput = 0;
  let lastFireDenialTime = Number.NEGATIVE_INFINITY;
  let fireDenialSynth = null;
  let cooldownReadySynth = null;

  const state = {
    isReady: false,
    isUnlocked: false,
    isEnabled: enabled,
    statusText: 'READY (PRESS N TO DISABLE)',
    statusColor: '#ffd966',
  };

  function setStatus(statusText, statusColor) {
    state.statusText = statusText;
    state.statusColor = statusColor;
  }

  function getUiState() {
    return {
      text: state.statusText,
      color: state.statusColor,
      isReady: state.isReady,
      isUnlocked: state.isUnlocked,
      isEnabled: state.isEnabled,
    };
  }

  function updateStatus() {
    const isRunning = Tone.context.state === 'running';

    if (isRunning) {
      state.isUnlocked = true;
    }

    state.isEnabled = enabled;

    if (!enabled) {
      setStatus('OFF (Press N to toggle)', '#888888');
      return;
    }

    if (isRunning && started) {
      setStatus('ON (Press N to toggle)', '#fff0a8');
      return;
    }

    setStatus('ON (Press N to toggle)', '#fff0a8');
  }

  function shutdownGraph() {
    for (const node of [
      thrusterNoise,
      thrusterFilter,
      thrusterGain,
      thrusterRumble,
      thrusterRumbleGain,
      flamethrowerFilter,
      flamethrowerNoise,
      flamethrowerNoiseGain,
      flamethrowerTone,
      flamethrowerToneGain,
      flamethrowerBodyFilter,
      flamethrowerBodyTone,
      flamethrowerBodyGain,
      flamethrowerPulseTone,
      flamethrowerPulseGain,
      shotSynth,
      weaponSwitchSynth,
      missileLaunchFilter,
      missileLaunchNoiseSynth,
      missileLaunchBodySynth,
      missileLaunchWhineSynth,
      missileCooldownSynth,
      shotgunFilter,
      shotgunNoiseSynth,
      shotgunBodySynth,
      missileExplosionOutput,
      missileExplosionFilter,
      missileExplosionNoiseSynth,
      missileExplosionBodySynth,
      missileExplosionRoarGain,
      missileExplosionRoarNoise,
      missileExplosionRumbleGain,
      missileExplosionRumble,
      missileExplosionThunderFilter,
      missileExplosionThunderGain,
      missileExplosionThunderNoise,
      missileExplosionThunderOsc,
      missileExplosionThunderOscGain,
      missileExplosionThunderBedFilter,
      missileExplosionThunderBedGain,
      missileExplosionThunderBedNoise,
      missileExplosionThunderBedOsc,
      missileExplosionThunderBedOscGain,
      missileExplosionCrackFilter,
      missileExplosionCrackSynth,
      impactNoise,
      impactFilter,
      impactGain,
      collisionNoise,
      collisionFilter,
      collisionGain,
      collisionOutput,
      collisionThunkSynth,
      warningSynth,
      targetingPingSynth,
      lockAcquiredSynth,
      lockLostSynth,
      enemyLockPingSynth,
      enemyLockPingFilter,
      enemyLockPingDelay,
      enemyLockPingDelayGain,
      pauseSynth,
      fireDenialSynth,
    ]) {
      if (node && typeof node.dispose === 'function') {
        node.dispose();
      }
    }

    thrusterNoise = null;
    thrusterFilter = null;
    thrusterGain = null;
    thrusterRumble = null;
    thrusterRumbleGain = null;
    flamethrowerFilter = null;
    flamethrowerNoise = null;
    flamethrowerNoiseGain = null;
    flamethrowerTone = null;
    flamethrowerToneGain = null;
    flamethrowerBodyFilter = null;
    flamethrowerBodyTone = null;
    flamethrowerBodyGain = null;
    flamethrowerPulseTone = null;
    flamethrowerPulseGain = null;
    shotSynth = null;
    weaponSwitchSynth = null;
    missileLaunchFilter = null;
    missileLaunchNoiseSynth = null;
    missileLaunchBodySynth = null;
    missileLaunchWhineSynth = null;
    missileCooldownSynth = null;
    shotgunFilter = null;
    shotgunNoiseSynth = null;
    shotgunBodySynth = null;
    missileExplosionOutput = null;
    missileExplosionFilter = null;
    missileExplosionNoiseSynth = null;
    missileExplosionBodySynth = null;
    missileExplosionRoarGain = null;
    missileExplosionRoarNoise = null;
    missileExplosionRumbleGain = null;
    missileExplosionRumble = null;
    missileExplosionThunderFilter = null;
    missileExplosionThunderGain = null;
    missileExplosionThunderNoise = null;
    missileExplosionThunderOsc = null;
    missileExplosionThunderOscGain = null;
    missileExplosionThunderBedFilter = null;
    missileExplosionThunderBedGain = null;
    missileExplosionThunderBedNoise = null;
    missileExplosionThunderBedOsc = null;
    missileExplosionThunderBedOscGain = null;
    missileExplosionCrackFilter = null;
    missileExplosionCrackSynth = null;
    impactNoise = null;
    impactFilter = null;
    impactGain = null;
    collisionNoise = null;
    collisionFilter = null;
    collisionGain = null;
    collisionOutput = null;
    collisionThunkSynth = null;
    warningSynth = null;
    targetingPingSynth = null;
    lockAcquiredSynth = null;
    lockLostSynth = null;
    enemyLockPingSynth = null;
    enemyLockPingFilter = null;
    enemyLockPingDelay = null;
    enemyLockPingDelayGain = null;
    pauseSynth = null;
    fireDenialSynth = null;
    cooldownReadySynth = null;
    started = false;
    state.isReady = false;
    lastShotTriggerTime = Number.NEGATIVE_INFINITY;
    lastWeaponSwitchTriggerTime = Number.NEGATIVE_INFINITY;
    lastShotgunTriggerTime = Number.NEGATIVE_INFINITY;
    lastMissileLaunchTriggerTime = Number.NEGATIVE_INFINITY;
    lastMissileExplosionTriggerTime = Number.NEGATIVE_INFINITY;
    lastWarningTriggerTime = Number.NEGATIVE_INFINITY;
    lastThrustInput = 0;
    lastFlamethrowerInput = 0;
  }

  function removeUnlockListeners() {
    while (unlockListeners.length > 0) {
      const listener = unlockListeners.pop();
      listener.target.removeEventListener(listener.type, listener.handler);
    }
  }

  function ensureGraph() {
    if (started) {
      return;
    }

    thrusterFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 180,
      rolloff: -24,
      Q: 0.18,
    }).toDestination();

    thrusterGain = new Tone.Gain(0).connect(thrusterFilter);
    thrusterNoise = new Tone.Noise('brown').connect(thrusterGain);

    thrusterRumbleGain = new Tone.Gain(0).connect(thrusterFilter);
    thrusterRumble = new Tone.Oscillator({
      type: 'triangle',
      frequency: 28,
      volume: -18,
    }).connect(thrusterRumbleGain);

    flamethrowerFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 1100,
      rolloff: -24,
      Q: 0.35,
    }).toDestination();

    flamethrowerNoiseGain = new Tone.Gain(0).connect(flamethrowerFilter);
    flamethrowerNoise = new Tone.Noise('pink').connect(flamethrowerNoiseGain);

    flamethrowerToneGain = new Tone.Gain(0).connect(flamethrowerFilter);
    flamethrowerTone = new Tone.Oscillator({
      type: 'sawtooth',
      frequency: 82,
      volume: -26,
    }).connect(flamethrowerToneGain);

    flamethrowerBodyFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 240,
      rolloff: -24,
      Q: 0.5,
    }).toDestination();

    flamethrowerBodyGain = new Tone.Gain(0).connect(flamethrowerBodyFilter);
    flamethrowerBodyTone = new Tone.Oscillator({
      type: 'square6',
      frequency: 74,
      volume: -16,
    }).connect(flamethrowerBodyGain);

    flamethrowerPulseGain = new Tone.Gain(0).connect(flamethrowerFilter);
    flamethrowerPulseTone = new Tone.Oscillator({
      type: 'square8',
      frequency: 18,
      volume: -24,
    }).connect(flamethrowerPulseGain);

    shotSynth = new Tone.Synth({
      oscillator: { type: 'pulse', width: 0.24 },
      envelope: {
        attack: 0.001,
        decay: 0.05,
        sustain: 0.0,
        release: 0.03,
      },
      volume: -5,
    }).toDestination();

    weaponSwitchSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.002,
        decay: 0.05,
        sustain: 0,
        release: 0.06,
      },
      volume: -14,
    }).toDestination();

    shotgunFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 1200,
      rolloff: -24,
      Q: 0.7,
    }).toDestination();

    shotgunNoiseSynth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.16,
        sustain: 0,
        release: 0.02,
      },
      volume: -7,
    }).connect(shotgunFilter);

    shotgunBodySynth = new Tone.MembraneSynth({
      pitchDecay: 0.02,
      octaves: 1.8,
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.001,
        decay: 0.12,
        sustain: 0,
        release: 0.05,
      },
      volume: -10,
    }).connect(shotgunFilter);

    missileLaunchFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 680,
      rolloff: -24,
      Q: 0.8,
    }).toDestination();

    missileLaunchNoiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.001,
        decay: 0.2,
        sustain: 0,
        release: 0.06,
      },
      volume: -8,
    }).connect(missileLaunchFilter);

    missileLaunchBodySynth = new Tone.MembraneSynth({
      pitchDecay: 0.024,
      octaves: 2.2,
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.001,
        decay: 0.22,
        sustain: 0,
        release: 0.1,
      },
      volume: -5,
    }).connect(missileLaunchFilter);

    missileLaunchWhineSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.001,
        decay: 0.18,
        sustain: 0,
        release: 0.1,
      },
      volume: -18,
    }).connect(missileLaunchFilter);

    missileCooldownSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.001,
        decay: 0.055,
        sustain: 0,
        release: 0.05,
      },
      volume: -11,
    }).toDestination();

    missileExplosionOutput = new Tone.Limiter(-2).toDestination();

    missileExplosionFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 900,
      rolloff: -24,
      Q: 0.22,
    }).connect(missileExplosionOutput);

    missileExplosionNoiseSynth = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: {
        attack: 0.001,
        decay: 1.05,
        sustain: 0,
        release: 0.26,
      },
      volume: -5,
    }).connect(missileExplosionFilter);

    missileExplosionBodySynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 1.05,
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.001,
        decay: 0.52,
        sustain: 0,
        release: 0.16,
      },
      volume: -3,
    }).connect(missileExplosionFilter);

    missileExplosionRoarGain = new Tone.Gain(0).connect(missileExplosionFilter);
    missileExplosionRoarNoise = new Tone.Noise('brown').connect(
      missileExplosionRoarGain
    );

    missileExplosionRumbleGain = new Tone.Gain(0).connect(
      missileExplosionFilter
    );
    missileExplosionRumble = new Tone.Oscillator({
      type: 'triangle',
      frequency: 46,
      volume: -20,
    }).connect(missileExplosionRumbleGain);

    missileExplosionThunderFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 120,
      rolloff: -24,
      Q: 0.35,
    }).connect(missileExplosionOutput);

    missileExplosionThunderGain = new Tone.Gain(0).connect(
      missileExplosionThunderFilter
    );
    missileExplosionThunderNoise = new Tone.Noise('brown').connect(
      missileExplosionThunderGain
    );

    missileExplosionThunderOscGain = new Tone.Gain(0).connect(
      missileExplosionThunderFilter
    );
    missileExplosionThunderOsc = new Tone.Oscillator({
      type: 'sine',
      frequency: 34,
      volume: -14,
    }).connect(missileExplosionThunderOscGain);

    missileExplosionThunderBedFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 160,
      rolloff: -24,
      Q: 0.12,
    }).connect(missileExplosionOutput);

    missileExplosionThunderBedGain = new Tone.Gain(0).connect(
      missileExplosionThunderBedFilter
    );
    missileExplosionThunderBedNoise = new Tone.Noise('brown').connect(
      missileExplosionThunderBedGain
    );

    missileExplosionThunderBedOscGain = new Tone.Gain(0).connect(
      missileExplosionThunderBedFilter
    );
    missileExplosionThunderBedOsc = new Tone.Oscillator({
      type: 'triangle',
      frequency: 22,
      volume: -12,
    }).connect(missileExplosionThunderBedOscGain);

    missileExplosionCrackFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 1900,
      rolloff: -24,
      Q: 1.2,
    }).connect(missileExplosionOutput);

    missileExplosionCrackSynth = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: {
        attack: 0.001,
        decay: 0.085,
        sustain: 0,
        release: 0.025,
      },
      volume: -15,
    }).connect(missileExplosionCrackFilter);

    impactFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 1500,
      Q: 1.8,
    }).toDestination();
    impactGain = new Tone.Gain(0).connect(impactFilter);
    impactNoise = new Tone.Noise('white').connect(impactGain);

    collisionOutput = new Tone.Limiter(-3).toDestination();

    collisionFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 900,
      rolloff: -24,
      Q: 0.8,
    }).connect(collisionOutput);
    collisionGain = new Tone.Gain(0).connect(collisionFilter);
    collisionNoise = new Tone.Noise('pink').connect(collisionGain);

    collisionThunkSynth = new Tone.MembraneSynth({
      pitchDecay: 0.018,
      octaves: 2.8,
      oscillator: {
        type: 'triangle',
      },
      envelope: {
        attack: 0.001,
        decay: 0.18,
        sustain: 0,
        release: 0.04,
      },
      volume: -2,
    }).connect(collisionOutput);

    warningSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.002,
        decay: 0.08,
        sustain: 0.0,
        release: 0.04,
      },
      volume: -12,
    }).toDestination();

    targetingPingSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.005,
        decay: 0.12,
        sustain: 0.0,
        release: 0.08,
      },
      volume: -18,
    }).toDestination();

    lockAcquiredSynth = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: {
        attack: 0.002,
        decay: 0.15,
        sustain: 0.0,
        release: 0.05,
      },
      volume: -10,
    }).toDestination();

    lockLostSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.005,
        decay: 0.18,
        sustain: 0.0,
        release: 0.06,
      },
      volume: -14,
    }).toDestination();

    enemyLockPingFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 600,
      Q: 3,
    }).toDestination();

    enemyLockPingDelayGain = new Tone.Gain(0.15).toDestination();
    enemyLockPingDelay = new Tone.FeedbackDelay(0.18, 0.12).connect(
      enemyLockPingDelayGain
    );

    enemyLockPingSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.001,
        decay: 0.14,
        sustain: 0.0,
        release: 0.06,
      },
      volume: -18,
    }).chain(enemyLockPingFilter, enemyLockPingDelay);

    pauseSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: {
        attack: 0.002,
        decay: 0.06,
        sustain: 0.0,
        release: 0.06,
      },
      volume: -12,
    }).toDestination();

    fireDenialSynth = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 1.2,
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.001,
        decay: 0.04,
        sustain: 0,
        release: 0.02,
      },
      volume: -22,
    }).toDestination();

    cooldownReadySynth = new Tone.Synth({
      oscillator: {
        type: 'sine',
      },
      envelope: {
        attack: 0.001,
        decay: 0.06,
        sustain: 0,
        release: 0.04,
      },
      volume: -18,
    }).toDestination();

    thrusterNoise.start();
    thrusterRumble.start();
    flamethrowerNoise.start();
    flamethrowerTone.start();
    flamethrowerBodyTone.start();
    flamethrowerPulseTone.start();
    missileExplosionRoarNoise.start();
    missileExplosionRumble.start();
    missileExplosionThunderNoise.start();
    missileExplosionThunderOsc.start();
    missileExplosionThunderBedNoise.start();
    missileExplosionThunderBedOsc.start();
    impactNoise.start();
    collisionNoise.start();

    const now = Tone.now();
    thrusterGain.gain.setValueAtTime(0.0001, now);
    thrusterRumbleGain.gain.setValueAtTime(0.0001, now);
    thrusterFilter.frequency.setValueAtTime(180, now);
    thrusterRumble.frequency.setValueAtTime(28, now);
    flamethrowerNoiseGain.gain.setValueAtTime(0.0001, now);
    flamethrowerToneGain.gain.setValueAtTime(0.0001, now);
    flamethrowerFilter.frequency.setValueAtTime(900, now);
    flamethrowerTone.frequency.setValueAtTime(82, now);
    flamethrowerBodyGain.gain.setValueAtTime(0.0001, now);
    flamethrowerBodyFilter.frequency.setValueAtTime(220, now);
    flamethrowerBodyTone.frequency.setValueAtTime(74, now);
    flamethrowerPulseGain.gain.setValueAtTime(0.0001, now);
    flamethrowerPulseTone.frequency.setValueAtTime(18, now);
    missileExplosionRoarGain.gain.setValueAtTime(0.0001, now);
    missileExplosionRumbleGain.gain.setValueAtTime(0.0001, now);
    missileExplosionRumble.frequency.setValueAtTime(46, now);
    missileExplosionThunderGain.gain.setValueAtTime(0.0001, now);
    missileExplosionThunderOscGain.gain.setValueAtTime(0.0001, now);
    missileExplosionThunderFilter.frequency.setValueAtTime(120, now);
    missileExplosionThunderOsc.frequency.setValueAtTime(34, now);
    missileExplosionThunderBedGain.gain.setValueAtTime(0.0001, now);
    missileExplosionThunderBedOscGain.gain.setValueAtTime(0.0001, now);
    missileExplosionThunderBedFilter.frequency.setValueAtTime(160, now);
    missileExplosionThunderBedOsc.frequency.setValueAtTime(22, now);
    collisionGain.gain.setValueAtTime(0, now);
    collisionFilter.frequency.setValueAtTime(700, now);
    collisionThunkSynth.triggerAttackRelease(48, 0.01, now + 0.02, 0.0001);

    started = true;
    state.isReady = true;
  }

  function getStrictTriggerTime(requestedTime, previousTime) {
    if (requestedTime > previousTime) {
      return requestedTime;
    }

    return previousTime + 0.001;
  }

  async function unlock() {
    try {
      await Tone.start();
      state.isUnlocked = Tone.context.state === 'running';

      if (enabled && state.isUnlocked) {
        ensureGraph();
      }

      updateStatus();

      if (state.isUnlocked) {
        removeUnlockListeners();
      }
    } catch (error) {
      setStatus('AUDIO UNAVAILABLE', '#ff6666');
      debugError('Failed to unlock Tone.js audio:', error);
    }
  }

  function installUnlockHandlers(target) {
    if (!target) {
      return;
    }

    function handleUnlock() {
      unlock();
    }

    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      target.addEventListener(type, handleUnlock, { passive: true });
      unlockListeners.push({ target, type, handler: handleUnlock });
    }
  }

  function setThrust(value) {
    if (!enabled || !started || Tone.context.state !== 'running') {
      lastThrustInput = 0;
      return;
    }

    const thrust = clamp(value, 0, 1);
    if (Math.abs(thrust - lastThrustInput) < 0.001) {
      return;
    }

    const now = Tone.now();
    const targetNoiseGain = thrust > 0 ? lerp(0.008, 0.028, thrust) : 0.0001;
    const targetRumbleGain = thrust > 0 ? lerp(0.004, 0.012, thrust) : 0.0001;
    const targetFilterFrequency = thrust > 0 ? lerp(150, 340, thrust) : 160;
    const targetRumbleFrequency = thrust > 0 ? lerp(24, 34, thrust) : 24;
    const rampDuration = thrust > lastThrustInput ? 0.2 : 0.32;

    thrusterGain.gain.cancelScheduledValues(now);
    thrusterGain.gain.linearRampToValueAtTime(
      targetNoiseGain,
      now + rampDuration
    );

    thrusterRumbleGain.gain.cancelScheduledValues(now);
    thrusterRumbleGain.gain.linearRampToValueAtTime(
      targetRumbleGain,
      now + rampDuration
    );

    thrusterFilter.frequency.cancelScheduledValues(now);
    thrusterFilter.frequency.linearRampToValueAtTime(
      targetFilterFrequency,
      now + rampDuration
    );

    thrusterRumble.frequency.cancelScheduledValues(now);
    thrusterRumble.frequency.linearRampToValueAtTime(
      targetRumbleFrequency,
      now + rampDuration
    );

    lastThrustInput = thrust;
  }

  function setFlamethrower(value) {
    if (
      !enabled ||
      !started ||
      Tone.context.state !== 'running' ||
      !flamethrowerNoiseGain ||
      !flamethrowerToneGain ||
      !flamethrowerBodyGain ||
      !flamethrowerBodyFilter ||
      !flamethrowerBodyTone ||
      !flamethrowerPulseGain ||
      !flamethrowerPulseTone ||
      !flamethrowerFilter ||
      !flamethrowerTone
    ) {
      lastFlamethrowerInput = 0;
      return;
    }

    const intensity = clamp(value, 0, 1);
    if (Math.abs(intensity - lastFlamethrowerInput) < 0.001) {
      return;
    }

    const now = Tone.now();
    const targetNoiseGain =
      intensity > 0 ? lerp(0.035, 0.11, intensity) : 0.0001;
    const targetToneGain = intensity > 0 ? lerp(0.01, 0.04, intensity) : 0.0001;
    const targetBodyGain =
      intensity > 0 ? lerp(0.026, 0.09, intensity) : 0.0001;
    const targetPulseGain =
      intensity > 0 ? lerp(0.003, 0.016, intensity) : 0.0001;
    const targetFilterFrequency =
      intensity > 0 ? lerp(720, 1500, intensity) : 900;
    const targetToneFrequency = intensity > 0 ? lerp(92, 146, intensity) : 82;
    const targetBodyFilterFrequency =
      intensity > 0 ? lerp(240, 520, intensity) : 220;
    const targetBodyFrequency = intensity > 0 ? lerp(68, 108, intensity) : 74;
    const targetPulseFrequency = intensity > 0 ? lerp(16, 24, intensity) : 18;
    const rampDuration = intensity > lastFlamethrowerInput ? 0.06 : 0.12;

    flamethrowerNoiseGain.gain.cancelScheduledValues(now);
    flamethrowerNoiseGain.gain.linearRampToValueAtTime(
      targetNoiseGain,
      now + rampDuration
    );

    flamethrowerToneGain.gain.cancelScheduledValues(now);
    flamethrowerToneGain.gain.linearRampToValueAtTime(
      targetToneGain,
      now + rampDuration
    );

    flamethrowerBodyGain.gain.cancelScheduledValues(now);
    flamethrowerBodyGain.gain.linearRampToValueAtTime(
      targetBodyGain,
      now + rampDuration
    );

    flamethrowerPulseGain.gain.cancelScheduledValues(now);
    flamethrowerPulseGain.gain.linearRampToValueAtTime(
      targetPulseGain,
      now + rampDuration
    );

    flamethrowerFilter.frequency.cancelScheduledValues(now);
    flamethrowerFilter.frequency.linearRampToValueAtTime(
      targetFilterFrequency,
      now + rampDuration
    );

    flamethrowerTone.frequency.cancelScheduledValues(now);
    flamethrowerTone.frequency.linearRampToValueAtTime(
      targetToneFrequency,
      now + rampDuration
    );

    flamethrowerBodyFilter.frequency.cancelScheduledValues(now);
    flamethrowerBodyFilter.frequency.linearRampToValueAtTime(
      targetBodyFilterFrequency,
      now + rampDuration
    );

    flamethrowerBodyTone.frequency.cancelScheduledValues(now);
    flamethrowerBodyTone.frequency.linearRampToValueAtTime(
      targetBodyFrequency,
      now + rampDuration
    );

    flamethrowerPulseTone.frequency.cancelScheduledValues(now);
    flamethrowerPulseTone.frequency.linearRampToValueAtTime(
      targetPulseFrequency,
      now + rampDuration
    );

    lastFlamethrowerInput = intensity;
  }

  function playShot(volume = 1) {
    if (!enabled || Tone.context.state !== 'running' || !shotSynth) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastShotTriggerTime
    );

    lastShotTriggerTime = triggerTime;
    shotSynth.triggerAttackRelease('E4', 0.04, triggerTime, clampedVolume);
    shotSynth.frequency.cancelScheduledValues(triggerTime);
    shotSynth.frequency.setValueAtTime(1500, triggerTime);
    shotSynth.frequency.exponentialRampToValueAtTime(640, triggerTime + 0.014);
    shotSynth.frequency.exponentialRampToValueAtTime(260, triggerTime + 0.07);
  }

  function playWeaponSwitch() {
    if (!enabled || Tone.context.state !== 'running' || !weaponSwitchSynth) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastWeaponSwitchTriggerTime
    );
    const secondTriggerTime = getStrictTriggerTime(
      triggerTime + 0.03,
      triggerTime
    );

    lastWeaponSwitchTriggerTime = secondTriggerTime;
    weaponSwitchSynth.triggerAttackRelease('G5', 0.045, triggerTime, 0.2);
    weaponSwitchSynth.triggerAttackRelease('B5', 0.04, secondTriggerTime, 0.16);
  }

  function playDock(volume = 1) {
    if (!enabled || Tone.context.state !== 'running' || !weaponSwitchSynth) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastWeaponSwitchTriggerTime
    );
    const secondTriggerTime = getStrictTriggerTime(
      triggerTime + 0.036,
      triggerTime
    );

    lastWeaponSwitchTriggerTime = secondTriggerTime;
    weaponSwitchSynth.triggerAttackRelease(
      'E5',
      0.04,
      triggerTime,
      0.22 * clampedVolume
    );
    weaponSwitchSynth.triggerAttackRelease(
      'B4',
      0.08,
      secondTriggerTime,
      0.18 * clampedVolume
    );
  }

  function playShotgun(volume = 1) {
    if (
      !enabled ||
      Tone.context.state !== 'running' ||
      !shotgunFilter ||
      !shotgunNoiseSynth ||
      !shotgunBodySynth
    ) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastShotgunTriggerTime
    );

    lastShotgunTriggerTime = triggerTime;
    shotgunFilter.frequency.cancelScheduledValues(triggerTime);
    shotgunFilter.frequency.setValueAtTime(1600, triggerTime);
    shotgunFilter.frequency.exponentialRampToValueAtTime(
      340,
      triggerTime + 0.18
    );
    shotgunNoiseSynth.triggerAttackRelease(
      0.16,
      triggerTime,
      0.95 * clampedVolume
    );
    shotgunBodySynth.triggerAttackRelease(
      'A2',
      0.1,
      triggerTime + 0.004,
      0.8 * clampedVolume
    );
  }

  function playMissileLaunch(volume = 1) {
    if (
      !enabled ||
      Tone.context.state !== 'running' ||
      !missileLaunchFilter ||
      !missileLaunchNoiseSynth ||
      !missileLaunchBodySynth ||
      !missileLaunchWhineSynth
    ) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastMissileLaunchTriggerTime
    );

    lastMissileLaunchTriggerTime = triggerTime;
    missileLaunchFilter.frequency.cancelScheduledValues(triggerTime);
    missileLaunchFilter.frequency.setValueAtTime(240, triggerTime);
    missileLaunchFilter.frequency.exponentialRampToValueAtTime(
      1100,
      triggerTime + 0.2
    );
    missileLaunchNoiseSynth.triggerAttackRelease(
      0.2,
      triggerTime,
      0.95 * clampedVolume
    );
    missileLaunchBodySynth.triggerAttackRelease(
      'B1',
      0.2,
      triggerTime,
      1.15 * clampedVolume
    );
    missileLaunchWhineSynth.triggerAttackRelease(
      'A3',
      0.18,
      triggerTime + 0.006,
      0.32 * clampedVolume
    );
    missileLaunchWhineSynth.frequency.cancelScheduledValues(triggerTime);
    missileLaunchWhineSynth.frequency.setValueAtTime(180, triggerTime + 0.006);
    missileLaunchWhineSynth.frequency.exponentialRampToValueAtTime(
      320,
      triggerTime + 0.2
    );
  }

  function playMissileCooldown() {
    if (!enabled || Tone.context.state !== 'running' || !missileCooldownSynth) {
      return;
    }

    const triggerTime = Tone.now() + 0.001;
    missileCooldownSynth.triggerAttackRelease('F4', 0.05, triggerTime, 0.22);
    missileCooldownSynth.frequency.cancelScheduledValues(triggerTime);
    missileCooldownSynth.frequency.setValueAtTime(420, triggerTime);
    missileCooldownSynth.frequency.exponentialRampToValueAtTime(
      235,
      triggerTime + 0.08
    );
  }

  function playMissileExplosion(isHeavy = false, volume = 1) {
    if (
      !enabled ||
      Tone.context.state !== 'running' ||
      !missileExplosionFilter ||
      !missileExplosionNoiseSynth ||
      !missileExplosionBodySynth ||
      !missileExplosionRoarGain ||
      !missileExplosionRumbleGain ||
      !missileExplosionRumble ||
      !missileExplosionThunderFilter ||
      !missileExplosionThunderGain ||
      !missileExplosionThunderNoise ||
      !missileExplosionThunderOsc ||
      !missileExplosionThunderOscGain ||
      !missileExplosionThunderBedFilter ||
      !missileExplosionThunderBedGain ||
      !missileExplosionThunderBedNoise ||
      !missileExplosionThunderBedOsc ||
      !missileExplosionThunderBedOscGain ||
      !missileExplosionCrackFilter ||
      !missileExplosionCrackSynth
    ) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastMissileExplosionTriggerTime
    );

    lastMissileExplosionTriggerTime = triggerTime;
    const roarPeak = (isHeavy ? 0.52 : 0.3) * clampedVolume;
    const roarReleaseTime = isHeavy ? 6.6 : 1.8;
    const rumblePeak = (isHeavy ? 0.32 : 0.17) * clampedVolume;
    const rumbleReleaseTime = isHeavy ? 5.7 : 1.25;
    const thunderNoisePeak = (isHeavy ? 0.44 : 0.24) * clampedVolume;
    const thunderOscPeak = (isHeavy ? 0.24 : 0.11) * clampedVolume;
    const thunderReleaseTime = isHeavy ? 8.1 : 2.2;
    const thunderBedNoisePeak = (isHeavy ? 0.56 : 0.18) * clampedVolume;
    const thunderBedOscPeak = (isHeavy ? 0.36 : 0.08) * clampedVolume;
    const thunderBedDelay = isHeavy ? 0.255 : 0.16;
    const thunderBedReleaseTime = isHeavy ? 9.6 : 2.6;

    missileExplosionFilter.frequency.cancelScheduledValues(triggerTime);
    missileExplosionFilter.frequency.setValueAtTime(1100, triggerTime);
    missileExplosionFilter.frequency.exponentialRampToValueAtTime(
      isHeavy ? 78 : 130,
      triggerTime + (isHeavy ? 5.1 : 1.45)
    );
    missileExplosionNoiseSynth.triggerAttackRelease(
      isHeavy ? 2.55 : 1.2,
      triggerTime,
      (isHeavy ? 1.5 : 1.05) * clampedVolume
    );
    missileExplosionBodySynth.triggerAttackRelease(
      isHeavy ? 'A0' : 'B0',
      isHeavy ? 1.65 : 0.56,
      triggerTime + 0.002,
      (isHeavy ? 1.45 : 1.15) * clampedVolume
    );
    missileExplosionRoarGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionRoarGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionRoarGain.gain.linearRampToValueAtTime(
      roarPeak,
      triggerTime + 0.04
    );
    missileExplosionRoarGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + roarReleaseTime
    );
    missileExplosionRumbleGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionRumbleGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionRumbleGain.gain.linearRampToValueAtTime(
      rumblePeak,
      triggerTime + 0.03
    );
    missileExplosionRumbleGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + rumbleReleaseTime
    );
    missileExplosionRumble.frequency.cancelScheduledValues(triggerTime);
    missileExplosionRumble.frequency.setValueAtTime(
      isHeavy ? 34 : 48,
      triggerTime
    );
    missileExplosionRumble.frequency.exponentialRampToValueAtTime(
      isHeavy ? 11 : 24,
      triggerTime + (isHeavy ? 5.4 : 1.0)
    );
    missileExplosionThunderFilter.frequency.cancelScheduledValues(triggerTime);
    missileExplosionThunderFilter.frequency.setValueAtTime(
      isHeavy ? 132 : 135,
      triggerTime + 0.02
    );
    missileExplosionThunderFilter.frequency.exponentialRampToValueAtTime(
      isHeavy ? 34 : 72,
      triggerTime + thunderReleaseTime
    );
    missileExplosionThunderGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionThunderGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionThunderGain.gain.linearRampToValueAtTime(
      thunderNoisePeak,
      triggerTime + 0.08
    );
    missileExplosionThunderGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + thunderReleaseTime
    );
    missileExplosionThunderOscGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionThunderOscGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionThunderOscGain.gain.linearRampToValueAtTime(
      thunderOscPeak,
      triggerTime + 0.06
    );
    missileExplosionThunderOscGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + (thunderReleaseTime - 0.25)
    );
    missileExplosionThunderOsc.frequency.cancelScheduledValues(triggerTime);
    missileExplosionThunderOsc.frequency.setValueAtTime(
      isHeavy ? 26 : 34,
      triggerTime + 0.01
    );
    missileExplosionThunderOsc.frequency.exponentialRampToValueAtTime(
      isHeavy ? 8 : 18,
      triggerTime + thunderReleaseTime
    );
    missileExplosionThunderBedFilter.frequency.cancelScheduledValues(
      triggerTime
    );
    missileExplosionThunderBedFilter.frequency.setValueAtTime(
      isHeavy ? 140 : 120,
      triggerTime + thunderBedDelay
    );
    missileExplosionThunderBedFilter.frequency.exponentialRampToValueAtTime(
      isHeavy ? 22 : 60,
      triggerTime + thunderBedReleaseTime
    );
    missileExplosionThunderBedGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionThunderBedGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionThunderBedGain.gain.linearRampToValueAtTime(
      thunderBedNoisePeak,
      triggerTime + thunderBedDelay + 0.26
    );
    missileExplosionThunderBedGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + thunderBedReleaseTime
    );
    missileExplosionThunderBedOscGain.gain.cancelScheduledValues(triggerTime);
    missileExplosionThunderBedOscGain.gain.setValueAtTime(0.0001, triggerTime);
    missileExplosionThunderBedOscGain.gain.linearRampToValueAtTime(
      thunderBedOscPeak,
      triggerTime + thunderBedDelay + 0.22
    );
    missileExplosionThunderBedOscGain.gain.exponentialRampToValueAtTime(
      0.0001,
      triggerTime + thunderBedReleaseTime - (isHeavy ? 0.45 : 0.2)
    );
    missileExplosionThunderBedOsc.frequency.cancelScheduledValues(triggerTime);
    missileExplosionThunderBedOsc.frequency.setValueAtTime(
      isHeavy ? 18 : 22,
      triggerTime + thunderBedDelay
    );
    missileExplosionThunderBedOsc.frequency.exponentialRampToValueAtTime(
      isHeavy ? 5.5 : 12,
      triggerTime + thunderBedReleaseTime
    );
    missileExplosionCrackFilter.frequency.cancelScheduledValues(triggerTime);
    missileExplosionCrackFilter.frequency.setValueAtTime(
      isHeavy ? 2600 : 2400,
      triggerTime
    );
    missileExplosionCrackFilter.frequency.exponentialRampToValueAtTime(
      isHeavy ? 620 : 760,
      triggerTime + (isHeavy ? 0.18 : 0.14)
    );
    missileExplosionCrackSynth.triggerAttackRelease(
      isHeavy ? 0.12 : 0.095,
      triggerTime + 0.004,
      (isHeavy ? 0.52 : 0.42) * clampedVolume
    );
  }

  function playImpact(volume = 1) {
    if (
      !enabled ||
      Tone.context.state !== 'running' ||
      !impactGain ||
      !impactFilter
    ) {
      return;
    }

    const clampedVolume = clampVolume(volume);
    if (clampedVolume <= 0.01) {
      return;
    }

    const now = Tone.now();
    impactFilter.frequency.setValueAtTime(2200, now);
    impactFilter.frequency.exponentialRampToValueAtTime(500, now + 0.12);
    impactGain.gain.cancelScheduledValues(now);
    impactGain.gain.setValueAtTime(0.0001, now);
    impactGain.gain.linearRampToValueAtTime(0.22 * clampedVolume, now + 0.008);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  }

  function playCollision(speed = 0) {
    if (
      !enabled ||
      Tone.context.state !== 'running' ||
      !collisionGain ||
      !collisionFilter ||
      !collisionThunkSynth
    ) {
      return;
    }

    const nowMs = performance.now();
    if (nowMs - lastCollisionTime < 140) {
      return;
    }
    lastCollisionTime = nowMs;

    const intensity = clamp(speed / 3.2, 0.35, 1);
    const now = Tone.now();
    collisionFilter.frequency.setValueAtTime(lerp(260, 1500, intensity), now);
    collisionGain.gain.cancelScheduledValues(now);
    collisionGain.gain.setValueAtTime(0.0001, now);
    collisionGain.gain.linearRampToValueAtTime(
      lerp(0.12, 0.48, intensity),
      now + 0.004
    );
    collisionGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + lerp(0.16, 0.42, intensity)
    );

    collisionThunkSynth.triggerAttackRelease(
      lerp(52, 84, intensity),
      lerp(0.05, 0.12, intensity),
      now,
      lerp(0.6, 1.2, intensity)
    );
  }

  function updateWarnings(health) {
    if (!enabled || Tone.context.state !== 'running' || !warningSynth) {
      return;
    }

    if (health > 30) {
      return;
    }

    const nowMs = performance.now();
    const intervalMs = health > 15 ? 900 : 520;

    if (nowMs - lastWarningTime < intervalMs) {
      return;
    }

    lastWarningTime = nowMs;
    const triggerTime = getStrictTriggerTime(
      Tone.now() + 0.001,
      lastWarningTriggerTime
    );

    lastWarningTriggerTime = triggerTime;
    warningSynth.triggerAttackRelease(
      health > 15 ? 'A5' : 'D6',
      0.08,
      triggerTime,
      0.45
    );
  }

  function playTrackingPing(threatLevel) {
    if (!enabled || Tone.context.state !== 'running' || !targetingPingSynth) {
      return;
    }

    const now = Tone.now() + 0.001;
    const frequency = threatLevel === 2 ? 1200 : 800;
    const duration = threatLevel === 2 ? 0.06 : 0.1;
    const velocity = threatLevel === 2 ? 0.35 : 0.25;

    targetingPingSynth.triggerAttackRelease(frequency, duration, now, velocity);
  }

  function playPlayerLockAcquired() {
    if (!enabled || Tone.context.state !== 'running' || !lockAcquiredSynth) {
      return;
    }

    const now = Tone.now() + 0.001;
    lockAcquiredSynth.triggerAttackRelease(700, 0.16, now, 0.6);
    lockAcquiredSynth.frequency.cancelScheduledValues(now);
    lockAcquiredSynth.frequency.setValueAtTime(700, now);
    lockAcquiredSynth.frequency.exponentialRampToValueAtTime(1200, now + 0.16);
  }

  function playPlayerLockLost() {
    if (!enabled || Tone.context.state !== 'running' || !lockLostSynth) {
      return;
    }

    const now = Tone.now() + 0.001;
    lockLostSynth.triggerAttackRelease(500, 0.18, now, 0.55);
    lockLostSynth.frequency.cancelScheduledValues(now);
    lockLostSynth.frequency.setValueAtTime(500, now);
    lockLostSynth.frequency.exponentialRampToValueAtTime(240, now + 0.18);
  }

  function playEnemyLockPing(pitchMultiplier) {
    if (!enabled || Tone.context.state !== 'running' || !enemyLockPingSynth) {
      return;
    }

    const pitch = pitchMultiplier || 1;
    const baseFreq = 500 * pitch;
    const targetFreq = 350 * pitch;

    const now = Tone.now() + 0.001;
    enemyLockPingSynth.triggerAttackRelease(baseFreq, 0.14, now, 0.2);
    enemyLockPingSynth.frequency.cancelScheduledValues(now);
    enemyLockPingSynth.frequency.setValueAtTime(baseFreq, now);
    enemyLockPingSynth.frequency.exponentialRampToValueAtTime(
      targetFreq,
      now + 0.14
    );
  }

  function updateEnemyLockAudio(enemyLockState, distance, weaponCanTrack) {
    if (!enabled || Tone.context.state !== 'running') {
      return;
    }

    const MAX_INTERVAL = 1200;

    if (!weaponCanTrack) {
      nextEnemyLockPingTime = 0;
      enemyLockPingInterval = MAX_INTERVAL;
      return;
    }

    const nowMs = performance.now();

    const MAX_THREAT_DISTANCE = 180;
    const MIN_INTERVAL = 350;

    var threat = 0;
    if (enemyLockState === 'locked') {
      threat = 1;
    } else if (
      enemyLockState === 'acquiring' ||
      enemyLockState === 'decaying'
    ) {
      threat = 0.5;
    }

    const distFactor = Math.max(
      0,
      Math.min(1, 1 - distance / MAX_THREAT_DISTANCE)
    );
    threat = threat * (0.6 + 0.4 * distFactor);

    const targetInterval =
      MAX_INTERVAL - (MAX_INTERVAL - MIN_INTERVAL) * threat;
    enemyLockPingInterval =
      enemyLockPingInterval + (targetInterval - enemyLockPingInterval) * 0.1;

    const pitchMultiplier = 0.9 + 0.3 * threat;

    if (threat > 0) {
      if (nowMs >= nextEnemyLockPingTime) {
        playEnemyLockPing(pitchMultiplier);
        nextEnemyLockPingTime = nowMs + enemyLockPingInterval;
      }
    } else {
      nextEnemyLockPingTime = 0;
      enemyLockPingInterval = MAX_INTERVAL;
    }
  }

  function playPause() {
    if (!enabled || Tone.context.state !== 'running' || !pauseSynth) {
      return;
    }

    const now = Tone.now() + 0.001;
    pauseSynth.triggerAttackRelease('C6', 0.04, now, 0.35);
    pauseSynth.triggerAttackRelease('G5', 0.04, now + 0.05, 0.35);
    pauseSynth.triggerAttackRelease('E5', 0.04, now + 0.1, 0.35);
    pauseSynth.triggerAttackRelease('C5', 0.08, now + 0.15, 0.35);
  }

  function playUnpause() {
    if (!enabled || Tone.context.state !== 'running' || !pauseSynth) {
      return;
    }

    const now = Tone.now() + 0.001;
    pauseSynth.triggerAttackRelease('C5', 0.04, now, 0.35);
    pauseSynth.triggerAttackRelease('E5', 0.04, now + 0.05, 0.35);
    pauseSynth.triggerAttackRelease('G5', 0.04, now + 0.1, 0.35);
    pauseSynth.triggerAttackRelease('C6', 0.08, now + 0.15, 0.35);
  }

  function playFireDenial() {
    if (!enabled || Tone.context.state !== 'running' || !fireDenialSynth) {
      return;
    }

    const nowMs = performance.now();
    if (nowMs - lastFireDenialTime < 80) {
      return;
    }
    lastFireDenialTime = nowMs;

    const now = Tone.now() + 0.001;
    fireDenialSynth.triggerAttackRelease('C3', 0.035, now, 0.35);
  }

  function playCooldownReady(weaponId) {
    if (!enabled || Tone.context.state !== 'running') {
      return;
    }

    const now = Tone.now() + 0.001;

    if (weaponId === 'shotgun' || weaponId === 'missile') {
      if (!cooldownReadySynth) return;
      cooldownReadySynth.triggerAttackRelease('E6', 0.06, now, 0.25);
    } else {
      if (!cooldownReadySynth) return;
      cooldownReadySynth.triggerAttackRelease('C6', 0.05, now, 0.2);
    }
  }

  function updateTargetingAudio(threatLevel) {
    if (!enabled || Tone.context.state !== 'running') {
      return;
    }

    const nowMs = performance.now();

    if (threatLevel > 0) {
      const intervalMs = threatLevel === 2 ? 600 : 1500;

      if (lastTargetingThreatLevel !== threatLevel) {
        nextTargetingPingTime = 0;
      }

      if (nowMs >= nextTargetingPingTime) {
        playTrackingPing(threatLevel);
        nextTargetingPingTime = nowMs + intervalMs;
      }
    } else {
      nextTargetingPingTime = 0;
    }

    lastTargetingThreatLevel = threatLevel;
  }

  function suspendAll() {
    if (!started || Tone.context.state !== 'running') {
      return;
    }

    const now = Tone.now();

    if (thrusterGain) {
      thrusterGain.gain.cancelScheduledValues(now);
      thrusterGain.gain.setValueAtTime(0.0001, now);
    }
    if (thrusterRumbleGain) {
      thrusterRumbleGain.gain.cancelScheduledValues(now);
      thrusterRumbleGain.gain.setValueAtTime(0.0001, now);
    }
    if (flamethrowerNoiseGain) {
      flamethrowerNoiseGain.gain.cancelScheduledValues(now);
      flamethrowerNoiseGain.gain.setValueAtTime(0.0001, now);
    }
    if (flamethrowerToneGain) {
      flamethrowerToneGain.gain.cancelScheduledValues(now);
      flamethrowerToneGain.gain.setValueAtTime(0.0001, now);
    }
    if (flamethrowerBodyGain) {
      flamethrowerBodyGain.gain.cancelScheduledValues(now);
      flamethrowerBodyGain.gain.setValueAtTime(0.0001, now);
    }
    if (flamethrowerPulseGain) {
      flamethrowerPulseGain.gain.cancelScheduledValues(now);
      flamethrowerPulseGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionRoarGain) {
      missileExplosionRoarGain.gain.cancelScheduledValues(now);
      missileExplosionRoarGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionRumbleGain) {
      missileExplosionRumbleGain.gain.cancelScheduledValues(now);
      missileExplosionRumbleGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionThunderGain) {
      missileExplosionThunderGain.gain.cancelScheduledValues(now);
      missileExplosionThunderGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionThunderOscGain) {
      missileExplosionThunderOscGain.gain.cancelScheduledValues(now);
      missileExplosionThunderOscGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionThunderBedGain) {
      missileExplosionThunderBedGain.gain.cancelScheduledValues(now);
      missileExplosionThunderBedGain.gain.setValueAtTime(0.0001, now);
    }
    if (missileExplosionThunderBedOscGain) {
      missileExplosionThunderBedOscGain.gain.cancelScheduledValues(now);
      missileExplosionThunderBedOscGain.gain.setValueAtTime(0.0001, now);
    }
    if (impactGain) {
      impactGain.gain.cancelScheduledValues(now);
      impactGain.gain.setValueAtTime(0.0001, now);
    }
    if (collisionGain) {
      collisionGain.gain.cancelScheduledValues(now);
      collisionGain.gain.setValueAtTime(0, now);
    }

    lastThrustInput = 0;
    lastFlamethrowerInput = 0;
  }

  function dispose() {
    removeUnlockListeners();

    shutdownGraph();
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);

    if (!enabled) {
      shutdownGraph();
      updateStatus();
      return;
    }

    if (Tone.context.state === 'running') {
      state.isUnlocked = true;
      ensureGraph();
    }

    updateStatus();
  }

  function toggleEnabled() {
    setEnabled(!enabled);
  }

  updateStatus();

  return {
    dispose,
    getUiState,
    installUnlockHandlers,
    playCollision,
    playImpact,
    playMissileExplosion,
    playMissileCooldown,
    playMissileLaunch,
    playPause,
    playUnpause,
    playShot,
    playShotgun,
    playDock,
    playWeaponSwitch,
    playPlayerLockAcquired,
    playPlayerLockLost,
    playEnemyLockPing,
    setFlamethrower,
    setThrust,
    setEnabled,
    suspendAll,
    toggleEnabled,
    updateWarnings,
    updateTargetingAudio,
    updateEnemyLockAudio,
    playFireDenial,
    playCooldownReady,
  };
}

export { createAudioSystem };
