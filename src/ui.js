import * as THREE from 'three';
import Stats from 'stats.js';
import { PERSPECTIVE_OBSERVER } from './camera-controls.js';
import { transformRocketLocalPoint } from './rocket-orientation.js';
import { ROCKET_TARGET_ANCHOR } from './rocket-voxels.js';

const MIN_BRACKET_SIZE = 32;
const MAX_BRACKET_SIZE = 117;
const LOCK_ACQUIRE_TIME_MS = 500;
const LOCK_DECAY_TIME_MS = 500;
const LOCK_GRACE_TIME_MS = 400;
const LOCK_BREAK_ANGLE_DEG = 35;
const LOCK_BREAK_ANGLE_RAD = (LOCK_BREAK_ANGLE_DEG * Math.PI) / 180;

const NEAR_DISTANCE = 80;
const FAR_DISTANCE = 350;

const LOCK_IMPULSE_DURATION_MS = 300;
const LOCK_IMPULSE_PEAK_SCALE = 1.15;
const LOCK_IMPULSE_PEAK_TIME_MS = 80;

const FIRE_DENIED_FLICKER_MS = 40;

const LOCK_SWITCH_CONFIRM_MS = 300;
const LOCK_SWITCH_SCORE_RATIO = 0.7;
const LOCK_CURRENT_BIAS = 0.75;

const COLORS = {
  crosshair: '#ccddff',
  tickMark: '#aabbcc',
  corner: '#ffffff',
  lockGlow: '#ffcc00',
  lockFill: '#ffbb00',
  lockGlowAi2: '#6699ff',
  lockFillAi2: '#5588ee',
  cooldownReady: '#88ccff',
  cooldownCooling: '#556677',
};

function addStats(parentDomElement) {
  const stats = new Stats();
  stats.showPanel(0);

  stats.dom.style.position = 'absolute';
  stats.dom.style.top = '10px';
  stats.dom.style.left = '10px';
  stats.dom.style.zIndex = '101';
  stats.dom.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.28)';

  parentDomElement.appendChild(stats.dom);
  return stats;
}

function createUI() {
  const hud = createSpatialLocatorHud();

  return { hud };
}

function createSpatialLocatorHud() {
  const canvas = document.getElementById('hud');
  const ctx = canvas.getContext('2d');

  const hud = {
    canvas,
    ctx,
    currentPerspective: null,
    lockState: 'none',
    lockStrength: 0,
    lockGraceTimer: 0,
    prevBracketSize: MIN_BRACKET_SIZE,
    lockSnapTime: 0,
    lockSnapFrom: MIN_BRACKET_SIZE,
    lockRingAlpha: 0,
    lockImpulseTime: 0,
    prevDistanceFactor: 1,
    lockedTargetRocket: null,
    lockedTargetScore: 0,
    switchCandidate: null,
    switchCandidateScore: 0,
    switchConfirmTimer: 0,
    targetDistances: new Map(),
    prevBracketSizes: new Map(),
  };

  window.addEventListener('resize', function () {
    if (hud.currentPerspective) {
      resizeHud(hud, hud.currentPerspective);
    }
  });

  document.addEventListener('fullscreenchange', function () {
    if (hud.currentPerspective) {
      resizeHud(hud, hud.currentPerspective);
    }
  });

  return hud;
}

function resizeHud(hud, perspective) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width, height;

  if (perspective !== PERSPECTIVE_OBSERVER) {
    width = window.innerWidth;
    height = window.innerHeight;
    hud.canvas.style.left = '0';
    hud.canvas.style.top = '0';
    hud.canvas.style.transform = 'none';
    hud.canvas.style.right = 'auto';
    hud.canvas.style.bottom = 'auto';
    hud.canvas.style.width = width + 'px';
    hud.canvas.style.height = height + 'px';
    hud.canvas.style.display = 'block';
  } else {
    hud.canvas.style.display = 'none';
    return;
  }

  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);

  if (hud.canvas.width !== pixelWidth || hud.canvas.height !== pixelHeight) {
    hud.canvas.width = pixelWidth;
    hud.canvas.height = pixelHeight;
    hud.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  hud.displayWidth = width;
  hud.displayHeight = height;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawGlowShape(ctx, drawFn, color, glowRadius) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowRadius * 2;
  ctx.globalAlpha = 0.4;
  drawFn();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowRadius * 0.5;
  ctx.globalAlpha = 1.0;
  drawFn();
  ctx.restore();
}

function drawDiamond(ctx, cx, cy, size) {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + half, cy);
  ctx.lineTo(cx, cy + half);
  ctx.lineTo(cx - half, cy);
  ctx.closePath();
}

function drawFilledDiamond(ctx, cx, cy, size) {
  drawDiamond(ctx, cx, cy, size);
  ctx.fill();
}

function drawHollowDiamond(ctx, cx, cy, size) {
  drawDiamond(ctx, cx, cy, size);
  ctx.stroke();
}

function drawCornerBrackets(ctx, cx, cy, bracketSize, bracketLen) {
  const half = bracketSize / 2;
  const bLen = bracketLen || 8;

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half + bLen);
  ctx.lineTo(cx - half, cy - half);
  ctx.lineTo(cx - half + bLen, cy - half);

  ctx.moveTo(cx + half - bLen, cy - half);
  ctx.lineTo(cx + half, cy - half);
  ctx.lineTo(cx + half, cy - half + bLen);

  ctx.moveTo(cx + half, cy + half - bLen);
  ctx.lineTo(cx + half, cy + half);
  ctx.lineTo(cx + half - bLen, cy + half);

  ctx.moveTo(cx - half + bLen, cy + half);
  ctx.lineTo(cx - half, cy + half);
  ctx.lineTo(cx - half, cy + half - bLen);
  ctx.stroke();
}

function drawLockRing(ctx, cx, cy, radius, alpha, color) {
  var ringColor = color || COLORS.lockGlow;
  ctx.save();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = ringColor;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCrosshair(ctx, cx, cy, size, occluded, cooldownState) {
  var time = performance.now();
  var breathPhase = Math.sin(time * 0.003) * 0.5 + 0.5;
  var breathScale = 1 + breathPhase * 0.06;
  var breathAlpha = 0.65 + breathPhase * 0.35;
  var actualSize = size * breathScale * 0.7;
  var half = actualSize / 2;
  var gap = 5;

  var cooldownProgress = 1;
  var fireDenied = false;
  var fireDeniedTime = 0;
  var fireIntervalMs = 0;
  if (cooldownState) {
    cooldownProgress =
      cooldownState.cooldownProgress != null
        ? cooldownState.cooldownProgress
        : 1;
    fireDenied = cooldownState.fireDenied || false;
    fireDeniedTime = cooldownState.fireDeniedTime || 0;
    fireIntervalMs = cooldownState.fireIntervalMs || 0;
  }

  var isFastWeapon = fireIntervalMs < 200;

  var isReady = cooldownProgress >= 1;
  var isCooling = cooldownProgress < 1;
  var isNearReady = !isReady && cooldownProgress >= 0.8;

  var flickerAlpha = 1;
  var flickerSnap = 0;
  if (fireDenied && fireDeniedTime > 0) {
    var timeSinceDenied = time - fireDeniedTime;
    if (timeSinceDenied < FIRE_DENIED_FLICKER_MS) {
      var flickerT = timeSinceDenied / FIRE_DENIED_FLICKER_MS;
      flickerAlpha = 0.4 + Math.sin(flickerT * Math.PI * 2) * 0.6;
      flickerSnap = Math.sin(flickerT * Math.PI) * 0.15;
    }
  }

  var readyPulseScale = 1;
  var readyPulseAlpha = 1;
  var readyGlow = 0;
  if (isReady && cooldownState && cooldownState.lastFireTime) {
    var timeSinceReady = time - cooldownState.lastFireTime;
    if (cooldownProgress >= 1 && timeSinceReady < 150) {
      var pulseT = timeSinceReady / 150;
      readyPulseScale = 1 + Math.sin(pulseT * Math.PI) * 0.18;
      readyPulseAlpha = 0.8 + Math.sin(pulseT * Math.PI) * 0.2;
      readyGlow = Math.sin(pulseT * Math.PI) * 14;
    }
  }

  var lineRetract = 0;
  var gapExpand = 0;
  if (isCooling && !isFastWeapon) {
    lineRetract = (1 - cooldownProgress) * 0.55;
    gapExpand = (1 - cooldownProgress) * 4;
  }
  lineRetract += flickerSnap;
  var effectiveHalf = half * (1 - lineRetract);
  var effectiveGap = gap + gapExpand;

  if (effectiveHalf <= effectiveGap + 2) {
    effectiveHalf = effectiveGap + 2;
  }

  var baseAlpha = isCooling
    ? isFastWeapon
      ? 0.7
      : 0.3 + cooldownProgress * 0.55
    : breathAlpha * readyPulseAlpha;

  var baseColor = COLORS.crosshair;
  if (isNearReady) {
    baseColor = COLORS.cooldownReady;
  }

  if (isCooling) {
    if (isFastWeapon) {
      baseColor = '#ffb300';
    } else {
      var r = Math.round(200 + 55 * cooldownProgress);
      var g = Math.round(130 + 49 * cooldownProgress);
      var b = Math.round(0 + 0 * cooldownProgress);
      baseColor = 'rgb(' + r + ',' + g + ',' + b + ')';
    }
  }

  var glowAmount = isReady ? readyGlow || 12 : isNearReady ? 8 : 3;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(readyPulseScale, readyPulseScale);
  ctx.translate(-cx, -cy);

  ctx.globalAlpha = baseAlpha * flickerAlpha;
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.shadowColor =
    isNearReady || (isReady && readyGlow > 0)
      ? COLORS.cooldownReady
      : isCooling
        ? '#cc8800'
        : '#99bbee';
  ctx.shadowBlur = glowAmount;

  ctx.beginPath();
  ctx.moveTo(cx - effectiveHalf, cy);
  ctx.lineTo(cx - effectiveGap, cy);
  ctx.moveTo(cx + effectiveGap, cy);
  ctx.lineTo(cx + effectiveHalf, cy);
  ctx.moveTo(cx, cy - effectiveHalf);
  ctx.lineTo(cx, cy - effectiveGap);
  ctx.moveTo(cx, cy + effectiveGap);
  ctx.lineTo(cx, cy + effectiveHalf);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = baseColor;
  if (occluded) {
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isNearReady && !fireDenied) {
    var nearReadyGlow = (cooldownProgress - 0.8) / 0.2;
    ctx.globalAlpha = nearReadyGlow * 0.15;
    ctx.strokeStyle = COLORS.cooldownReady;
    ctx.lineWidth = 1;
    ctx.shadowColor = COLORS.cooldownReady;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, effectiveHalf + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawTickMarks(ctx, cx, cy, axis, count, spacing, length) {
  ctx.strokeStyle = COLORS.tickMark;
  ctx.lineWidth = 1;

  for (let i = 1; i <= count; i++) {
    const offset = i * spacing;
    if (axis === 'horizontal') {
      ctx.beginPath();
      ctx.moveTo(cx + offset, cy - length / 2);
      ctx.lineTo(cx + offset, cy + length / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - offset, cy - length / 2);
      ctx.lineTo(cx - offset, cy + length / 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - length / 2, cy + offset);
      ctx.lineTo(cx + length / 2, cy + offset);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - length / 2, cy - offset);
      ctx.lineTo(cx + length / 2, cy - offset);
      ctx.stroke();
    }
  }
}

function drawEdgeArrow(ctx, cx, cy, angle, size, color, offscreenDist) {
  const w = ctx.canvas.width / (window.devicePixelRatio || 1);
  const h = ctx.canvas.height / (window.devicePixelRatio || 1);
  const margin = 30;

  const maxDist = Math.max(w, h) * 0.5;
  const distFactor = Math.min(1, (offscreenDist || maxDist) / maxDist);

  let edgeX, edgeY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  if (Math.abs(cos) > Math.abs(sin)) {
    edgeX = cos > 0 ? w - margin : margin;
    edgeY = cy + sin * ((edgeX - cx) / cos);
    edgeY = Math.max(margin + 10, Math.min(h - margin - 10, edgeY));
  } else {
    edgeY = sin > 0 ? h - margin : margin;
    edgeX = cx + cos * ((edgeY - cy) / sin);
    edgeX = Math.max(margin + 10, Math.min(w - margin - 10, edgeX));
  }

  const arrowAngle = Math.atan2(edgeY - cy, edgeX - cx);

  var time = performance.now();
  var pulsePhase = Math.sin(time * 0.004) * 0.5 + 0.5;
  var pulseAlpha = 0.65 + pulsePhase * 0.35;
  var pulseSize = 1 + pulsePhase * 0.12 * distFactor;
  var drawSize = size * pulseSize;

  ctx.save();
  ctx.translate(edgeX, edgeY);
  ctx.rotate(arrowAngle);

  ctx.fillStyle = color;
  ctx.globalAlpha = pulseAlpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8 + distFactor * 6;
  ctx.beginPath();
  ctx.moveTo(drawSize * 1.4, 0);
  ctx.lineTo(-drawSize * 0.5, -drawSize * 0.75);
  ctx.lineTo(-drawSize * 0.5, drawSize * 0.75);
  ctx.closePath();
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawDashedLine(ctx, x1, y1, x2, y2, color) {
  var dx = x2 - x1;
  var dy = y2 - y1;
  var dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([7, 5]);
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTarget(
  ctx,
  cx,
  cy,
  color,
  isLocked,
  isCandidate,
  isVisible,
  scale,
  centerX,
  centerY,
  bracketSize,
  lockRingAlpha,
  distanceFactor,
  lockImpulseScale,
  lockImpulseBrightness,
  lockStrength,
  lockGlowColor,
  lockFillColor
) {
  var baseSize = 33 * scale;
  var time = performance.now();

  var dx = cx - centerX;
  var dy = cy - centerY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var maxDist = Math.sqrt(centerX * centerX + centerY * centerY) || 1;
  var normDist = Math.min(1, dist / maxDist);
  var atten = 0.4 + 0.6 * (1 - normDist);

  var diamondScale = lerp(0.9, 1.0, distanceFactor);
  var diamondOpacity = lerp(0.75, 1.0, distanceFactor);
  var bracketScale = lerp(0.9, 1.0, distanceFactor);
  var bracketOpacity = lerp(0.7, 1.0, distanceFactor);

  if (isLocked) {
    diamondOpacity = Math.max(diamondOpacity, 0.75);
    diamondScale = Math.max(diamondScale, 0.75);
    bracketOpacity = Math.max(bracketOpacity, 0.75);
  }

  if (isLocked && lockStrength != null && lockStrength < 1) {
    diamondOpacity *= lockStrength;
    bracketOpacity *= lockStrength;
  }

  if (!lockGlowColor) lockGlowColor = '#ffcc00';
  if (!lockFillColor) lockFillColor = '#ffbb00';

  var finalScale = scale * diamondScale;
  if (lockImpulseScale > 1) {
    finalScale *= lockImpulseScale;
  }

  if (isLocked && isVisible) {
    var lockPulse = Math.sin(time * 0.006) * 0.15 + 0.85;
    var lockedSize = baseSize * lockPulse * atten * finalScale;

    var lockAlpha = atten * diamondOpacity;
    if (lockImpulseBrightness > 1) {
      lockAlpha = Math.min(1, lockAlpha * lockImpulseBrightness);
    }

    drawGlowShape(
      ctx,
      function () {
        ctx.strokeStyle = lockGlowColor;
        ctx.lineWidth = 3;
        drawHollowDiamond(ctx, cx, cy, lockedSize);
      },
      lockGlowColor,
      16 * scale
    );

    ctx.save();
    ctx.fillStyle = lockFillColor;
    ctx.globalAlpha = lockAlpha;
    drawFilledDiamond(ctx, cx, cy, lockedSize * 0.7);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = lockGlowColor;
    ctx.globalAlpha = lockAlpha * 0.6;
    drawFilledDiamond(ctx, cx, cy, lockedSize * 0.35);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = lockGlowColor;
    ctx.shadowBlur = 10 * scale;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = lockGlowColor;
    ctx.globalAlpha = bracketOpacity * atten;
    drawCornerBrackets(ctx, cx, cy, bracketSize * bracketScale, 12 * scale);
    ctx.shadowBlur = 0;
    ctx.restore();

    if (lockRingAlpha > 0) {
      drawLockRing(ctx, cx, cy, lockedSize * 0.8, lockRingAlpha, lockGlowColor);
    }
  } else if (isCandidate && isVisible) {
    var candidateSize = baseSize * atten * finalScale;

    drawGlowShape(
      ctx,
      function () {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        drawHollowDiamond(ctx, cx, cy, candidateSize);
      },
      color,
      8 * scale
    );

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.55 * atten * bracketOpacity;
    drawCornerBrackets(ctx, cx, cy, bracketSize * bracketScale, 10 * scale);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45 * atten * diamondOpacity;
    drawFilledDiamond(ctx, cx, cy, 7 * scale * atten * diamondScale);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3 * atten * diamondOpacity;
    drawFilledDiamond(ctx, cx, cy, 3.5 * scale * atten * diamondScale);
    ctx.restore();
  } else if (isVisible) {
    var alignSize = baseSize * atten * finalScale;

    drawGlowShape(
      ctx,
      function () {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        drawHollowDiamond(ctx, cx, cy, alignSize);
      },
      color,
      8 * scale
    );

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.45 * atten * diamondOpacity;
    drawFilledDiamond(ctx, cx, cy, 7 * scale * atten * diamondScale);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3 * atten * diamondOpacity;
    drawFilledDiamond(ctx, cx, cy, 3.5 * scale * atten * diamondScale);
    ctx.restore();
  } else {
    var occludedPulse = Math.sin(time * 0.002) * 0.2 + 0.8;
    var occludedSize = baseSize * occludedPulse * atten * finalScale;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.5 * atten * diamondOpacity;
    ctx.setLineDash([6, 4]);
    drawHollowDiamond(ctx, cx, cy, occludedSize);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function updateSpatialLocatorHud(
  hud,
  perspective,
  playerRocket,
  targets,
  aiEnabled,
  camera,
  hudEnabled,
  crosshairEnabled,
  audioSystem,
  dt,
  weaponCooldownState
) {
  const isObserver = perspective === PERSPECTIVE_OBSERVER;
  const shouldShow = (hudEnabled || crosshairEnabled) && !isObserver;
  const shouldShowTargetingHud = hudEnabled;
  const shouldShowCrosshair = hudEnabled || crosshairEnabled;

  if (hud.currentPerspective !== perspective) {
    hud.currentPerspective = perspective;
    resizeHud(hud, perspective);
  }

  if (!shouldShow) {
    if (hud.canvas.style.display !== 'none') {
      hud.canvas.style.display = 'none';
    }
    return;
  }

  if (hud.canvas.style.display === 'none') {
    hud.canvas.style.display = 'block';
  }

  const ctx = hud.ctx;
  const w = hud.displayWidth;
  const h = hud.displayHeight;
  const cx = w / 2;
  const cy = h / 2;
  const scale = 1;

  ctx.clearRect(0, 0, w, h);

  if (!aiEnabled || !playerRocket || !targets || targets.length === 0) {
    if (shouldShowCrosshair) {
      drawCrosshair(ctx, cx, cy, 48 * scale, false, weaponCooldownState);
    }
    hud.prevBracketSize = MIN_BRACKET_SIZE;
    hud.lockState = 'none';
    hud.lockStrength = 0;
    hud.lockGraceTimer = 0;
    hud.lockSnapTime = 0;
    hud.lockRingAlpha = 0;
    hud.lockImpulseTime = 0;
    hud.prevDistanceFactor = 1;
    hud.lockedTargetRocket = null;
    hud.lockedTargetScore = 0;
    hud.switchCandidate = null;
    hud.switchConfirmTimer = 0;
    return;
  }

  const camForward = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camRight.crossVectors(camForward, camera.up).normalize();
  camUp.crossVectors(camRight, camForward).normalize();

  var targetInfos = [];
  var candidates = [];

  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var rocket = t.rocket;
    var aiIndex = t.aiIndex || 0;
    var visible = t.isVisible !== false;

    var targetWorldPos = new THREE.Vector3();
    transformRocketLocalPoint(
      rocket,
      new THREE.Vector3(
        ROCKET_TARGET_ANCHOR.x,
        ROCKET_TARGET_ANCHOR.y,
        ROCKET_TARGET_ANCHOR.z
      ),
      targetWorldPos
    );

    var projected = targetWorldPos.clone().project(camera);
    var projectedX = (projected.x * 0.5 + 0.5) * w;
    var projectedY = (-projected.y * 0.5 + 0.5) * h;

    var targetDir = new THREE.Vector3()
      .copy(targetWorldPos)
      .sub(playerRocket.position)
      .normalize();

    var yawDiff = Math.atan2(
      targetDir.dot(camRight),
      targetDir.dot(camForward)
    );
    var pitchDiff = Math.asin(Math.max(-1, Math.min(1, targetDir.dot(camUp))));

    var isBehind = targetDir.dot(camForward) < 0;
    var targetIsInFront = !isBehind;

    var distanceToTarget = targetWorldPos.distanceTo(playerRocket.position);

    var distanceFactor = clamp01(
      1 - (distanceToTarget - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE)
    );
    if (hud.targetDistances.has(rocket)) {
      distanceFactor = lerp(
        hud.targetDistances.get(rocket),
        distanceFactor,
        0.2
      );
    }
    hud.targetDistances.set(rocket, distanceFactor);

    var ROCKET_CORE_RADIUS = 2.0;
    var perpOffset = new THREE.Vector3()
      .copy(camRight)
      .multiplyScalar(ROCKET_CORE_RADIUS);
    var edgeWorldPos = targetWorldPos.clone().add(perpOffset);
    var projectedEdge = edgeWorldPos.clone().project(camera);
    var projectedEdgeX = (projectedEdge.x * 0.5 + 0.5) * w;
    var projectedEdgeY = (-projectedEdge.y * 0.5 + 0.5) * h;
    var projectedCoreRadius = Math.sqrt(
      (projectedEdgeX - projectedX) * (projectedEdgeX - projectedX) +
        (projectedEdgeY - projectedY) * (projectedEdgeY - projectedY)
    );

    var targetSize = Math.min(
      MAX_BRACKET_SIZE,
      Math.max(MIN_BRACKET_SIZE, projectedCoreRadius * 1.6)
    );

    var bracketSize;
    if (hud.prevBracketSizes.has(rocket)) {
      var prevSize = hud.prevBracketSizes.get(rocket);
      bracketSize = prevSize + (targetSize - prevSize) * 0.15;
    } else {
      bracketSize = targetSize;
    }
    hud.prevBracketSizes.set(rocket, bracketSize);

    var bracketHalf = bracketSize / 2;
    var isInsideLockArea =
      cx >= projectedX - bracketHalf &&
      cx <= projectedX + bracketHalf &&
      cy >= projectedY - bracketHalf &&
      cy <= projectedY + bracketHalf;

    var hasLineOfSight = visible;
    var angleToTarget = Math.sqrt(yawDiff * yawDiff + pitchDiff * pitchDiff);
    var angleWithinLimit = angleToTarget <= LOCK_BREAK_ANGLE_RAD;

    var dx = projectedX - cx;
    var dy = projectedY - cy;
    var distanceToCrosshairPx = Math.sqrt(dx * dx + dy * dy);
    var score = distanceToCrosshairPx * 2.0 + distanceToTarget * 0.3;

    var colors = ['#ffdd44', '#6699ff', '#44ff88', '#ff44aa'];
    var lockGlowColors = ['#ffcc00', '#6699ff', '#44ff88', '#ff44aa'];
    var lockFillColors = ['#ffbb00', '#5588ee', '#44dd88', '#ff44aa'];

    var color = colors[aiIndex] || colors[0];
    var lockGlowColor = lockGlowColors[aiIndex] || lockGlowColors[0];
    var lockFillColor = lockFillColors[aiIndex] || lockFillColors[0];

    var isOffScreen =
      projectedX < 0 || projectedX > w || projectedY < 0 || projectedY > h;

    var info = {
      rocket: rocket,
      aiIndex: aiIndex,
      visible: visible,
      targetWorldPos: targetWorldPos,
      projectedX: projectedX,
      projectedY: projectedY,
      yawDiff: yawDiff,
      pitchDiff: pitchDiff,
      isBehind: isBehind,
      isOffScreen: isOffScreen,
      targetIsInFront: targetIsInFront,
      hasLineOfSight: hasLineOfSight,
      distanceToTarget: distanceToTarget,
      distanceFactor: distanceFactor,
      bracketSize: bracketSize,
      isInsideLockArea: isInsideLockArea,
      angleToTarget: angleToTarget,
      angleWithinLimit: angleWithinLimit,
      score: score,
      color: color,
      lockGlowColor: lockGlowColor,
      lockFillColor: lockFillColor,
    };
    targetInfos.push(info);

    if (targetIsInFront && hasLineOfSight && isInsideLockArea) {
      candidates.push(info);
    }
  }

  // Clean up stale entries from targetDistances and prevBracketSizes maps
  for (var k of hud.targetDistances.keys()) {
    var foundDist = false;
    for (var idx = 0; idx < targets.length; idx++) {
      if (targets[idx].rocket === k) {
        foundDist = true;
        break;
      }
    }
    if (!foundDist) {
      hud.targetDistances.delete(k);
    }
  }
  for (var k2 of hud.prevBracketSizes.keys()) {
    var foundBracket = false;
    for (var idx2 = 0; idx2 < targets.length; idx2++) {
      if (targets[idx2].rocket === k2) {
        foundBracket = true;
        break;
      }
    }
    if (!foundBracket) {
      hud.prevBracketSizes.delete(k2);
    }
  }

  // Sort candidates by score (lower = better)
  candidates.sort(function (a, b) {
    return a.score - b.score;
  });
  var bestCandidate = candidates.length > 0 ? candidates[0] : null;

  const dtMs = dt * 1000;
  const acquireRate = dtMs / LOCK_ACQUIRE_TIME_MS;
  const decayRate = dtMs / LOCK_DECAY_TIME_MS;

  // Check if locked target still exists in targets array
  var lockedTargetExists = false;
  if (hud.lockedTargetRocket) {
    for (var idx3 = 0; idx3 < targets.length; idx3++) {
      if (targets[idx3].rocket === hud.lockedTargetRocket) {
        lockedTargetExists = true;
        break;
      }
    }
  }

  // Find info for currently locked target
  var lockedInfo = null;
  if (hud.lockedTargetRocket && lockedTargetExists) {
    for (var idx4 = 0; idx4 < targetInfos.length; idx4++) {
      if (targetInfos[idx4].rocket === hud.lockedTargetRocket) {
        lockedInfo = targetInfos[idx4];
        break;
      }
    }
  }

  // Apply bias to locked target's score for hysteresis
  if (
    lockedInfo &&
    (hud.lockState === 'locked' || hud.lockState === 'decaying')
  ) {
    lockedInfo.score *= LOCK_CURRENT_BIAS;
    // Re-sort candidates since scores changed
    candidates.sort(function (a, b) {
      return a.score - b.score;
    });
    bestCandidate = candidates.length > 0 ? candidates[0] : null;
  }

  // Hard break check for locked target
  var hardBreak = false;
  if (lockedInfo) {
    hardBreak =
      !lockedInfo.targetIsInFront ||
      lockedInfo.angleToTarget > LOCK_BREAK_ANGLE_RAD;
  }
  if (!lockedTargetExists && hud.lockedTargetRocket) {
    hardBreak = true;
  }

  if (hardBreak && hud.lockState !== 'none') {
    hud.lockState = 'none';
    hud.lockStrength = 0;
    hud.lockGraceTimer = 0;
    hud.lockedTargetRocket = null;
    hud.lockedTargetScore = 0;
    hud.switchCandidate = null;
    hud.switchConfirmTimer = 0;
    if (audioSystem && typeof audioSystem.playPlayerLockLost === 'function') {
      audioSystem.playPlayerLockLost();
    }
  }

  // Lock validity for maintaining
  var lockedCanMaintain = false;
  if (lockedInfo) {
    lockedCanMaintain =
      lockedInfo.targetIsInFront &&
      lockedInfo.hasLineOfSight &&
      lockedInfo.angleWithinLimit;
  }

  var now = performance.now();

  switch (hud.lockState) {
    case 'none':
      hud.lockStrength = 0;
      hud.lockedTargetRocket = null;
      hud.lockedTargetScore = 0;
      hud.switchCandidate = null;
      hud.switchConfirmTimer = 0;
      if (bestCandidate) {
        hud.lockState = 'acquiring';
        hud.lockedTargetRocket = bestCandidate.rocket;
        hud.lockedTargetScore = bestCandidate.score;
      }
      break;
    case 'acquiring':
      // Find acquiring target info
      var acquiringInfo = null;
      if (hud.lockedTargetRocket) {
        for (var idx5 = 0; idx5 < targetInfos.length; idx5++) {
          if (targetInfos[idx5].rocket === hud.lockedTargetRocket) {
            acquiringInfo = targetInfos[idx5];
            break;
          }
        }
      }
      if (
        acquiringInfo &&
        acquiringInfo.targetIsInFront &&
        acquiringInfo.hasLineOfSight &&
        acquiringInfo.isInsideLockArea
      ) {
        hud.lockStrength += acquireRate;
        if (hud.lockStrength >= 1) {
          hud.lockStrength = 1;
          hud.lockState = 'locked';
          hud.lockGraceTimer = LOCK_GRACE_TIME_MS;
          hud.lockSnapTime = now;
          hud.lockSnapFrom = hud.prevBracketSize || MIN_BRACKET_SIZE;
          hud.lockRingAlpha = 1.0;
          hud.lockImpulseTime = now;
          hud.lockedTargetScore = acquiringInfo.score;
          if (
            audioSystem &&
            typeof audioSystem.playPlayerLockAcquired === 'function'
          ) {
            audioSystem.playPlayerLockAcquired();
          }
        }
      } else {
        hud.lockStrength -= decayRate;
        if (hud.lockStrength <= 0) {
          hud.lockStrength = 0;
          hud.lockState = 'none';
          hud.lockedTargetRocket = null;
          hud.lockedTargetScore = 0;
        }
      }
      // While acquiring, check if another candidate is significantly better
      if (
        bestCandidate &&
        acquiringInfo &&
        bestCandidate.rocket !== acquiringInfo.rocket
      ) {
        if (
          bestCandidate.score <
          acquiringInfo.score * LOCK_SWITCH_SCORE_RATIO
        ) {
          hud.lockedTargetRocket = bestCandidate.rocket;
          hud.lockedTargetScore = bestCandidate.score;
          hud.lockStrength = Math.max(0, hud.lockStrength - 0.3);
        }
      }
      break;
    case 'locked':
      if (lockedCanMaintain) {
        hud.lockStrength = 1;
        hud.lockGraceTimer = LOCK_GRACE_TIME_MS;
        // Check if a better candidate exists for switching
        if (
          bestCandidate &&
          lockedInfo &&
          bestCandidate.rocket !== lockedInfo.rocket
        ) {
          if (
            bestCandidate.score <
            lockedInfo.score * LOCK_SWITCH_SCORE_RATIO
          ) {
            if (bestCandidate.rocket === hud.switchCandidate) {
              hud.switchConfirmTimer += dtMs;
              if (hud.switchConfirmTimer >= LOCK_SWITCH_CONFIRM_MS) {
                // Switch to new target
                hud.lockedTargetRocket = bestCandidate.rocket;
                hud.lockedTargetScore = bestCandidate.score;
                hud.lockState = 'acquiring';
                hud.lockStrength = 0.5;
                hud.lockSnapTime = now;
                hud.lockSnapFrom = hud.prevBracketSize || MIN_BRACKET_SIZE;
                hud.lockRingAlpha = 0.5;
                hud.switchCandidate = null;
                hud.switchConfirmTimer = 0;
              }
            } else {
              hud.switchCandidate = bestCandidate.rocket;
              hud.switchConfirmTimer = 0;
            }
          } else {
            hud.switchCandidate = null;
            hud.switchConfirmTimer = 0;
          }
        } else {
          hud.switchCandidate = null;
          hud.switchConfirmTimer = 0;
        }
      } else {
        hud.lockState = 'decaying';
      }
      break;
    case 'decaying':
      if (lockedCanMaintain) {
        hud.lockState = 'locked';
        hud.lockStrength = 1;
        hud.lockGraceTimer = LOCK_GRACE_TIME_MS;
      } else {
        hud.lockGraceTimer -= dtMs;
        if (hud.lockGraceTimer <= 0) {
          hud.lockStrength -= decayRate;
        }
        if (hud.lockStrength <= 0) {
          hud.lockStrength = 0;
          hud.lockState = 'none';
          hud.lockedTargetRocket = null;
          hud.lockedTargetScore = 0;
          hud.switchCandidate = null;
          hud.switchConfirmTimer = 0;
          if (
            audioSystem &&
            typeof audioSystem.playPlayerLockLost === 'function'
          ) {
            audioSystem.playPlayerLockLost();
          }
        }
      }
      break;
  }

  hud.lockStrength = clamp01(hud.lockStrength);

  const isLocked = hud.lockState === 'locked' || hud.lockState === 'decaying';

  // Find which target to use for crosshair occluded state
  // Priority: locked > best candidate > nearest in-front target
  var guidanceInfo = null;
  if (isLocked && lockedInfo) {
    guidanceInfo = lockedInfo;
  } else if (!isLocked && bestCandidate) {
    guidanceInfo = bestCandidate;
  } else if (!isLocked) {
    // Fallback: pick the in-front target closest to crosshair center
    for (var gi = 0; gi < targetInfos.length; gi++) {
      if (!targetInfos[gi].isBehind && !targetInfos[gi].isOffScreen) {
        if (
          !guidanceInfo ||
          targetInfos[gi].angleToTarget < guidanceInfo.angleToTarget
        ) {
          guidanceInfo = targetInfos[gi];
        }
      }
    }
  }

  // Draw each target
  for (var drawIdx = 0; drawIdx < targetInfos.length; drawIdx++) {
    var drawInfo = targetInfos[drawIdx];
    var isThisLocked = isLocked && hud.lockedTargetRocket === drawInfo.rocket;
    var isThisCandidate = false;
    for (var candIdx = 0; candIdx < candidates.length; candIdx++) {
      if (candidates[candIdx].rocket === drawInfo.rocket) {
        isThisCandidate = true;
        break;
      }
    }

    if (drawInfo.isBehind || drawInfo.isOffScreen) {
      // Edge arrow for off-screen targets
      if (shouldShowTargetingHud) {
        var behindAngle = Math.atan2(
          drawInfo.projectedY - cy,
          drawInfo.projectedX - cx
        );
        var behindDist = Math.sqrt(
          (drawInfo.projectedX - cx) * (drawInfo.projectedX - cx) +
            (drawInfo.projectedY - cy) * (drawInfo.projectedY - cy)
        );
        drawEdgeArrow(
          ctx,
          cx,
          cy,
          behindAngle,
          14 * scale,
          drawInfo.color,
          behindDist
        );
      }
    } else {
      // Target is in front
      var lockImpulseScale = 1;
      var lockImpulseBrightness = 1;
      if (isThisLocked && hud.lockImpulseTime > 0) {
        var impulseElapsed = now - hud.lockImpulseTime;
        if (impulseElapsed < LOCK_IMPULSE_DURATION_MS) {
          if (impulseElapsed < LOCK_IMPULSE_PEAK_TIME_MS) {
            var peakT = impulseElapsed / LOCK_IMPULSE_PEAK_TIME_MS;
            lockImpulseScale = lerp(1, LOCK_IMPULSE_PEAK_SCALE, peakT);
            lockImpulseBrightness = lerp(1, 1.4, peakT);
          } else {
            var decayT =
              (impulseElapsed - LOCK_IMPULSE_PEAK_TIME_MS) /
              (LOCK_IMPULSE_DURATION_MS - LOCK_IMPULSE_PEAK_TIME_MS);
            lockImpulseScale = lerp(LOCK_IMPULSE_PEAK_SCALE, 1, decayT);
            lockImpulseBrightness = lerp(1.4, 1, decayT);
          }
        } else {
          hud.lockImpulseTime = 0;
        }
      }

      var drawBracketSize = drawInfo.bracketSize;
      if (isThisLocked) {
        var contractedSize = drawInfo.bracketSize * 0.85;
        if (now - hud.lockSnapTime < 80) {
          var snapT = (now - hud.lockSnapTime) / 80;
          contractedSize =
            hud.lockSnapFrom + (contractedSize - hud.lockSnapFrom) * snapT;
        }
        drawBracketSize = contractedSize;
      }

      var drawX = drawInfo.projectedX;
      var drawY = drawInfo.projectedY;
      if (isThisLocked) {
        drawX = Math.round(drawInfo.projectedX);
        drawY = Math.round(drawInfo.projectedY);
      }

      if (shouldShowTargetingHud) {
        drawTarget(
          ctx,
          drawX,
          drawY,
          drawInfo.color,
          isThisLocked,
          isThisCandidate,
          drawInfo.visible,
          scale,
          cx,
          cy,
          drawBracketSize,
          hud.lockRingAlpha,
          drawInfo.distanceFactor,
          lockImpulseScale,
          lockImpulseBrightness,
          hud.lockStrength,
          drawInfo.lockGlowColor,
          drawInfo.lockFillColor
        );

        if (!drawInfo.visible && !drawInfo.isBehind && !drawInfo.isOffScreen) {
          drawDashedLine(
            ctx,
            cx,
            cy,
            drawInfo.projectedX,
            drawInfo.projectedY,
            drawInfo.color
          );
        }
      }
    }
  }

  // Draw crosshair
  if (shouldShowCrosshair) {
    var crosshairOccluded = guidanceInfo ? !guidanceInfo.visible : false;
    drawCrosshair(
      ctx,
      cx,
      cy,
      48 * scale,
      crosshairOccluded,
      weaponCooldownState
    );
  }

  // Draw tick marks and guidance arrows
  if (shouldShowTargetingHud) {
    drawTickMarks(ctx, cx, cy, 'horizontal', 4, 20 * scale, 6 * scale);
    drawTickMarks(ctx, cx, cy, 'vertical', 4, 20 * scale, 6 * scale);
  }
}

function setElementClass(el, className) {
  el.className = className;
}

function setDevMode(enabled) {
  var statsPanel = document.getElementById('stats-panel');
  var optionsPanel = document.getElementById('options-panel');
  var gameHealth = document.getElementById('game-health');

  if (statsPanel) {
    statsPanel.style.display = enabled ? 'block' : 'none';
  }
  if (optionsPanel) {
    optionsPanel.style.display = enabled ? 'block' : 'none';
  }
  if (gameHealth) {
    gameHealth.style.display = enabled ? 'none' : 'block';
  }
}

var toastContainer = null;
var toastTimeout = null;

function clearToastContent() {
  while (toastContainer.firstChild) {
    toastContainer.removeChild(toastContainer.firstChild);
  }
}

function appendToastText(message) {
  var text = document.createElement('div');
  text.className = 'toast-message';
  text.textContent = String(message).toUpperCase();
  toastContainer.appendChild(text);
}

function appendToastLegend(legendItems) {
  if (!Array.isArray(legendItems) || legendItems.length === 0) {
    return;
  }

  var legend = document.createElement('div');
  legend.className = 'toast-legend';

  for (var i = 0; i < legendItems.length; i++) {
    var item = legendItems[i];
    var row = document.createElement('div');
    row.className = 'toast-legend-item';

    var swatch = document.createElement('span');
    swatch.className = 'toast-legend-swatch';
    swatch.style.backgroundColor = item.color;

    var label = document.createElement('span');
    label.className = 'toast-legend-label';
    label.textContent = String(item.label).toUpperCase();

    row.appendChild(swatch);
    row.appendChild(label);
    legend.appendChild(row);
  }

  toastContainer.appendChild(legend);
}

function showToast(message, options = {}) {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
  }
  if (!toastContainer) {
    return;
  }

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  clearToastContent();
  appendToastText(message);
  appendToastLegend(options.legend);
  toastContainer.classList.toggle('has-legend', Boolean(options.legend));
  toastContainer.classList.add('visible');

  toastTimeout = setTimeout(function () {
    toastContainer.classList.remove('visible');
  }, 3600);
}

function updateUI(
  playerPosition,
  chunkManager,
  physicsState = {},
  performanceStats = {},
  aiEnabled = true,
  aiPhysicsState = null,
  ai2PhysicsState = null,
  midLodSystem = null,
  scene = null
) {
  const health = Math.round(
    physicsState.health == null ? 100 : physicsState.health
  );
  const healthEl = document.getElementById('hud-health');
  healthEl.textContent = health + '%';

  if (health > 70) {
    setElementClass(healthEl, 'value-health');
  } else if (health > 30) {
    setElementClass(healthEl, 'value-health-warning');
  } else {
    setElementClass(healthEl, 'value-health-danger');
  }

  var gameHealthEl = document.getElementById('game-health');
  if (gameHealthEl) {
    gameHealthEl.textContent = 'HP ' + health;
    var healthClass =
      health > 70
        ? 'game-health-good'
        : health > 30
          ? 'game-health-warning'
          : 'game-health-danger';
    gameHealthEl.className = healthClass;
  }

  const aiHealth =
    aiEnabled && aiPhysicsState && aiPhysicsState.health != null
      ? Math.round(aiPhysicsState.health)
      : null;
  const aiHealthEl = document.getElementById('hud-ai');

  if (!aiEnabled) {
    aiHealthEl.textContent = 'OFF';
    setElementClass(aiHealthEl, 'value-ai-off');
  } else if (aiHealth == null) {
    aiHealthEl.textContent = 'RESPAWNING';
    setElementClass(aiHealthEl, 'value-ai-off');
  } else {
    aiHealthEl.textContent = aiHealth + '%';
    if (aiHealth > 70) {
      setElementClass(aiHealthEl, 'value-ai');
    } else if (aiHealth > 30) {
      setElementClass(aiHealthEl, 'value-ai-warning');
    } else {
      setElementClass(aiHealthEl, 'value-ai-danger');
    }
  }

  const ai2HealthEl = document.getElementById('hud-ai2');
  if (ai2HealthEl) {
    const ai2Health =
      aiEnabled && ai2PhysicsState && ai2PhysicsState.health != null
        ? Math.round(ai2PhysicsState.health)
        : null;

    if (!aiEnabled) {
      ai2HealthEl.textContent = 'OFF';
      setElementClass(ai2HealthEl, 'value-ai2-off');
    } else if (ai2Health == null) {
      ai2HealthEl.textContent = 'RESPAWNING';
      setElementClass(ai2HealthEl, 'value-ai2-off');
    } else {
      ai2HealthEl.textContent = ai2Health + '%';
      if (ai2Health > 70) {
        setElementClass(ai2HealthEl, 'value-ai2');
      } else if (ai2Health > 30) {
        setElementClass(ai2HealthEl, 'value-ai2-warning');
      } else {
        setElementClass(ai2HealthEl, 'value-ai2-danger');
      }
    }
  }

  document.getElementById('hud-position').textContent =
    Math.floor(playerPosition.x) +
    ', ' +
    Math.floor(playerPosition.y) +
    ', ' +
    Math.floor(playerPosition.z);

  document.getElementById('hud-loaded-chunks').textContent =
    chunkManager.stats.loadedChunks;
  document.getElementById('hud-meshed-chunks').textContent =
    chunkManager.stats.meshedChunks;

  let visibleChunks = 0;
  let totalChunks = 0;
  for (const [, mesh] of chunkManager.chunkMeshes) {
    totalChunks++;
    if (mesh.visible) visibleChunks++;
  }
  document.getElementById('hud-visible-chunks').textContent =
    visibleChunks + '/' + totalChunks;

  document.getElementById('hud-projectiles').textContent =
    performanceStats.activeProjectiles || 0;
  document.getElementById('hud-particles').textContent =
    performanceStats.particleCount || 0;
  document.getElementById('hud-raycasts').textContent =
    performanceStats.raycastsPerFrame || 0;
  document.getElementById('hud-voxel-edits').textContent =
    performanceStats.voxelEditsPerFrame || 0;
  document.getElementById('hud-dirty-chunks').textContent =
    performanceStats.dirtyChunks || 0;
  document.getElementById('hud-remeshed').textContent =
    performanceStats.remeshedChunksPerFrame || 0;

  // LOD loading status
  if (midLodSystem) {
    let midPercent = Math.floor(
      (midLodSystem.loadedChunks / midLodSystem.totalChunks) * 100
    );
    if (midLodSystem.priorityTotalChunks > 0) {
      midPercent = Math.floor(
        (midLodSystem.priorityChunks / midLodSystem.priorityTotalChunks) * 100
      );
    }
    const midEl = document.getElementById('hud-mid-lod');
    midEl.textContent = midPercent + '%';
    if (midPercent >= 100) {
      midEl.style.color = '#fff0a8';
    } else {
      midEl.style.color = '#7cdfff';
    }
  }

  if (scene) {
    const farShellGroup = scene.getObjectByName('farShellSystem');
    if (farShellGroup && farShellGroup.userData.totalShells > 0) {
      const farPercent = Math.floor(
        (farShellGroup.userData.loadedShells /
          farShellGroup.userData.totalShells) *
          100
      );
      const farEl = document.getElementById('hud-far-shell');
      farEl.textContent = farPercent + '%';
      if (farPercent >= 100) {
        farEl.style.color = '#fff0a8';
      } else {
        farEl.style.color = '#7cdfff';
      }
    }
  }
}

function updateOptions(
  chunkManager = null,
  cameraMode = 'third-person',
  soundtrackState = null,
  audioState = null,
  weaponState = null,
  aiEnabled = false,
  hudEnabled = true,
  crosshairEnabled = true
) {
  const cameraEl = document.getElementById('hud-camera');
  cameraEl.textContent = cameraMode;

  const aiToggleEl = document.getElementById('hud-ai-toggle');
  aiToggleEl.textContent = aiEnabled ? 'ON' : 'OFF';
  setElementClass(aiToggleEl, aiEnabled ? 'value-on' : 'value-off');

  const hudToggleEl = document.getElementById('hud-hud-toggle');
  hudToggleEl.textContent = hudEnabled ? 'ON' : 'OFF';
  setElementClass(hudToggleEl, hudEnabled ? 'value-on' : 'value-off');

  const crosshairRow = document.getElementById('hud-crosshair-row');
  const crosshairToggleEl = document.getElementById('hud-crosshair-toggle');
  if (hudEnabled) {
    crosshairRow.style.display = 'none';
  } else {
    crosshairRow.style.display = 'block';
    crosshairToggleEl.textContent = crosshairEnabled ? 'ON' : 'OFF';
    setElementClass(
      crosshairToggleEl,
      crosshairEnabled ? 'value-on' : 'value-off'
    );
  }

  const weaponRow = document.getElementById('hud-weapon-row');
  const weaponEl = document.getElementById('hud-weapon');
  if (weaponState) {
    weaponRow.style.display = 'block';
    weaponEl.textContent = weaponState.label;
  } else {
    weaponRow.style.display = 'none';
  }

  const musicRow = document.getElementById('hud-music-row');
  const musicEl = document.getElementById('hud-music');
  const musicDetailEl = document.getElementById('hud-music-detail');
  if (soundtrackState) {
    musicRow.style.display = 'block';
    const musicOnMatch = soundtrackState.text.match(/^(.+?)\s+ON\s+\((.+)\)$/);
    const musicOffMatch = soundtrackState.text.match(/^(OFF)\s+\((.+)\)$/);
    if (musicOnMatch) {
      musicEl.textContent = musicOnMatch[1] + ' ON';
      setElementClass(musicEl, 'value-on');
      musicDetailEl.textContent = '(' + musicOnMatch[2] + ')';
    } else if (musicOffMatch) {
      musicEl.textContent = 'OFF';
      setElementClass(musicEl, 'value-off');
      musicDetailEl.textContent = '(' + musicOffMatch[2] + ')';
    } else {
      musicEl.textContent = soundtrackState.text;
      setElementClass(musicEl, '');
      musicDetailEl.textContent = '';
    }
  } else {
    musicRow.style.display = 'none';
  }

  const sfxRow = document.getElementById('hud-sfx-row');
  const sfxEl = document.getElementById('hud-sfx');
  const sfxDetailEl = document.getElementById('hud-sfx-detail');
  if (audioState) {
    sfxRow.style.display = 'block';
    const audioOnMatch = audioState.text.match(/^(ON)\s+\((.+)\)$/);
    const audioOffMatch = audioState.text.match(/^(OFF)\s+\((.+)\)$/);
    if (audioOnMatch) {
      sfxEl.textContent = 'ON';
      setElementClass(sfxEl, 'value-on');
      sfxDetailEl.textContent = '(' + audioOnMatch[2] + ')';
    } else if (audioOffMatch) {
      sfxEl.textContent = 'OFF';
      setElementClass(sfxEl, 'value-off');
      sfxDetailEl.textContent = '(' + audioOffMatch[2] + ')';
    } else {
      sfxEl.textContent = audioState.text;
      setElementClass(sfxEl, '');
      sfxDetailEl.textContent = '';
    }
  } else {
    sfxRow.style.display = 'none';
  }

  const boundariesRow = document.getElementById('hud-boundaries-row');
  const boundariesEl = document.getElementById('hud-boundaries');
  if (chunkManager) {
    boundariesRow.style.display = 'block';
    boundariesEl.textContent = chunkManager.showChunkBoundaries ? 'ON' : 'OFF';
    setElementClass(
      boundariesEl,
      chunkManager.showChunkBoundaries ? 'value-on' : 'value-off'
    );
  } else {
    boundariesRow.style.display = 'none';
  }
}

export {
  addStats,
  createUI,
  updateUI,
  updateOptions,
  updateSpatialLocatorHud,
  setDevMode,
  showToast,
};
