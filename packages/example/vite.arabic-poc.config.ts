import { defineConfig } from 'vite'
import { resolve } from 'path'

/**
 * Isolated build/dev config for the Arabic HarfBuzz proof of concept.
 *
 * HarfBuzzJS 1.x initializes its WASM module with top-level await, so this
 * experiment intentionally targets modern ESM without changing the upstream
 * example application's compatibility target.
 */
export default defineConfig({
  base: './',
  optimizeDeps: {
    // Do not ask esbuild to pre-bundle HarfBuzzJS; serve its native ESM module.
    exclude: ['harfbuzzjs'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext',
    outDir: resolve(__dirname, 'dist-arabic-poc'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        arabicPoc: resolve(__dirname, 'arabic-poc.html'),
        arabicBidiPoc: resolve(__dirname, 'arabic-bidi-poc.html')
      },
      output: {
        format: 'es'
      }
    }
  }
})

