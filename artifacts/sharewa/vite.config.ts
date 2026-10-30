import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const port = Number(process.env.PORT || '3000');
const basePath = process.env.BASE_PATH || '/';
const apiProxy = {
  '/api': {
    target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
    changeOrigin: true,
  },
};

export default defineConfig({
  base: basePath,
  esbuild: {
    target: 'esnext',
    supported: {
      destructuring: true,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: {
        destructuring: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    target: 'esnext',
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },

  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: apiProxy,
  },
});
