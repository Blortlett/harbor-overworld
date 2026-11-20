// Web client setup. Mirrors packages/react-native/src/create-polycentric-client.web.ts
// so both apps read and write the same IndexedDB and OPFS data.
import {
  MemoryFileStoreDriver,
  MemoryStorageDriver,
  PolycentricClient,
} from '@polycentric/js-core';
import {
  IndexedDBStorageDriver,
  OpfsFileStoreDriver,
} from '@polycentric/js-browser';
import {
  PolycentricCore,
  setLogger,
  uniffiInitAsync,
} from '@polycentric/rs-core-wasm/web';

const DATABASE_NAME = 'polycentric.db';

// Optional comma-separated gRPC-web URLs.
const SEED_SERVERS = (import.meta.env.VITE_HARBOR_SEED_SERVERS ?? '')
  .split(',')
  .map((server: string) => server.trim())
  .filter((server: string) => server.length > 0);

// Production servers from docs/src/data/servers.json. Set
// VITE_HARBOR_SEED_SERVERS to point at another server, such as localhost.
export const HARBOR_PRODUCTION_SERVERS = [
  'https://srv.harbor.social',
  'https://srv.polycentric.io',
];

export const seedServers =
  SEED_SERVERS.length > 0 ? SEED_SERVERS : HARBOR_PRODUCTION_SERVERS;

let loggerInstalled = false;
function installLogger() {
  if (loggerInstalled) return;
  loggerInstalled = true;
  setLogger({
    log: (message: string) => console.log(message),
  });
}

async function openDrivers() {
  const storageDriver = await IndexedDBStorageDriver.create(
    DATABASE_NAME,
  ).catch((error: unknown) => {
    console.warn('IndexedDB unavailable, running in memory:', error);
    return new MemoryStorageDriver();
  });
  const filestoreDriver = await OpfsFileStoreDriver.create(
    `${DATABASE_NAME}-blobs`,
  ).catch((error: unknown) => {
    console.warn('OPFS unavailable, storing blobs in memory:', error);
    return new MemoryFileStoreDriver();
  });
  return {
    storageDriver,
    filestoreDriver,
    persistentStorage: !(storageDriver instanceof MemoryStorageDriver),
  };
}

// One client per page load. Cached so hot reloads and remounts reuse it.
let clientPromise: Promise<PolycentricClient> | undefined;

export function getClient(): Promise<PolycentricClient> {
  clientPromise ??= (async () => {
    await uniffiInitAsync();
    installLogger();

    const drivers = await openDrivers();
    const client = await PolycentricClient.create({
      core: new PolycentricCore(),
      ...drivers,
      seedServers,
      // Omit application metadata. See the privacy requirement in the README.
    });

    // Sync in the background. Pages read local data right away.
    if (client.activeIdentityKey) {
      void client.sync().catch((error: unknown) => {
        console.warn('Initial Polycentric sync failed:', error);
      });
    }

    return client;
  })().catch((error: unknown) => {
    // Let a later call retry instead of caching the failure forever.
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}
