import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5183,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // @xenova/transformers imports onnxruntime-node + onnxruntime-web; Vite must not load the Node build in the browser.
      "onnxruntime-node": path.resolve(__dirname, "node_modules/onnxruntime-web"),
    },
  },
  optimizeDeps: {
    exclude: ["@xenova/transformers"],
    include: ["onnxruntime-web"],
  },
});
