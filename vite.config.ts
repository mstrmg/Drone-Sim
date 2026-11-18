import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /Drone-Sim/).
export default defineConfig({
  base: './',
  // Textures are inlined as data URLs so the build stays self-contained (no runtime fetches).
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, assetsInlineLimit: 2_000_000 },
});
