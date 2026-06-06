import { defineConfig } from "astro/config";

const proxyTarget = "https://127.0.0.1:5001";
const proxyPaths = ["/api", "/icons", "/fonts", "/font-previews"];

export default defineConfig({
  outDir: "./static",
  server: { port: 4321 },
  vite: {
    server: {
      proxy: Object.fromEntries(
        proxyPaths.map((p) => [
          p,
          {
            target: proxyTarget,
            changeOrigin: true,
            secure: false,
            ws: true,
          },
        ]),
      ),
    },
  },
});
