export function createSeededRandom(seedString) {
  var seed = hashString(seedString);
  function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    float: next,
    range: function (min, max) {
      return min + next() * (max - min);
    },
    int: function (min, max) {
      return Math.floor(this.range(min, max + 1));
    },
    pick: function (items) {
      return items[this.int(0, items.length - 1)];
    },
  };
}

function hashString(str) {
  var h = 1779033703 ^ str.length;
  for (var i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
