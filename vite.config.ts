import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  // Private historical test pages are not product entry points.
  optimizeDeps: {entries: ['index.html']},
  server: {proxy: {'/api': 'http://127.0.0.1:4173'}},
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {output: {manualChunks: {three: ['three'], vue: ['vue', 'pinia']}}},
  },
});
