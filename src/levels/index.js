import { level01Current } from './level-01-current.js';
import { level02LargeCavern } from './level-02-large-cavern.js';
import { level03SkyVault } from './level-03-sky-vault.js';

export var LEVELS = [level01Current, level02LargeCavern, level03SkyVault];

export var ACTIVE_LEVEL_ID = 'level-03-sky-vault'; //'level-01-current';

export function getLevelById(id) {
  for (var i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].id === id) {
      return LEVELS[i];
    }
  }
  return level01Current;
}

export function getActiveLevel() {
  return getLevelById(ACTIVE_LEVEL_ID);
}
