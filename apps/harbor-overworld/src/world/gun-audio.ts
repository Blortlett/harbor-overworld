import { HIT_LINES } from './presence-protocol';

export function createGunAudio() {
  let context: AudioContext | undefined;
  let resuming: Promise<void> | undefined;
  let blast: Promise<AudioBuffer | undefined> | undefined;
  let reactions: Promise<AudioBuffer | undefined>[] = [];

  async function load(audio: AudioContext, name: string) {
    try {
      const response = await fetch(`/sounds/${name}.mp3`);
      if (response.ok)
        return await audio.decodeAudioData(await response.arrayBuffer());
    } catch {
      return undefined;
    }
  }

  function unlock() {
    if (!globalThis.AudioContext) return;
    if (!context) {
      const audio = new AudioContext();
      context = audio;
      blast = load(audio, 'gunshot');
      reactions = HIT_LINES.map((_, index) => load(audio, `hit-${index}`));
    }
    if (context.state !== 'running' && !resuming) {
      resuming = context
        .resume()
        .catch(() => {})
        .finally(() => {
          resuming = undefined;
        });
    }
  }

  function playBuffer(
    audio: AudioContext,
    buffer: AudioBuffer,
    when: number,
    volume: number,
  ) {
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(audio.destination);
    source.start(when);
  }

  return {
    unlock,
    play(line?: number) {
      const audio = context;
      if (!audio || !blast || (audio.state !== 'running' && !resuming)) return;
      const receivedAt = performance.now();
      void Promise.all([blast, resuming]).then(([clip]) => {
        if (audio.state !== 'running' || performance.now() - receivedAt > 1000)
          return;
        const time = audio.currentTime;
        if (clip) playBuffer(audio, clip, time, 0.55);
        if (line !== undefined) {
          void reactions[line]?.then((reaction) => {
            if (reaction)
              playBuffer(
                audio,
                reaction,
                Math.max(time + 0.16, audio.currentTime),
                0.8,
              );
          });
        }
      });
    },
  };
}
