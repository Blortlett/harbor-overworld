import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { playgroundFeed } from './server/playground.ts';
import { attachPresence } from './server/presence.ts';

// rs-core-wasm imports its .wasm as a URL and hands it to the loader. Vite
// would otherwise load it as a wasm ES module and fail, so ask for the URL.
const wasmAsUrl = {
  name: 'harbor-wasm-as-url',
  enforce: 'pre' as const,
  async resolveId(
    this: { resolve: (...args: unknown[]) => Promise<{ id: string } | null> },
    source: string,
    importer?: string,
  ) {
    if (!source.endsWith('.wasm') || !importer?.includes('rs-core-wasm')) {
      return null;
    }
    const resolved = await this.resolve(source, importer, { skipSelf: true });
    return resolved ? `${resolved.id}?url` : null;
  },
};

const licenseNotices: Plugin = {
  name: 'harbor-license-notices',
  apply: 'build',
  generateBundle() {
    const app = readFileSync(new URL('../LICENSE.md', import.meta.url), 'utf8');
    const sdk = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8');
    this.emitFile({
      type: 'asset',
      fileName: 'licenses.txt',
      source: `Harbor Overworld is a modified version of the Harbor web client.

Harbor application license (apps/LICENSE.md)

${app}
Repository and SDK license (LICENSE)

${sdk}`,
    });
  },
};

const multiplayer: Plugin = {
  name: 'overworld-multiplayer',
  configureServer({ httpServer, config }) {
    if (httpServer)
      attachPresence(
        httpServer,
        undefined,
        config.mode === 'playground' ? playgroundFeed : undefined,
      );
  },
  configurePreviewServer({ httpServer }) {
    attachPresence(httpServer);
  },
};

export default defineConfig({
  plugins: [wasmAsUrl, licenseNotices, multiplayer],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
