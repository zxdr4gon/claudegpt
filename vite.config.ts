import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tailwind v3 runs through PostCSS (postcss.config.mjs). See DECISIONS #15.
export default defineConfig({
  plugins: [react()],
});
