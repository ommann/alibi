import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  root: 'frontend/app',
  plugins: [viteSingleFile()],
  build: { outDir: '../../dist/app', emptyOutDir: true, target: 'es2022' },
});
