import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps the bundle working from any subpath, which is what
  // GitHub Pages project sites need (https://user.github.io/planetarium/).
  base: './',
  server: { open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
