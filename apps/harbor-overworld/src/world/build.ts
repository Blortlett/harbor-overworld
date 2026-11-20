declare const __OVERWORLD_BUILD__: string;

export const BUILD_COMMIT =
  typeof __OVERWORLD_BUILD__ === 'string' ? __OVERWORLD_BUILD__ : '';

const RESUME_BUILD_KEY = 'harbor-overworld.resume-after-build';

export function shouldRejoinWorld() {
  try {
    if (
      !BUILD_COMMIT ||
      sessionStorage.getItem(RESUME_BUILD_KEY) !== BUILD_COMMIT
    )
      return false;
    sessionStorage.removeItem(RESUME_BUILD_KEY);
    return true;
  } catch {
    return false;
  }
}

export function watchWorldUpdates(isPlaying: () => boolean) {
  if (!BUILD_COMMIT) return;

  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    try {
      const response = await fetch('/build.json', {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return;

      const { commit } = await response.json();
      if (
        typeof commit === 'string' &&
        /^[a-f0-9]{40}$/.test(commit) &&
        commit !== BUILD_COMMIT
      ) {
        if (isPlaying()) {
          try {
            sessionStorage.setItem(RESUME_BUILD_KEY, commit);
          } catch {
            // The build can still reload when tab storage is unavailable.
          }
        }
        location.reload();
      }
    } catch {
      // The host can be temporarily unavailable during the release.
    } finally {
      checking = false;
    }
  }

  window.setInterval(check, 15_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void check();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void check();
  });
  void check();
}
