import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: {
    watch: {
      ignored: [
        "**/release/**",
        "**/outputs/**",
        "**/test-results/**",
        "**/.cache/**",
      ],
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1800 },
});
