// Pairing, claimer side. This device asks to join an identity that is already
// signed in on another device, and that device approves it. Port of
// apps/harbor/src/features/identity-pairing/hooks/usePairIdentityClaimer.ts and
// pairingCode.ts, run as one async function instead of a state machine.
import type { PairingSession, PolycentricClient } from '@polycentric/js-core';
import { hexToBytes, v2 } from '@polycentric/js-core';

const POLL_INTERVAL_MS = 2000;

/**
 * Read a pairing code. Accepts a link with a `code` parameter, or the bare
 * code in hex or base64, which is what harbor's pairing screen accepts too.
 */
export function parsePairingCode(input: string): v2.PairingInfo | null {
  const trimmed = input.trim();
  let code = trimmed;

  try {
    const url = new URL(trimmed);
    const param = url.searchParams.get('code');
    if (param !== null) {
      code = param;
    }
  } catch {
    // Not a URL. Treat the whole input as the code.
  }

  return decodeHexOrBase64(code);
}

function decodeHexOrBase64(code: string): v2.PairingInfo | null {
  const fromHex = hexToBytes(code);
  if (fromHex) {
    try {
      return v2.PairingInfo.fromBinary(fromHex);
    } catch {
      // Fall through and try base64.
    }
  }
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return v2.PairingInfo.fromBinary(bytes);
  } catch {
    return null;
  }
}

/**
 * Servers to claim from. The issuer's identity state lists them when it has
 * them. Otherwise use ours plus the server in the pairing code.
 */
function serversForClaim(
  session: PairingSession,
  info: v2.PairingInfo,
  currentServers: string[],
): string[] {
  const bundle = session.issuerState.identityState;
  if (!bundle?.signedEvent || !bundle.serializedContent?.contentBytes) {
    throw new Error('Pairing session has no issuer identity state.');
  }
  const content = v2.Content.fromBinary(bundle.serializedContent.contentBytes);
  if (content.contentBody.oneofKind !== 'identity') {
    throw new Error('Pairing session issuer identity state is invalid.');
  }
  const declared = content.contentBody.identity.servers;
  if (declared) return declared.urls;

  return [...new Set([...currentServers, info.server])];
}

export type PairingStage =
  | 'fetching'
  | 'joining'
  | 'waiting'
  | 'claiming'
  | 'done';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Run the whole claim. `onStage` reports progress. Pass an AbortSignal to
 * cancel (for example when the page unmounts).
 */
export async function claimPairedIdentity(
  client: PolycentricClient,
  info: v2.PairingInfo,
  onStage: (stage: PairingStage) => void,
  signal: AbortSignal,
): Promise<void> {
  onStage('fetching');
  const session = await client.pairingSessionManager.getPairingSession(info);
  signal.throwIfAborted();
  const pending = await client.loginManager.beginLogin(
    session.digest.issuerIdentity,
    'pair',
  );
  try {
    signal.throwIfAborted();
    onStage('joining');
    await client.pairingSessionManager.joinPairingSession(
      info,
      pending.publicKey,
    );

    onStage('waiting');
    while (true) {
      signal.throwIfAborted();
      try {
        if (
          await client.pairingSessionManager.pollForAuthorization(
            info,
            pending.publicKey,
          )
        )
          break;
      } catch (error) {
        console.warn('Pairing session polling error:', error);
      }
      await sleep(POLL_INTERVAL_MS, signal);
    }

    signal.throwIfAborted();
    onStage('claiming');
    const servers = serversForClaim(session, info, client.servers);
    await client.loginManager.claim(pending, servers);
    if (!signal.aborted) onStage('done');
  } finally {
    const login = await client.storage.logins.getLoginDetails(
      pending.identity,
      pending.publicKey,
    );
    if (login?.status === 'pendingPair') {
      await client.storage.logins.deleteLogin(
        pending.identity,
        pending.publicKey,
      );
    }
  }
}
