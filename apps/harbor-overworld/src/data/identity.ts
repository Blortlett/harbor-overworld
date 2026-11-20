import {
  COLLECTION,
  hexToBytes,
  type PolycentricClient,
  v2,
} from '@polycentric/js-core';
export async function createIdentity(client: PolycentricClient, name: string) {
  const { login, genesisEvent, identityContent, serializedContent } =
    await client.loginManager.beginSignup();
  await client.commitEvent({
    owner: login.identity,
    signedEvent: genesisEvent,
    content: identityContent,
    contentBytes: serializedContent.contentBytes,
  });
  await client.loginManager.finishSignup(login);
  await client.loginAs(login);
  await updateName(client, name);
}

export async function updateName(client: PolycentricClient, name: string) {
  const identity = client.activeIdentityKey;
  if (!identity) throw new Error('Select an identity first.');
  const previous = latestLocalProfile(client, identity);
  await client.createEvent({
    collection: COLLECTION.PROFILE,
    content: v2.Content.create({
      contentBody: {
        oneofKind: 'profileUpdate',
        profileUpdate: v2.ProfileUpdate.create({
          ...previous,
          name: name.trim(),
        }),
      },
    }),
  });
}

export function latestLocalProfile(
  client: PolycentricClient,
  identity: string,
) {
  let newest: { time: bigint; profile: v2.ProfileUpdate } | undefined;
  for (const bundle of client.listValidEvents(identity, COLLECTION.PROFILE)) {
    if (!bundle.signedEvent || !bundle.serializedContent) continue;
    const body = v2.Content.fromBinary(
      bundle.serializedContent.contentBytes,
    ).contentBody;
    if (body.oneofKind !== 'profileUpdate') continue;
    const time =
      v2.Event.fromBinary(bundle.signedEvent.eventBytes).createdAt ?? 0n;
    if (!newest || time > newest.time)
      newest = { time, profile: body.profileUpdate };
  }
  return newest?.profile;
}

export function decodeIdentityBackup(text: string): v2.IdentityBackup | null {
  try {
    const bytes = hexToBytes(text.trim());
    if (!bytes) return null;
    const backup = v2.IdentityBackup.fromBinary(bytes);
    return backup.identityKey && backup.recoveryKey ? backup : null;
  } catch {
    return null;
  }
}

export async function recoverFromBackup(
  client: PolycentricClient,
  backup: v2.IdentityBackup,
) {
  const login = await client.loginManager.beginLogin(
    backup.identityKey,
    'recovery',
  );
  try {
    await client.loginManager.recoverIdentity(login.keyPair, backup);
  } finally {
    const details = await client.storage.logins.getLoginDetails(
      login.identity,
      login.publicKey,
    );
    if (details?.status === 'pendingRecovery') {
      await client.storage.logins.deleteLogin(login.identity, login.publicKey);
    }
  }
}
