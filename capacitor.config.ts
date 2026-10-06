import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.chatriv.app',
  appName: 'Chatriv',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0b141a',
    },
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
