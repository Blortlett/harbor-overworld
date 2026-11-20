import { HIT_LINES } from './presence-protocol';

export function createWorldAudio(onBlocked: (blocked: boolean) => void) {
  let context: AudioContext | undefined;
  let resuming: Promise<void> | undefined;
  const clips = new Map<string, Promise<AudioBuffer | undefined>>();
  let water = false;
  let waterGain: GainNode | undefined;
  let waterLoading = false;

  function load(audio: AudioContext, name: string) {
    const cached = clips.get(name);
    if (cached) return cached;
    const clip = (async () => {
      try {
        const response = await fetch(`/sounds/${name}.mp3`);
        if (response.ok)
          return await audio.decodeAudioData(await response.arrayBuffer());
      } catch {
        // A subsequent play can retry a failed audio request.
      }
      clips.delete(name);
    })();
    clips.set(name, clip);
    return clip;
  }

  function syncWater() {
    const audio = context;
    if (audio?.state !== 'running') return;
    if (waterGain) {
      waterGain.gain.setTargetAtTime(water ? 0.25 : 0, audio.currentTime, 0.14);
    } else if (water && !waterLoading) {
      waterLoading = true;
      void load(audio, 'shark-water').then((buffer) => {
        waterLoading = false;
        if (!buffer || audio.state !== 'running') return;
        const source = audio.createBufferSource();
        const gain = audio.createGain();
        source.buffer = buffer;
        source.loop = true;
        gain.gain.value = 0;
        source.connect(gain).connect(audio.destination);
        source.start();
        waterGain = gain;
        syncWater();
      });
    }
  }

  function update() {
    if (!context) return;
    onBlocked(context.state !== 'running');
    syncWater();
  }

  function unlock() {
    if (!globalThis.AudioContext) return;
    if (!context) {
      context = new AudioContext();
      context.addEventListener('statechange', update);
      void load(context, 'gunshot');
      void load(context, 'shark-scream');
      for (const index of HIT_LINES.keys()) void load(context, `hit-${index}`);
    }
    update();
    if (context.state !== 'running') {
      // A new gesture must be able to retry even if autoplay left a resume pending.
      const attempt = context.resume().catch(() => {});
      resuming = attempt;
      void attempt.then(() => {
        if (resuming === attempt) resuming = undefined;
        update();
      });
    }
  }

  function play(name: string, volume: number, delay = 0) {
    const audio = context;
    if (!audio || (audio.state !== 'running' && !resuming)) return;
    const receivedAt = performance.now();
    const when = audio.currentTime + delay;
    const ready = audio.state === 'running' ? undefined : resuming;
    void Promise.all([load(audio, name), ready]).then(([buffer]) => {
      if (
        !buffer ||
        audio.state !== 'running' ||
        performance.now() - receivedAt > 1500
      )
        return;
      const source = audio.createBufferSource();
      const gain = audio.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain).connect(audio.destination);
      source.start(Math.max(when, audio.currentTime));
    });
  }

  return {
    unlock,
    setSharkInWater(active: boolean) {
      if (water === active) return;
      water = active;
      syncWater();
    },
    playShot(line?: number, sharkHit = false) {
      play('gunshot', 0.85);
      if (sharkHit) play('shark-scream', 0.85, 0.12);
      else if (line !== undefined) play(`hit-${line}`, 0.8, 0.16);
    },
  };
}
