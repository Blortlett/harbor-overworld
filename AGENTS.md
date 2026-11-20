# Harbor Overworld

The `overworld` branch of `SomewhatJustin/harbor-overworld` ships the game from
`apps/harbor-overworld`. In Justin's workspace it is checked out as
`../harbor-overworld` beside the base Harbor checkout. Resolve the worktree
before editing or pushing.

- **Movement** starts at `src/world/movement.ts` in the app. Put reproducible
  starting positions and input sequences in `src/world/scenarios.ts`. Run
  `pnpm --filter harbor-overworld test:movement` and replay the same scene in
  the browser playground.
- **Multiplayer and noticeboards** use `server/presence.ts` and
  `server/plots.ts`. Run `pnpm --filter harbor-overworld test:presence`.
  It builds the standalone server and exercises it against a fixture feed.
- **Browser checks** use the [playground instructions](apps/harbor-overworld/README.md#playground).
- **Releases** use the [release workflow](.github/workflows/build-overworld.yml).
  Pushes to the public fork's `overworld` branch publish to the live host.
  Compare the deployed `/build.json` commit with the intended SHA.
