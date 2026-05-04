import { LEVELS, getLevelById } from './levels/index.js';
import {
  formatGameConfigWarnings,
  normalizeGameConfig,
  restartGame,
} from './game-config.js';
import {
  getConnectedGamepad,
  getGamepadProfile,
  readStandardGamepad,
} from './gamepad.js';

function formatLevelId(levelId) {
  var match = String(levelId || '').match(/^level(\d+)$/i);

  if (match) {
    return 'LEVEL ' + match[1];
  }

  return String(levelId || '').toUpperCase();
}

function createLevelLabel(level) {
  if (!level) {
    return '';
  }

  return (
    '<span class="mission-id">' +
    formatLevelId(level.id) +
    '</span><span class="mission-name">' +
    level.name +
    '</span>'
  );
}

function formatPassiveSeedMarkup(levelId, seed) {
  var normalizedLevelId = String(levelId || '-').toUpperCase();
  var normalizedSeed = String(seed || '-').toLowerCase();

  return (
    '<span class="current-level-id">' +
    normalizedLevelId +
    '</span><span class="current-separator">·</span><span class="current-seed">seed ' +
    normalizedSeed +
    '</span>'
  );
}

export function createGameMenu() {
  var LEVEL_SLIDE_DURATION_MS = 320;
  var menus = document.getElementById('game-menu-overlay');
  var title = document.getElementById('game-menu-title');
  var subtitle = document.getElementById('game-menu-subtitle');
  var levelSelect = document.getElementById('menu-level');
  var levelDropdownTrigger = document.getElementById('level-dropdown-trigger');
  var levelCarouselViewport = document.getElementById(
    'level-carousel-viewport'
  );
  var levelDropdownOptions = document.getElementById('level-dropdown-options');
  var prevLevelBtn = document.getElementById('menu-prev-level');
  var nextLevelBtn = document.getElementById('menu-next-level');
  var resumeHint = document.getElementById('resume-hint');
  var seedInput = document.getElementById('menu-seed');
  var previewLevel = document.getElementById('menu-preview-level');
  var previewSeed = document.getElementById('menu-preview-seed');
  var warning = document.getElementById('game-menu-warning');
  var clearTerrainCacheInput = document.getElementById(
    'menu-clear-terrain-cache'
  );
  var menuForm = document.getElementById('game-menu-form');
  var restartCurrentButton = document.getElementById('menu-restart-current');
  var resumeButton = document.getElementById('menu-resume');

  // New elements
  var mainView = document.getElementById('menu-main-view');
  var helpView = document.getElementById('menu-help-view');
  var summaryText = document.getElementById('menu-summary-text');
  var startLaunchBtn = document.getElementById('menu-start-launch');
  var resumeActionBtn = document.getElementById('menu-resume-action');
  var restartActionBtn = document.getElementById('menu-restart-action');
  var changeMissionBtn = document.getElementById('menu-change-mission');
  var helpActionBtn = document.getElementById('menu-help-action');
  var helpBackBtn = document.getElementById('menu-help-back');
  var menuHintsMain = document.getElementById('menu-hints-main');
  var menuHintsConfig = document.getElementById('menu-hints-config');

  var mode = 'start';
  var currentConfig = normalizeGameConfig();
  var currentWarnings = [];
  var resumeHandler = null;
  var missionPickerExpanded = false;
  var launchTransitionTimer = null;
  var displayedLevel = null;
  var outgoingLevel = null;
  var incomingLevel = null;
  var slideDirection = null;
  var isAnimatingLevel = false;
  var levelSlideTimer = null;
  var levelSlideFrameA = null;
  var levelSlideFrameB = null;
  var prefersReducedMotionQuery = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  );
  var previousGamepadMenuState = {
    up: false,
    down: false,
    left: false,
    right: false,
    select: false,
    back: false,
  };

  function clearLevelSlideFrames() {
    if (levelSlideFrameA) {
      window.cancelAnimationFrame(levelSlideFrameA);
      levelSlideFrameA = null;
    }

    if (levelSlideFrameB) {
      window.cancelAnimationFrame(levelSlideFrameB);
      levelSlideFrameB = null;
    }
  }

  function renderLevelSlide(level, className) {
    if (!level) {
      return '';
    }

    return (
      '<div class="level-slide ' +
      className +
      '">' +
      createLevelLabel(level) +
      '</div>'
    );
  }

  function renderLevelCarousel() {
    if (!levelCarouselViewport) {
      return;
    }

    levelCarouselViewport.classList.remove('is-animating');
    levelCarouselViewport.classList.remove('is-next');
    levelCarouselViewport.classList.remove('is-prev');
    levelCarouselViewport.classList.remove('is-sliding');

    if (isAnimatingLevel && outgoingLevel && incomingLevel && slideDirection) {
      levelCarouselViewport.classList.add('is-animating');
      levelCarouselViewport.classList.add(
        slideDirection === 'next' ? 'is-next' : 'is-prev'
      );
      levelCarouselViewport.innerHTML =
        renderLevelSlide(outgoingLevel, 'level-slide-outgoing') +
        renderLevelSlide(incomingLevel, 'level-slide-incoming');
      return;
    }

    levelCarouselViewport.innerHTML = displayedLevel
      ? renderLevelSlide(displayedLevel, 'level-slide-current')
      : '';
  }

  function finishLevelSlide(nextLevel) {
    displayedLevel = nextLevel;
    outgoingLevel = null;
    incomingLevel = null;
    slideDirection = null;
    isAnimatingLevel = false;
    if (levelSlideTimer) {
      window.clearTimeout(levelSlideTimer);
      levelSlideTimer = null;
    }
    clearLevelSlideFrames();
    renderLevelCarousel();
  }

  function startLevelSlide(currentLevel, nextLevel, direction) {
    clearLevelSlideFrames();

    if (!nextLevel || !currentLevel) {
      displayedLevel = nextLevel || currentLevel;
      renderLevelCarousel();
      return;
    }

    if (prefersReducedMotionQuery.matches) {
      displayedLevel = nextLevel;
      renderLevelCarousel();
      return;
    }

    isAnimatingLevel = true;
    outgoingLevel = currentLevel;
    incomingLevel = nextLevel;
    slideDirection = direction;
    renderLevelCarousel();

    if (levelSlideTimer) {
      window.clearTimeout(levelSlideTimer);
    }

    levelSlideFrameA = window.requestAnimationFrame(function () {
      levelSlideFrameA = null;
      levelSlideFrameB = window.requestAnimationFrame(function () {
        levelSlideFrameB = null;
        if (levelCarouselViewport && isAnimatingLevel) {
          levelCarouselViewport.classList.add('is-sliding');
        }
      });
    });

    levelSlideTimer = window.setTimeout(function () {
      finishLevelSlide(nextLevel);
    }, LEVEL_SLIDE_DURATION_MS);
  }

  function updateCustomDropdown(value) {
    var selectedLevel = getLevelById(value);
    if (!displayedLevel && selectedLevel) {
      displayedLevel = selectedLevel;
    }

    if (!isAnimatingLevel) {
      displayedLevel = selectedLevel || displayedLevel;
    }

    if (levelCarouselViewport) {
      if (!isAnimatingLevel) {
        renderLevelCarousel();
      }
    } else if (levelDropdownTrigger) {
      levelDropdownTrigger.innerHTML = selectedLevel
        ? createLevelLabel(selectedLevel)
        : 'Select Level';
    }

    var options = levelDropdownOptions.querySelectorAll('.dropdown-option');
    options.forEach(function (opt) {
      if (opt.getAttribute('data-value') === value) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });
  }

  function cycleLevel(dir) {
    if (isAnimatingLevel) {
      return;
    }

    var currentIndex = -1;
    for (var j = 0; j < LEVELS.length; j++) {
      if (LEVELS[j].id === levelSelect.value) {
        currentIndex = j;
        break;
      }
    }

    var currentLevel =
      currentIndex >= 0 ? LEVELS[currentIndex] : displayedLevel;
    var nextIndex = (currentIndex + dir + LEVELS.length) % LEVELS.length;
    var nextLevel = LEVELS[nextIndex];
    levelSelect.value = nextLevel.id;
    startLevelSlide(currentLevel, nextLevel, dir > 0 ? 'next' : 'prev');
    updatePreview();
  }

  if (prevLevelBtn) {
    prevLevelBtn.addEventListener('click', function () {
      cycleLevel(-1);
    });
  }

  if (nextLevelBtn) {
    nextLevelBtn.addEventListener('click', function () {
      cycleLevel(1);
    });
  }

  if (levelDropdownTrigger) {
    levelDropdownTrigger.addEventListener('click', function () {
      cycleLevel(1);
    });
  }

  for (var i = 0; i < LEVELS.length; i++) {
    var level = LEVELS[i];
    // Populate hidden select for compatibility
    var option = document.createElement('option');
    option.value = level.id;
    option.textContent = createLevelLabel(level);
    levelSelect.appendChild(option);

    // Populate custom dropdown
    var div = document.createElement('div');
    div.className = 'dropdown-option';
    div.setAttribute('data-value', level.id);
    div.textContent = createLevelLabel(level);
    div.addEventListener('click', function (e) {
      var val = e.target.getAttribute('data-value');
      levelSelect.value = val;
      updateCustomDropdown(val);
      levelDropdownOptions.classList.remove('show');
      levelDropdownTrigger.classList.remove('active');
      updatePreview();
    });
    levelDropdownOptions.appendChild(div);
  }

  if (levelDropdownTrigger) {
    levelDropdownTrigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var isShowing = levelDropdownOptions.classList.toggle('show');
      levelDropdownTrigger.classList.toggle('active', isShowing);
    });
  }

  document.addEventListener('click', function () {
    if (levelDropdownOptions) {
      levelDropdownOptions.classList.remove('show');
    }
    if (levelDropdownTrigger) {
      levelDropdownTrigger.classList.remove('active');
    }
  });

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

    var levelName = selectedLevel ? selectedLevel.id : selectedConfig.levelId;
    previewLevel.textContent = levelName;
    previewSeed.textContent = selectedConfig.seed;

    if (summaryText) {
      summaryText.innerHTML = formatPassiveSeedMarkup(
        levelName,
        selectedConfig.seed
      );
    }

    updateCustomDropdown(selectedConfig.levelId);
  }

  function updateRestartActionLabel() {
    if (!restartActionBtn) {
      return;
    }

    restartActionBtn.textContent =
      mode === 'pause' && missionPickerExpanded
        ? 'LOAD SELECTED'
        : 'RESTART CURRENT';
  }

  function setFormConfig(config) {
    var normalized = normalizeGameConfig(config);

    levelSelect.value = normalized.levelId;
    seedInput.value = normalized.seed;
    clearTerrainCacheInput.checked = Boolean(
      config && config.clearTerrainCache === true
    );
    displayedLevel = getLevelById(normalized.levelId);
    outgoingLevel = null;
    incomingLevel = null;
    slideDirection = null;
    isAnimatingLevel = false;
    if (levelSlideTimer) {
      window.clearTimeout(levelSlideTimer);
      levelSlideTimer = null;
    }
    clearLevelSlideFrames();
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

  function setTitle(newTitle, newSubtitle) {
    if (title) {
      if (newTitle === 'ROCKET3D') {
        title.innerHTML =
          '<span class="logo-main">ROCKET</span><span class="logo-mark">3D</span>';
      } else {
        title.textContent = newTitle;
      }
      title.setAttribute('data-text', newTitle);
    }
    if (subtitle) subtitle.textContent = newSubtitle;
  }

  function setMenuViewClass(viewName) {
    menus.classList.remove('main-view');
    menus.classList.remove('help-view');
    menus.classList.add(viewName);
  }

  function resetMainActiveItem() {
    var firstMain = mainView.querySelector(
      '.menu-list-item:not([style*="display: none"])'
    );
    if (!firstMain) return;

    mainView.querySelectorAll('.menu-list-item').forEach(function (el) {
      el.classList.remove('active');
    });
    firstMain.classList.add('active');
  }

  function playViewAnimation(element, className) {
    if (!element) {
      return;
    }

    element.classList.remove('menu-view-enter-forward');
    element.classList.remove('menu-view-enter-back');
    void element.offsetHeight;
    element.classList.add(className);
  }

  function switchToMainView(transitionDirection) {
    setMenuViewClass('main-view');
    if (mode === 'pause') {
      setTitle('PAUSED', 'GAME PAUSED');
    } else {
      setTitle('ROCKET3D', 'VOXEL CAVE FLIGHT');
    }
    mainView.style.display = 'block';
    if (helpView) helpView.style.display = 'none';
    if (menuHintsMain) {
      menuHintsMain.style.display = missionPickerExpanded ? 'none' : 'flex';
    }
    if (menuHintsConfig) {
      menuHintsConfig.style.display = missionPickerExpanded ? 'flex' : 'none';
    }
    if (transitionDirection === 'back') {
      playViewAnimation(mainView, 'menu-view-enter-back');
    }
  }

  function switchToHelpView() {
    setMenuViewClass('help-view');
    if (mode === 'pause') {
      setTitle('PAUSED', 'GAME PAUSED');
    } else {
      setTitle('ROCKET3D', 'VOXEL CAVE FLIGHT');
    }
    mainView.style.display = 'none';
    if (helpView) helpView.style.display = 'flex';
    if (menuHintsMain) menuHintsMain.style.display = 'flex';
    if (menuHintsConfig) menuHintsConfig.style.display = 'none';
    playViewAnimation(helpView, 'menu-view-enter-forward');
    updateActiveItem(
      helpView.querySelector('.game-menu-actions-list'),
      helpView.querySelectorAll('.menu-list-item'),
      helpBackBtn
    );
  }

  function updateActiveItem(container, items, activeItem) {
    items.forEach(function (item) {
      item.classList.remove('active');
    });
    activeItem.classList.add('active');
  }

  function isElementVisible(element) {
    return Boolean(
      element &&
      element.style.display !== 'none' &&
      element.getClientRects().length > 0
    );
  }

  function getActiveMenuContainer() {
    if (isElementVisible(mainView)) {
      return mainView.querySelector('.game-menu-list');
    }

    if (helpView && isElementVisible(helpView)) {
      return helpView.querySelector('.game-menu-actions-list');
    }

    return null;
  }

  function getVisibleMenuItems(container) {
    var visibleItems = [];

    if (!container) {
      return visibleItems;
    }

    container.querySelectorAll('.menu-list-item').forEach(function (item) {
      if (isElementVisible(item)) {
        visibleItems.push(item);
      }
    });

    return visibleItems;
  }

  function moveActiveItem(direction) {
    var container = getActiveMenuContainer();
    var items = getVisibleMenuItems(container);
    var activeIndex = 0;

    if (items.length <= 0) {
      return;
    }

    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains('active')) {
        activeIndex = i;
        break;
      }
    }

    activeIndex = (activeIndex + direction + items.length) % items.length;
    updateActiveItem(container, items, items[activeIndex]);
  }

  function activateCurrentItem() {
    var container = getActiveMenuContainer();
    var items = getVisibleMenuItems(container);
    var activeItem = null;

    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains('active')) {
        activeItem = items[i];
        break;
      }
    }

    if (!activeItem && items.length > 0) {
      activeItem = items[0];
    }

    if (activeItem) {
      activeItem.click();
    }
  }

  function goBack() {
    if (mainView.style.display === 'none') {
      switchToMainView('back');
      resetMainActiveItem();
      return;
    }

    if (missionPickerExpanded) {
      setMissionPickerExpanded(false);
      return;
    }

    if (mode === 'pause') {
      handleResume();
    }
  }

  function handleMenuInput(action) {
    if (menus.style.display === 'none') {
      return false;
    }

    if (action === 'up') {
      moveActiveItem(-1);
      return true;
    }

    if (action === 'down') {
      moveActiveItem(1);
      return true;
    }

    if (action === 'left') {
      if (missionPickerExpanded) {
        cycleLevel(-1);
      }
      return true;
    }

    if (action === 'right') {
      if (missionPickerExpanded) {
        cycleLevel(1);
      }
      return true;
    }

    if (action === 'select') {
      activateCurrentItem();
      return true;
    }

    if (action === 'back') {
      goBack();
      return true;
    }

    return false;
  }

  function setMissionPickerExpanded(expanded) {
    missionPickerExpanded = expanded;
    menuForm.classList.toggle('is-expanded', expanded);
    changeMissionBtn.classList.toggle('expanded', expanded);
    updateRestartActionLabel();
    if (menuHintsMain) {
      menuHintsMain.style.display = expanded ? 'none' : 'flex';
    }
    if (menuHintsConfig) {
      menuHintsConfig.style.display = expanded ? 'flex' : 'none';
    }
  }

  function setupTactileMenu(containerSelector) {
    var container = document.querySelector(containerSelector);
    if (!container) return;
    var items = container.querySelectorAll('.menu-list-item');
    items.forEach(function (item) {
      item.addEventListener('mouseenter', function () {
        updateActiveItem(container, items, item);
      });
    });
  }

  function readGamepadMenuState() {
    var gamepad = getConnectedGamepad();

    if (!gamepad || getGamepadProfile(gamepad) !== 'standard') {
      return {
        up: false,
        down: false,
        left: false,
        right: false,
        select: false,
        back: false,
      };
    }

    var s = readStandardGamepad(gamepad);

    return {
      up: s.up,
      down: s.down,
      left: s.left,
      right: s.right,
      select: s.confirm,
      back: s.back,
    };
  }

  function pollMenuGamepad() {
    var state = readGamepadMenuState();

    if (menus.style.display !== 'none') {
      if (state.up && !previousGamepadMenuState.up) handleMenuInput('up');
      if (state.down && !previousGamepadMenuState.down) handleMenuInput('down');
      if (state.left && !previousGamepadMenuState.left) {
        handleMenuInput('left');
      }
      if (state.right && !previousGamepadMenuState.right) {
        handleMenuInput('right');
      }
      if (state.select && !previousGamepadMenuState.select) {
        handleMenuInput('select');
      }
      if (state.back && !previousGamepadMenuState.back) handleMenuInput('back');
    }

    previousGamepadMenuState = state;
    window.requestAnimationFrame(pollMenuGamepad);
  }

  function handleMenuKeydown(event) {
    var handled = false;

    if (menus.style.display === 'none' || event.altKey || event.repeat) {
      return;
    }

    if (event.target === seedInput && event.code !== 'Escape') {
      return;
    }

    switch (event.code) {
      case 'ArrowUp':
        handled = handleMenuInput('up');
        break;

      case 'ArrowDown':
        handled = handleMenuInput('down');
        break;

      case 'ArrowLeft':
        handled = handleMenuInput('left');
        break;

      case 'ArrowRight':
        handled = handleMenuInput('right');
        break;

      case 'Enter':
      case 'NumpadEnter':
        handled = handleMenuInput('select');
        break;

      case 'Escape':
        handled = handleMenuInput('back');
        break;
    }

    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function showMenu(nextMode, config, warnings) {
    if (launchTransitionTimer) {
      window.clearTimeout(launchTransitionTimer);
      launchTransitionTimer = null;
    }
    mode = nextMode;
    currentWarnings = Array.isArray(warnings) ? warnings : [];
    currentConfig = {
      ...normalizeGameConfig(config),
      clearTerrainCache: config && config.clearTerrainCache === true,
    };
    setFormConfig(currentConfig);
    updateWarning();
    setMissionPickerExpanded(false);
    switchToMainView();

    if (mode === 'start') {
      document.body.classList.add('is-start-screen');
      menus.classList.add('start-mode');
      menus.classList.remove('pause-mode');
    } else {
      document.body.classList.remove('is-start-screen');
      menus.classList.remove('start-mode');
      menus.classList.add('pause-mode');
    }

    if (mode === 'pause') {
      if (resumeHint) resumeHint.style.display = 'flex';
      startLaunchBtn.style.display = 'none';
      resumeActionBtn.style.display = 'flex';
      restartActionBtn.style.display = 'flex';
    } else {
      if (resumeHint) resumeHint.style.display = 'none';
      startLaunchBtn.style.display = 'flex';
      resumeActionBtn.style.display = 'none';
      restartActionBtn.style.display = 'none';
    }

    updateRestartActionLabel();
    resetMainActiveItem();
    menus.style.display = 'flex';
  }

  function closeMenu() {
    menus.style.display = 'none';
    document.body.classList.remove('is-start-screen');
    menus.classList.remove('start-mode');
    menus.classList.remove('pause-mode');
    menus.classList.remove('is-launching');
    menus.classList.remove('main-view');
    menus.classList.remove('help-view');
  }

  levelSelect.addEventListener('change', updatePreview);
  seedInput.addEventListener('input', updatePreview);

  changeMissionBtn.addEventListener('click', function () {
    setMissionPickerExpanded(!missionPickerExpanded);
  });

  if (helpActionBtn) {
    helpActionBtn.addEventListener('click', switchToHelpView);
  }

  if (helpBackBtn) {
    helpBackBtn.addEventListener('click', function () {
      switchToMainView('back');
    });
  }

  function restartWithMenuTransition(config) {
    if (launchTransitionTimer) {
      return;
    }

    menus.classList.add('is-launching');
    launchTransitionTimer = window.setTimeout(function () {
      restartGame(config);
    }, 780);
  }

  startLaunchBtn.addEventListener('click', function () {
    restartWithMenuTransition(getSelectedConfig());
  });

  restartActionBtn.addEventListener('click', function () {
    restartWithMenuTransition(
      missionPickerExpanded ? getSelectedConfig() : getCurrentRestartConfig()
    );
  });

  function handleResume() {
    if (mode === 'pause') {
      if (typeof resumeHandler === 'function') {
        resumeHandler();
      } else {
        closeMenu();
      }
    }
  }

  resumeActionBtn.addEventListener('click', handleResume);
  resumeButton.addEventListener('click', handleResume);

  menuForm.addEventListener('submit', function (event) {
    event.preventDefault();
    restartWithMenuTransition(getSelectedConfig());
  });

  // Keep for compatibility
  restartCurrentButton.addEventListener('click', function () {
    restartGame(getCurrentRestartConfig());
  });

  setupTactileMenu('.game-menu-list');
  setupTactileMenu('.game-menu-actions-list');
  setupTactileMenu('#menu-help-view');
  document.addEventListener('keydown', handleMenuKeydown, true);
  window.requestAnimationFrame(pollMenuGamepad);

  closeMenu();

  return {
    showStartMenu: function (config, warnings) {
      showMenu('start', config, warnings);
    },
    openPauseMenu: function (config, warnings) {
      showMenu('pause', config, warnings);
    },
    openHelpMenu: function (config, warnings) {
      showMenu('pause', config, warnings);
      switchToHelpView();
    },
    close: closeMenu,
    isOpen: function () {
      return menus.style.display !== 'none';
    },
    isSubmenuOpen: function () {
      return mainView.style.display === 'none';
    },
    backToMain: switchToMainView,
    setResumeHandler: function (handler) {
      resumeHandler = handler;
    },
  };
}
