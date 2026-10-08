import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build can be hosted from any sub-path.
  base: './',
  resolve: {
    // three/addons (GLTFLoader, BufferGeometryUtils…) import bare 'three', which is the WebGL build
    // (three.module.js): it would bundle a second renderer next to three.webgpu.js. The WebGPU build
    // exports the same core classes, so every bare import goes there and there is one three.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'esnext', chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
