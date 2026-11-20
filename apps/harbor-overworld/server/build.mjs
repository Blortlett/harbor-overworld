import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const license = await readFile(
  join(dirname(require.resolve('ws')), 'LICENSE'),
  'utf8',
);
await build({
  entryPoints: ['server/main.ts'],
  outfile: 'dist-presence/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // ws is CommonJS and requires Node built-ins. Use its pure JS implementation.
  banner: {
    js: `/* ws license:\n${license}*/\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
  define: {
    'process.env.WS_NO_BUFFER_UTIL': 'true',
    'process.env.WS_NO_UTF_8_VALIDATE': 'true',
  },
});
