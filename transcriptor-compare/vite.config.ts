import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const projectRoot = path.resolve(__dirname, "..");
  const rootEnv = loadEnv(mode, projectRoot, "");
  const localEnv = loadEnv(mode, __dirname, "");
  const env = { ...rootEnv, ...localEnv };

  const token = env.AI_BUILDER_TOKEN || env.VITE_AI_BUILDER_TOKEN || "";
  const baseUrl = (
    env.AI_BUILDER_BASE_URL ||
    env.VITE_AI_BUILDER_BASE_URL ||
    "https://space.ai-builders.com/backend"
  ).replace(/\/$/, "");

  return {
    root: __dirname,
    plugins: [react()],
    server: {
      port: 5184,
      strictPort: true,
      proxy: {
        "/backend": {
          target: "https://space.ai-builders.com",
          changeOrigin: true,
          secure: true,
          ws: true,
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "onnxruntime-node": path.resolve(__dirname, "node_modules/onnxruntime-web"),
      },
    },
    define: {
      "import.meta.env.VITE_AI_BUILDER_TOKEN": JSON.stringify(token),
      "import.meta.env.VITE_AI_BUILDER_BASE_URL": JSON.stringify(baseUrl),
    },
    optimizeDeps: {
      exclude: ["@xenova/transformers"],
      include: ["onnxruntime-web"],
    },
  };
});
