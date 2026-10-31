import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    base: './',
    plugins: [react(), {
      name: 'application-csp',
      transformIndexHtml(_html, context) {
        const scripts = context.server ? "'self' 'unsafe-inline'" : "'self'"
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: `default-src 'none'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' remote-preview: data: http: https:; media-src remote-preview:; frame-src remote-preview:; object-src remote-preview:; connect-src 'self' ${context.server ? 'ws: http://localhost:* http://127.0.0.1:*' : ''}; font-src 'self' data:; base-uri 'none'; form-action 'none'` }, injectTo: 'head-prepend' }]
      },
    }],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
  },
})
