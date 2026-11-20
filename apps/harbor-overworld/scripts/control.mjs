import { controlCommands, parseControl } from '../src/world/controls.ts';

const args = process.argv.slice(2);
let url = 'http://127.0.0.1:5173';
let tab;
for (;;) {
  if (args[0] === '--url') {
    args.shift();
    url = args.shift();
    if (!url) throw new Error('--url requires a loopback playground URL.');
  } else if (args[0] === '--tab') {
    args.shift();
    tab = args.shift();
    if (!tab) throw new Error('--tab requires a tab name.');
  } else break;
}

const [name, ...values] = args;
if (!name || name === 'help' || name === '--help') {
  console.log(
    'Usage: node scripts/control.mjs [--url URL] [--tab NAME] COMMAND [ARG ...]\n',
  );
  console.log('tabs    List controllable playground tabs.\n');
  for (const [command, { description, parameters }] of Object.entries(
    controlCommands,
  )) {
    const usage = [
      command,
      ...parameters.map(({ label, optional }) =>
        optional ? `[${label}]` : `<${label}>`,
      ),
    ];
    console.log(`${usage.join(' ')}\n  ${description}`);
  }
} else {
  try {
    const endpoint = new URL('/__overworld/control', url);
    if (
      !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) ||
      !['http:', 'https:'].includes(endpoint.protocol)
    )
      throw new Error('Use a loopback playground URL.');
    const list = name === 'tabs';
    const response = await fetch(
      endpoint,
      list
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...parseControl(name, values), tab }),
            signal: AbortSignal.timeout(7000),
          },
    );
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    console.log(JSON.stringify(list ? value.tabs : value.result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
