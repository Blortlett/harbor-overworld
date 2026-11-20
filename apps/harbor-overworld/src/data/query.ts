import type { PolycentricClient } from '@polycentric/js-core';
import type { Query, QueryOpts } from '@polycentric/rs-core-wasm/web';

/**
 * Run one core query and resolve with its final bytes.
 *
 * The core streams results as servers answer, and `complete` fires once every
 * server has responded or timed out. We wait for that, so callers get one
 * settled result instead of a stream to merge. Rejects only when no bytes
 * came back and at least one server reported an error.
 */
export function fetchOnce(
  client: PolycentricClient,
  queryKey: string[],
  query: Query,
  opts: QueryOpts = {},
): Promise<ArrayBuffer | undefined> {
  return new Promise((resolve, reject) => {
    let latest: ArrayBuffer | undefined;
    let lastError: string | undefined;

    client.core.fetchQuery(queryKey, query, opts).subscribe({
      next(result) {
        if (result.data !== undefined) {
          latest = result.data;
        }
      },
      error(message) {
        // One bad server should not fail the whole query. Keep the message in
        // case nothing else came back.
        console.warn(`query ${queryKey.join('/')} error: ${message}`);
        lastError = message;
      },
      complete() {
        if (latest === undefined && lastError !== undefined) {
          reject(new Error(lastError));
        } else {
          resolve(latest);
        }
      },
    });
  });
}
