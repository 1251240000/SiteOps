import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/browser.ts',
      name: 'SiteOpsTracker',
      formats: ['iife'],
      fileName: () => 'siteops-tracker.iife.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
