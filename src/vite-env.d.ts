/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CDN_BASE?: string;
  /** "kiosk" builds the unattended gallery variant; anything else is the public web build. */
  readonly VITE_TARGET?: string;
  /** "sq" uses the pre-cropped square WebP grid posters; anything else uses the full JPGs. */
  readonly VITE_POSTER_TIER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
