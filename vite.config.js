const path = require("path");
const react = require("@vitejs/plugin-react");
const { defineConfig } = require("vite");

module.exports = defineConfig({
  root: "src/client",
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client/src")
    }
  },
  build: {
    outDir: path.resolve(__dirname, "public"),
    emptyOutDir: false,
    assetsDir: "assets"
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4173"
    }
  }
});
