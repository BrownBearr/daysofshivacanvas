import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // three is the only dependency big enough to be worth splitting. drei, maath and
        // @react-spring/three used to be named here while nothing in src/ imported them, which
        // pulled them into the bundle every visitor downloads.
        manualChunks: {
          three: ["three"],
          r3f: ["@react-three/fiber"],
        },
      },
    },
  },
});
