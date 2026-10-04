import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Same-origin API middleware for development and `vite preview`. Production can run
// `npm run serve`, which uses the identical handler while serving the built single file.
const floorApi = () => ({
  name: 'floor-data-api',
  configureServer(server: { middlewares: { use: (fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void } }) {
    server.middlewares.use(async (req, res, next) => { const { handleApiRequest } = await import('./server/api.mts'); if (!(await handleApiRequest(req, res))) next(); });
  },
  configurePreviewServer(server: { middlewares: { use: (fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void) => void } }) {
    server.middlewares.use(async (req, res, next) => { const { handleApiRequest } = await import('./server/api.mts'); if (!(await handleApiRequest(req, res))) next(); });
  },
});

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), floorApi(), viteSingleFile()],
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
