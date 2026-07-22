/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WEBSOCKET_URL?: string;
  readonly VITE_JURISDICTION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
