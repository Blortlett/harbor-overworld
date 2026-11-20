import type { PolycentricClient } from '@polycentric/js-core';
import { getClient } from '../client/client';
import { decodeIdentityBackup, recoverFromBackup } from '../data/identity';
import { claimPairedIdentity, parsePairingCode } from '../data/pairing';

export function bindIdentityDialog(
  dialog: HTMLDialogElement,
  onConnected: (client: PolycentricClient) => void,
) {
  function control<T extends HTMLElement>(selector: string) {
    const node = dialog.querySelector<T>(selector);
    if (!node) throw new Error(`Missing identity setup control ${selector}.`);
    return node;
  }

  const pair = control<HTMLFormElement>('#pair-form');
  const code = control<HTMLInputElement>('#pair-code');
  const recover = control<HTMLFormElement>('#backup-form');
  const file = control<HTMLInputElement>('#backup-file');
  const status = control<HTMLElement>('#connect-status');
  const inputs = dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
    'form input, form button',
  );
  let connection: AbortController | undefined;

  function report(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }

  async function connect(
    operation: (
      client: PolycentricClient,
      signal: AbortSignal,
    ) => Promise<void>,
  ) {
    if (connection) return;
    if (!isSecureContext) {
      report('Open Overworld over HTTPS to connect your Harbor identity.');
      return;
    }
    const controller = new AbortController();
    connection = controller;
    for (const input of inputs) input.disabled = true;
    report('Connecting to Harbor…');
    try {
      const client = await getClient();
      controller.signal.throwIfAborted();
      await operation(client, controller.signal);
      if (!controller.signal.aborted) {
        pair.reset();
        recover.reset();
        report();
        onConnected(client);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        report(error instanceof Error ? error.message : String(error));
      }
    } finally {
      connection = undefined;
      for (const input of inputs) input.disabled = false;
    }
  }

  pair.addEventListener('submit', (event) => {
    event.preventDefault();
    const info = parsePairingCode(code.value);
    if (!info?.server || info.digestSha256.length !== 32) {
      report('Enter the pairing link or code shown in Harbor.');
      return;
    }
    void connect((client, signal) =>
      claimPairedIdentity(
        client,
        info,
        (stage) => {
          if (signal.aborted) return;
          switch (stage) {
            case 'waiting':
              report('Approve the browser in your Harbor app.');
              break;
            case 'claiming':
              report('Importing your Harbor identity…');
              break;
          }
        },
        signal,
      ),
    );
  });

  recover.addEventListener('submit', (event) => {
    event.preventDefault();
    const backupFile = file.files?.[0];
    if (!backupFile) return;
    void connect(async (client, signal) => {
      const backup = decodeIdentityBackup(await backupFile.text());
      signal.throwIfAborted();
      if (!backup) throw new Error('Choose a valid Harbor backup file.');
      report('Recovering your Harbor identity…');
      await recoverFromBackup(client, backup);
    });
  });

  dialog.addEventListener('close', () => {
    connection?.abort();
    report();
  });
}
