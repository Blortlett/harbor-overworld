import { POINTER_DEGREES, type RunControl } from './controls';

type TouchCallbacks = {
  hasStarted(): boolean;
  run: RunControl;
};

type WebKitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?(): void;
};

type WebKitElement = HTMLElement & { webkitRequestFullscreen?(): void };

function control<T extends HTMLElement>(game: HTMLElement, selector: string) {
  const element = game.querySelector<T>(selector);
  if (!element) throw new Error(`Missing Overworld control ${selector}`);
  return element;
}

function bindFullscreen(game: HTMLElement, run: RunControl) {
  const button = control<HTMLButtonElement>(game, '#fullscreen');
  const status = control(game, '#fullscreen-status');
  const page: WebKitDocument = document;
  const target: WebKitElement = game;
  const standard = page.fullscreenEnabled && !!target.requestFullscreen;
  const webkit =
    page.webkitFullscreenEnabled && !!target.webkitRequestFullscreen;
  if (!standard && !webkit) return () => false;

  button.hidden = false;
  const fullElement = () =>
    standard ? page.fullscreenElement : page.webkitFullscreenElement;

  function showStatus() {
    const fullscreen = fullElement() === game;
    const label = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.fullscreen = String(fullscreen);
    status.hidden = true;
  }

  function showError() {
    status.textContent = 'Fullscreen is unavailable right now.';
    status.hidden = false;
  }

  page.addEventListener(
    standard ? 'fullscreenchange' : 'webkitfullscreenchange',
    showStatus,
  );
  page.addEventListener(
    standard ? 'fullscreenerror' : 'webkitfullscreenerror',
    showError,
  );
  button.addEventListener('click', () => run('fullscreen'));

  return async function toggleFullscreen() {
    try {
      if (fullElement() === game) {
        if (standard) await page.exitFullscreen();
        else page.webkitExitFullscreen?.();
      } else if (standard) {
        await target.requestFullscreen();
      } else {
        target.webkitRequestFullscreen?.();
      }
      return true;
    } catch {
      showError();
      return false;
    }
  };
}

export function bindMobileControls(
  game: HTMLElement,
  world: HTMLCanvasElement,
  { hasStarted, run }: TouchCallbacks,
) {
  const stick = control(game, '#move-stick');
  const thumb = control(game, '#move-thumb');
  const jumpButton = control(game, '#touch-jump');
  const sprintButton = control(game, '#touch-sprint');
  const chatButton = control(game, '#touch-chat');
  const shootButton = control(game, '#touch-shoot');
  let movePointer: number | undefined;
  let jumpPointer: number | undefined;
  let sprintPointer: number | undefined;
  let lookPointer: { id: number; x: number; y: number } | undefined;

  function resetMovement() {
    const pointer = movePointer;
    movePointer = undefined;
    run('stop');
    thumb.style.removeProperty('translate');
    if (pointer !== undefined && stick.hasPointerCapture(pointer))
      stick.releasePointerCapture(pointer);
  }

  function resetLook() {
    const pointer = lookPointer;
    lookPointer = undefined;
    if (pointer && world.hasPointerCapture(pointer.id))
      world.releasePointerCapture(pointer.id);
  }

  function resetJump() {
    const pointer = jumpPointer;
    jumpPointer = undefined;
    run('ascend', false);
    if (pointer !== undefined && jumpButton.hasPointerCapture(pointer))
      jumpButton.releasePointerCapture(pointer);
  }

  function resetSprint() {
    const pointer = sprintPointer;
    sprintPointer = undefined;
    run('sprint', false);
    if (pointer !== undefined && sprintButton.hasPointerCapture(pointer))
      sprintButton.releasePointerCapture(pointer);
  }

  function reset() {
    resetMovement();
    resetLook();
    resetJump();
    resetSprint();
  }

  function move(event: PointerEvent) {
    if (event.pointerId !== movePointer) return;
    const { left, top, width, height } = stick.getBoundingClientRect();
    const x = event.clientX - left - width / 2;
    const y = event.clientY - top - height / 2;
    const distance = Math.hypot(x, y);
    const radius = Math.min(width, height) * 0.28;
    const unitX = distance > 0 ? x / distance : 0;
    const unitY = distance > 0 ? y / distance : 0;
    const offset = Math.min(distance, radius);
    const strength = Math.max(0, (offset / radius - 0.13) / 0.87);
    run('move', -unitY * strength, unitX * strength, 0, 0, 0);
    thumb.style.translate = `${unitX * offset}px ${unitY * offset}px`;
  }

  stick.addEventListener('pointerdown', (event) => {
    if (!hasStarted() || movePointer !== undefined || event.button !== 0)
      return;
    movePointer = event.pointerId;
    stick.setPointerCapture(movePointer);
    move(event);
  });
  stick.addEventListener('pointermove', move);

  world.addEventListener('pointerdown', (event) => {
    if (!hasStarted() || event.pointerType === 'mouse' || lookPointer) return;
    lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    world.setPointerCapture(event.pointerId);
  });
  world.addEventListener('pointermove', (event) => {
    if (lookPointer?.id !== event.pointerId) return;
    run(
      'look',
      (event.clientX - lookPointer.x) * 2.5 * POINTER_DEGREES,
      -(event.clientY - lookPointer.y) * 2.5 * POINTER_DEGREES,
    );
    lookPointer.x = event.clientX;
    lookPointer.y = event.clientY;
  });
  for (const type of [
    'pointerup',
    'pointercancel',
    'lostpointercapture',
  ] as const) {
    stick.addEventListener(type, ({ pointerId }) => {
      if (pointerId === movePointer) resetMovement();
    });
    world.addEventListener(type, ({ pointerId }) => {
      if (pointerId === lookPointer?.id) resetLook();
    });
    jumpButton.addEventListener(type, ({ pointerId }) => {
      if (pointerId === jumpPointer) resetJump();
    });
    sprintButton.addEventListener(type, ({ pointerId }) => {
      if (pointerId === sprintPointer) resetSprint();
    });
  }

  const coarse = matchMedia('(pointer: coarse)');
  game.classList.toggle('touch-input', coarse.matches);
  coarse.addEventListener('change', ({ matches }) => {
    game.classList.toggle('touch-input', matches);
    reset();
  });
  game.addEventListener(
    'pointerdown',
    ({ pointerType }) => {
      game.classList.toggle(
        'touch-input',
        coarse.matches || pointerType === 'touch' || pointerType === 'pen',
      );
    },
    { capture: true },
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  });
  jumpButton.addEventListener('pointerdown', (event) => {
    if (!hasStarted() || jumpPointer !== undefined || event.button !== 0)
      return;
    jumpPointer = event.pointerId;
    jumpButton.setPointerCapture(jumpPointer);
    run('ascend', true);
    run('jump');
  });
  sprintButton.addEventListener('pointerdown', (event) => {
    if (!hasStarted() || sprintPointer !== undefined || event.button !== 0)
      return;
    sprintPointer = event.pointerId;
    sprintButton.setPointerCapture(sprintPointer);
    run('sprint', true);
  });
  jumpButton.addEventListener('click', (event) => {
    if (event.detail === 0) run('jump');
  });
  chatButton.addEventListener('click', () => run('chat'));
  shootButton.addEventListener('click', () => run('shoot'));
  return { reset, toggleFullscreen: bindFullscreen(game, run) };
}
