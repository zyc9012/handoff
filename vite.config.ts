import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/drop": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
