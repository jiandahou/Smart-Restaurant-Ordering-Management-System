import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:5000'
  const assetTarget = env.VITE_ASSET_PROXY_TARGET || 'http://localhost:9000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      watch: {
        usePolling: env.CHOKIDAR_USEPOLLING === 'true',
      },
      // changeOrigin is deliberately off: it rewrites the Host header to the proxy target, which
      // under Docker Compose is the internal service name. The backend builds its OAuth callback
      // from that header, so Google was handed http://backend:8080/... — neither HTTPS nor
      // localhost, which its security policy rejects outright. Leaving Host alone keeps the
      // browser's real origin, which is what a redirect URI has to be.
      proxy: {
        '/health': {
          target: backendTarget,
          changeOrigin: false,
          secure: false,
        },
        '/api': {
          target: backendTarget,
          changeOrigin: false,
          secure: false,
          ws: true,
        },
        '/uploads': {
          target: backendTarget,
          changeOrigin: false,
          secure: false,
        },
        // Local MinIO URLs are stored as localhost:9000. resolvePublicAssetUrl converts them to
        // this same-origin path when the browser uses a LAN hostname, so phones never resolve
        // localhost as the phone itself.
        '/dineflow-avatars-local': {
          target: assetTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
