/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_BUILDER_TOKEN: string;
  readonly VITE_AI_BUILDER_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
