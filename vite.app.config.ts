import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  root: 'frontend/app',
  plugins: [solid(), viteSingleFile()],
  build: { outDir: '../../dist/app', emptyOutDir: true, target: 'es2022' },
});
