import type { RunControl } from './controls';
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
  runControl: RunControl,
) {
  const params = new URLSearchParams(location.search);
  const selected = params.get('scene') ?? '';
  const scenario = scenarioByName(selected);
  const autoplay = !!scenario?.segments.length && params.has('replay');
  if (scenario) player.reset(scenarioView(scenario));

  function sceneUrl(name: string, replay: boolean) {
    const url = new URL(location.href);
    url.searchParams.set('scene', name);
    if (replay) url.searchParams.set('replay', '1');
    else url.searchParams.delete('replay');
    return url;
  }

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
    runControl('scene', select.value, false);
  });

  const replayLink = document.createElement('a');
  replayLink.textContent = 'Replay';
  replayLink.href = sceneUrl(selected, true).href;
  replayLink.hidden = !scenario?.segments.length;
  replayLink.addEventListener('click', (event) => {
    event.preventDefault();
    runControl('scene', selected, true);
  });

  const second = document.createElement('a');
  second.href = '?scene=';
  second.target = '_blank';
  second.rel = 'noopener';
  second.textContent = 'Join in another tab';
  second.addEventListener('click', (event) => {
    event.preventDefault();
    runControl('join-tab');
  });

  bar.append(select, replayLink, second);
  game.append(bar);

  let run: ReturnType<typeof replayScenario> | undefined;
  let nextFrame = 0;
  let done = !autoplay;
  let replaying = autoplay && !scenario?.king;
  return {
    scene: scenario,
    sceneNames: Object.keys(scenarios),
    loadScene(name: string, replay: boolean) {
      const target = scenarioByName(name);
      if ((name && !target) || (replay && !target?.segments.length))
        return false;
      // Let a CLI command acknowledge the navigation before the tab reconnects.
      window.setTimeout(() => location.assign(sceneUrl(name, replay)), 100);
      return true;
    },
    joinTab() {
      window.open(second.href, '_blank', 'noopener');
      return true;
    },
    get replaying() {
      return replaying && !done;
    },
    step(time: number, collisions: CollisionScene, king: boolean) {
      if (done || !scenario) return false;
      if (scenario.king && !king) {
        if (run) done = true;
        return false;
      }
      replaying = true;
      if (collisions.stationCount < (scenario.stations ?? 0)) return true;
      if (!run) {
        player.reset(scenarioView(scenario));
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
