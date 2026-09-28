import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = Number(env.PORT || 41873);
  const frontendPort = Number(env.VITE_PORT || 41872);

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      proxy: {
        // 开发时前端和后端端口不同，/api 请求由 Vite 转发到 Express。
        "/api": `http://localhost:${backendPort}`
      }
    }
  };
});
