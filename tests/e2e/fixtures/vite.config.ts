import { defineConfig } from "vite";
import path from "node:path";

const root = path.resolve(__dirname);

export default defineConfig({
  root,
  server: { host: "127.0.0.1", strictPort: true },
  resolve: {
    alias: {
      "@0xsarwagya/durable-local": path.resolve(root, "../../../src/index.ts"),
    },
  },
  build: { target: "esnext" },
});
