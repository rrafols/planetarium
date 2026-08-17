import { defineConfig } from 'vite';

/**
 * The source `index.html` carries an import map pointing `three` at a CDN, so
 * the repository can be served unbuilt by any static host. The bundle resolves
 * three at build time and never requests a bare specifier, so that map is dead
 * weight in production — and leaving it would imply an external dependency the
 * built site does not actually have. Strip it.
 */
function stripImportMap() {
  return {
    name: 'strip-importmap',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
    },
  };
}

export default defineConfig({
  // Relative base keeps the bundle working from any subpath, which is what
  // GitHub Pages project sites need (https://user.github.io/planetarium/).
  base: './',
  plugins: [stripImportMap()],
  // Lets the source tell whether it is running bundled or raw; `public/` is
  // flattened into the site root only in a build.
  define: { __BUILT__: 'true' },
  server: { open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
