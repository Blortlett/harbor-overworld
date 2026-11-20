import type { CollisionScene, createPlayerMovement } from './movement';
import './playground.css';
import {
  replayScenario,
  scenarioByName,
  scenarios,
  scenarioView,
} from './scenarios';

export function setupPlayground(
  player: ReturnType<typeof createPlayerMovement>,
  game: HTMLElement,
  setKing: (enabled: boolean) => void,
) {
  const params = new URLSearchParams(location.search);
  const selected = params.get('scene') ?? '';
  const scenario = scenarioByName(selected);
  const autoplay = !!scenario?.segments.length && params.has('replay');
  if (scenario) player.reset(scenarioView(scenario));

  const bar = document.createElement('div');
  bar.className = 'playground-controls plate';
  bar.setAttribute('aria-label', 'Playground controls');
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Playground scene');
  select.add(new Option('Room spawn', ''));
  for (const [name, entry] of Object.entries(scenarios)) {
    select.add(new Option(entry.label, name));
  }
  select.value = scenario ? selected : '';
  select.addEventListener('change', () => {
    location.search = new URLSearchParams({ scene: select.value }).toString();
  });

  const replayLink = document.createElement('a');
  replayLink.textContent = 'Replay';
  replayLink.href = `?${new URLSearchParams({ scene: selected, replay: '1' })}`;
  replayLink.hidden = !scenario?.segments.length;

  const second = document.createElement('a');
  second.href = '?scene=';
  second.target = '_blank';
  second.rel = 'noopener';
  second.textContent = 'Join in another tab';

  const king = document.createElement('label');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!scenario?.king;
  checkbox.addEventListener('change', () => setKing(checkbox.checked));
  king.append(checkbox, ' King');

  bar.append(select, replayLink, king, second);
  game.append(bar);
  setKing(checkbox.checked);

  let run: ReturnType<typeof replayScenario> | undefined;
  let nextFrame = 0;
  let done = !autoplay;
  return {
    scene: scenario,
    get replaying() {
      return !done;
    },
    step(time: number, collisions: CollisionScene) {
      if (done || !scenario) return false;
      if (collisions.stationCount < (scenario.stations ?? 0)) return true;
      if (!run) {
        run = replayScenario(player, scenario, collisions, time);
        nextFrame = time;
      }
      // Catch up to the game clock even on displays with a different refresh rate.
      while (time >= nextFrame) {
        if (run.next().done) {
          done = true;
          break;
        }
        nextFrame += 1000 / 60;
      }
      return true;
    },
  };
}
