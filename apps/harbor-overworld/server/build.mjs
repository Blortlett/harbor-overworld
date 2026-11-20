import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const transport = require.resolve(
  '@protobuf-ts/grpcweb-transport/package.json',
);
const fromTransport = createRequire(transport);
const licenseFiles = [
  ['Harbor SDK', new URL('../../../LICENSE', import.meta.url)],
  ['ws', join(dirname(require.resolve('ws')), 'LICENSE')],
  ['@protobuf-ts/grpcweb-transport', join(dirname(transport), 'LICENSE')],
  ...['@protobuf-ts/runtime', '@protobuf-ts/runtime-rpc'].map((dependency) => [
    dependency,
    join(
      dirname(fromTransport.resolve(`${dependency}/package.json`)),
      'LICENSE',
    ),
  ]),
];
const licenses = await Promise.all(
  licenseFiles.map(
    async ([name, file]) =>
      `/* ${name} license:\n${await readFile(file, 'utf8')}*/`,
  ),
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
    js: `${licenses.join('\n')}\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);`,
  },
  define: {
    __OVERWORLD_BUILD__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
    'process.env.WS_NO_BUFFER_UTIL': 'true',
    'process.env.WS_NO_UTF_8_VALIDATE': 'true',
  },
});
