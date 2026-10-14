import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from the Android asset loader.
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    fs: { allow: ['..'] },
  },
});
