import { LEVELS, getLevelById } from './levels/index.js';
import {
  createRandomGameSeed,
  formatGameConfigWarnings,
  normalizeGameConfig,
  restartGame,
} from './game-config.js';

function createLevelLabel(level) {
  if (!level) {
    return '';
  }

  return level.id + ' - ' + level.name;
}

export function createGameMenu() {
  var menus = document.getElementById('game-menu-overlay');
  var title = document.getElementById('game-menu-title');
  var subtitle = document.getElementById('game-menu-subtitle');
  var levelSelect = document.getElementById('menu-level');
  var seedInput = document.getElementById('menu-seed');
  var previewLevel = document.getElementById('menu-preview-level');
  var previewSeed = document.getElementById('menu-preview-seed');
  var warning = document.getElementById('game-menu-warning');
  var clearTerrainCacheInput = document.getElementById(
    'menu-clear-terrain-cache'
  );
  var menuForm = document.getElementById('game-menu-form');
  var randomizeButton = document.getElementById('menu-randomize');
  var restartCurrentButton = document.getElementById('menu-restart-current');
  var applyButton = document.getElementById('menu-apply');
  var resumeButton = document.getElementById('menu-resume');
  var mode = 'start';
  var currentConfig = normalizeGameConfig();
  var currentWarnings = [];
  var resumeHandler = null;
  var i;

  for (i = 0; i < LEVELS.length; i++) {
    var level = LEVELS[i];
    var option = document.createElement('option');
    option.value = level.id;
    option.textContent = createLevelLabel(level);
    levelSelect.appendChild(option);
  }

  function getSelectedConfig() {
    return {
      ...normalizeGameConfig({
        levelId: levelSelect.value,
        seed: seedInput.value,
      }),
      clearTerrainCache: clearTerrainCacheInput.checked,
    };
  }

  function getCurrentRestartConfig() {
    return {
      ...normalizeGameConfig(currentConfig),
      clearTerrainCache: clearTerrainCacheInput.checked,
    };
  }

  function updatePreview() {
    var selectedConfig = getSelectedConfig();
    var selectedLevel = getLevelById(selectedConfig.levelId);

    previewLevel.textContent = selectedLevel
      ? selectedLevel.id
      : selectedConfig.levelId;
    previewSeed.textContent = selectedConfig.seed;
  }

  function setFormConfig(config) {
    var normalized = normalizeGameConfig(config);

    levelSelect.value = normalized.levelId;
    seedInput.value = normalized.seed;
    clearTerrainCacheInput.checked = Boolean(
      config && config.clearTerrainCache === true
    );
    updatePreview();
  }

  function updateWarning() {
    var warningText = formatGameConfigWarnings(currentWarnings);

    if (!warning) {
      return;
    }

    warning.textContent = warningText;
    warning.style.display = warningText ? 'block' : 'none';
  }

  function showMenu(nextMode, config, warnings) {
    mode = nextMode;
    currentWarnings = Array.isArray(warnings) ? warnings : [];
    currentConfig = {
      ...normalizeGameConfig(config),
      clearTerrainCache: config && config.clearTerrainCache === true,
    };
    setFormConfig(currentConfig);
    updateWarning();

    if (mode === 'pause') {
      title.textContent = 'Paused';
      subtitle.textContent = 'Resume or restart with a new level and seed';
      applyButton.textContent = 'Load Selected';
      resumeButton.style.display = 'inline-flex';
      restartCurrentButton.style.display = 'inline-flex';
    } else {
      title.textContent = 'Mission Setup';
      subtitle.textContent = 'Select a level and seed to launch';
      applyButton.textContent = 'Start Game';
      resumeButton.style.display = 'none';
      restartCurrentButton.style.display = 'none';
    }

    menus.style.display = 'flex';
  }

  function closeMenu() {
    menus.style.display = 'none';
  }

  levelSelect.addEventListener('change', updatePreview);
  seedInput.addEventListener('input', updatePreview);

  randomizeButton.addEventListener('click', function () {
    seedInput.value = createRandomGameSeed();
    updatePreview();
    seedInput.focus();
    seedInput.select();
  });

  restartCurrentButton.addEventListener('click', function () {
    restartGame(getCurrentRestartConfig());
  });

  resumeButton.addEventListener('click', function () {
    if (mode === 'pause') {
      if (typeof resumeHandler === 'function') {
        resumeHandler();
      } else {
        closeMenu();
      }
    }
  });

  menuForm.addEventListener('submit', function (event) {
    event.preventDefault();
    restartGame(getSelectedConfig());
  });

  closeMenu();

  return {
    showStartMenu: function (config, warnings) {
      showMenu('start', config, warnings);
    },
    openPauseMenu: function (config, warnings) {
      showMenu('pause', config, warnings);
    },
    close: closeMenu,
    isOpen: function () {
      return menus.style.display !== 'none';
    },
    setResumeHandler: function (handler) {
      resumeHandler = handler;
    },
  };
}
