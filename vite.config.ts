import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages /Drone-Sim/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
});
