import { createPublicKey, verify } from 'node:crypto';

export function verifyProof(
  key: Uint8Array,
  message: Uint8Array,
  proof: string,
) {
  if (key.byteLength !== 32) return false;
  const publicKey = createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(key).toString('base64url'),
    },
    format: 'jwk',
  });
  return verify(null, message, publicKey, Buffer.from(proof, 'hex'));
}
