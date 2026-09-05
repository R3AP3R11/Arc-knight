import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // phaser 为独立 vendor 库，体积大但可缓存，阈值抬到其上避免误报
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
