import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ],
      manifest: {
        name: 'Chatrive',
        short_name: 'Chatrive',
        description: 'Private messaging with photos, reactions, and stickers.',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['social', 'communication'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webp}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin.includes('fonts.googleapis.com') ||
              url.origin.includes('fonts.gstatic.com'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
})
