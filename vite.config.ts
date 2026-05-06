import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite serves the frontend dev assets. The Node server (port 3000) proxies
// non-/api requests here in development. Direct hits at :5173 also work and
// auto-proxy /api to the Node server (handy for HMR-only debugging).
export default defineConfig({
  root: path.resolve(dirname, "src/frontend"),
  build: {
    outDir: path.resolve(dirname, "dist/frontend"),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      "^/api/": `http://localhost:${process.env.PORT || 3000}`,
    },
  },
});
