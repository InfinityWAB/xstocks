import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Sortie locale au dépôt. L'ancienne valeur pointait par chemin relatif dans
// l'arborescence du backend voisin (`../auth/app/Plugins/registry/xstock/…`),
// ce qui couplait deux dépôts par le système de fichiers et n'a plus de sens
// ici. La publication au registre relève de la chaîne de release, pas du build :
// celui-ci produit `dist/main.js`, point.
const BUILD_OUT = resolve(__dirname, 'dist')

export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'classic' }),
    {
      name: 'erp-runtime',
      transform(code, id) {
        if (!id.endsWith('.jsx')) return
        return {
          code: code
            .replace(/import\s+React\s+from\s+['"]react['"];?\n?/g, '')
            .replace(/import\s*\{\s*([^}]+)\s*\}\s*from\s+['"]react['"];?\n?/g, ''),
          map: null,
        }
      },
      renderChunk(code) {
        return {
          code: 'const React = window.__ERP_RUNTIME__?.React ?? window.React;\n'
            + 'const { useState, useEffect, useMemo, useCallback, useRef, Fragment } = React;\n'
            + code,
          map: null,
        }
      },
    },
  ],
  build: {
    outDir: BUILD_OUT,
    emptyOutDir: true,
    lib: {
      entry: 'src/main.jsx',
      formats: ['es'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [],
    },
    minify: false,
    cssCodeSplit: false,
  },
})
