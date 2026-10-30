import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const port = Number(process.env.PORT || "5180");
const basePath = process.env.BASE_PATH || "/__mockup";

export default defineConfig({
  base: basePath,
  esbuild: {
    target: "esnext",
    supported: {
      destructuring: true,
    },
  },
  plugins: [
    mockupPreviewPlugin(),
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
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    target: "esnext",
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },

  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

