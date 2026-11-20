type Parameter<T> = {
  label: string;
  read(value: unknown): T;
  optional?: true;
};

function axis(label: string, min: number, max: number, fallback?: number) {
  const read = (value: unknown) => {
    if (value === undefined && fallback !== undefined) return fallback;
    const number =
      typeof value === 'string' && value.trim() ? Number(value) : value;
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    )
      throw new Error(`${label} must be a number between ${min} and ${max}.`);
    return number;
  };
  return {
    label,
    read,
    optional: fallback === undefined ? undefined : true,
  } satisfies Parameter<number>;
}

function toggle(label: string): Parameter<boolean> {
  return {
    label,
    optional: true,
    read(value) {
      if (value === undefined || value === false || value === 'false')
        return false;
      if (value === true || value === 'true') return true;
      throw new Error(`${label} must be true or false.`);
    },
  };
}

function string(label: string): Parameter<string> {
  return {
    label,
    read(value) {
      if (typeof value !== 'string') throw new Error(`${label} must be text.`);
      return value;
    },
  };
}

const direction: Parameter<'next' | 'previous'> = {
  label: 'next|previous',
  optional: true,
  read(value) {
    if (value === undefined || value === 'next') return 'next';
    if (value === 'previous') return value;
    throw new Error('Page direction must be next or previous.');
  },
};

function command<const P extends readonly Parameter<unknown>[]>(
  description: string,
  ...parameters: P
) {
  return { description, parameters };
}

export const controlCommands = {
  status: command('Read position, aim, crown, vehicles and noticeboard state.'),
  enter: command(
    'Enter the world.',
    toggle('capture-pointer'),
    toggle('use-display-name'),
  ),
  move: command(
    'Hold movement and look axes. A duration of zero holds until the next move or stop.',
    axis('forward', -1, 1),
    axis('sideways', -1, 1),
    axis('turn', -1, 1, 0),
    axis('look', -1, 1, 0),
    axis('milliseconds', 0, 60_000, 0),
  ),
  stop: command('Release movement and look axes.'),
  look: command(
    'Turn relative to your aim in degrees.',
    axis('yaw', -360, 360),
    axis('pitch', -180, 180),
  ),
  jump: command('Jump.'),
  ascend: command('Hold or release King ascent.', toggle('held')),
  sprint: command('Hold or release sprint.', toggle('held')),
  shoot: command('Fire while wearing the crown.'),
  size: command('Cycle avatar size while wearing the crown.'),
  boat: command('Board or disembark from the boat.'),
  plane: command('Board the seaplane, or leave it after landing and slowing.'),
  'plane-pitch': command(
    'Hold the seaplane yoke. Positive pitches up, negative pitches down, and zero releases it.',
    axis('pitch', -1, 1),
  ),
  page: command('Turn the focused noticeboard page.', direction),
  like: command('Toggle a like on the focused post.'),
  reply: command('Open the reply composer for the focused post.'),
  thread: command('Open the focused post on Harbor.'),
  chat: command('Open the chat composer.'),
  close: command('Close the open dialog.'),
  draft: command('Set composer text.', string('text')),
  publish: command('Submit the current draft.'),
  identity: command('Open the Harbor identity dialog.'),
  'create-name': command(
    'Create a Harbor identity using a display name.',
    string('name'),
  ),
  refresh: command('Refresh the feed.'),
  fullscreen: command(
    'Toggle fullscreen. The browser may require a click first.',
  ),
  scene: command(
    'Load a playground scene. Use an empty name for the room spawn.',
    string('name'),
    toggle('replay'),
  ),
  'join-tab': command('Open the room in a new browser tab.'),
};

export type ControlName = keyof typeof controlCommands;
type Values<P> = {
  -readonly [I in keyof P]: P[I] extends Parameter<infer T> ? T : never;
};
type Arguments<K extends ControlName> = Values<
  (typeof controlCommands)[K]['parameters']
>;
type InputSource = 'keyboard' | 'touch' | 'cli';
type Handlers = { [K in ControlName]: (...args: Arguments<K>) => unknown };
type Movement = {
  forward: number;
  sideways: number;
  turn: number;
  look: number;
};

export const POINTER_DEGREES = (0.00245 * 180) / Math.PI;

export type RunControl = <K extends ControlName>(
  name: K,
  ...args: Arguments<K>
) => unknown;

export function parseControl(name: unknown, args: unknown) {
  if (
    typeof name !== 'string' ||
    !Object.hasOwn(controlCommands, name) ||
    !Array.isArray(args)
  )
    throw new Error('Unknown control command.');
  const key = name as ControlName;
  const { parameters } = controlCommands[key];
  if (args.length > parameters.length)
    throw new Error(`Too many arguments for ${key}.`);
  return {
    name: key,
    args: parameters.map((parameter, i) => parameter.read(args[i])),
  };
}

export function createControls(
  actions: Omit<Handlers, 'move' | 'stop' | 'ascend' | 'sprint'> & {
    beginMovement(): boolean;
  },
) {
  const inputs = new Map<InputSource, Movement & { until: number }>();
  const ascent = new Set<InputSource>();
  const sprint = new Set<InputSource>();

  function from(source: InputSource): RunControl {
    const handlers: Handlers = {
      ...actions,
      ascend(held) {
        if (held) ascent.add(source);
        else ascent.delete(source);
      },
      sprint(held) {
        if (held) sprint.add(source);
        else sprint.delete(source);
      },
      move(forward, sideways, turn, look, duration) {
        if ((forward || sideways || turn || look) && actions.beginMovement())
          inputs.set(source, {
            forward,
            sideways,
            turn,
            look,
            until: duration ? performance.now() + duration : Infinity,
          });
        else inputs.delete(source);
      },
      stop() {
        inputs.delete(source);
      },
    };
    return (name, ...args) => {
      // The command name determines the handler's argument tuple.
      const handler = handlers[name] as (...values: typeof args) => unknown;
      return handler(...args);
    };
  }

  const cli = from('cli');
  return {
    from,
    get ascending() {
      return ascent.size > 0;
    },
    get sprinting() {
      return sprint.size > 0;
    },
    run: from('keyboard'),
    dispatch(name: unknown, args: unknown) {
      const parsed = parseControl(name, args);
      return cli(parsed.name, ...(parsed.args as Arguments<ControlName>));
    },
    movement(now: number): Movement {
      const motion: Movement = { forward: 0, sideways: 0, turn: 0, look: 0 };
      for (const [source, input] of inputs) {
        if (now >= input.until) {
          inputs.delete(source);
          continue;
        }
        motion.forward += input.forward;
        motion.sideways += input.sideways;
        motion.turn += input.turn;
        motion.look += input.look;
      }
      return motion;
    },
    release() {
      inputs.clear();
      ascent.clear();
      sprint.clear();
    },
  };
}

export type GameControls = ReturnType<typeof createControls>;
