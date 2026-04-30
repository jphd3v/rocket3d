import { readdirSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const MUSIC_TRACKS_MODULE_ID = 'virtual:music-tracks';
const RESOLVED_MUSIC_TRACKS_MODULE_ID = `\0${MUSIC_TRACKS_MODULE_ID}`;
const SUPPORTED_MUSIC_EXTENSIONS = new Set(['.xm', '.mod', '.s3m', '.it']);

function getMusicTracks() {
  const musicDir = path.resolve(process.cwd(), 'public/music');

  return readdirSync(musicDir, { withFileTypes: true })
    .filter(function (entry) {
      return (
        entry.isFile() &&
        SUPPORTED_MUSIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      );
    })
    .map(function (entry) {
      return {
        label: entry.name,
        url: `/music/${encodeURIComponent(entry.name)}`,
      };
    })
    .sort(function (a, b) {
      return a.label.localeCompare(b.label);
    });
}

function musicTracksPlugin() {
  const musicDir = path.resolve(process.cwd(), 'public/music');

  return {
    name: 'music-tracks-plugin',
    resolveId(id) {
      if (id === MUSIC_TRACKS_MODULE_ID) {
        return RESOLVED_MUSIC_TRACKS_MODULE_ID;
      }

      return null;
    },
    load(id) {
      if (id !== RESOLVED_MUSIC_TRACKS_MODULE_ID) {
        return null;
      }

      return `export const soundtrackTracks = ${JSON.stringify(getMusicTracks())};`;
    },
    handleHotUpdate(context) {
      if (!context.file.startsWith(musicDir + path.sep)) {
        return;
      }

      const module = context.server.moduleGraph.getModuleById(
        RESOLVED_MUSIC_TRACKS_MODULE_ID
      );

      if (module) {
        context.server.moduleGraph.invalidateModule(module);
      }

      context.server.ws.send({ type: 'full-reload' });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [musicTracksPlugin()],
  server: {
    host: 'localhost',
    port: 3000,
  },
  optimizeDeps: {
    exclude: ['chiptune3', 'chiptune3/chiptune3.js'],
  },
  build: {
    outDir: 'dist',
  },
});
