import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the same build run from GitHub Pages (/betalog-app/), Spring Boot static files and the Android app.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
