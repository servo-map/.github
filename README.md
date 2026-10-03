# servo-map/.github

Organisation profile and the tooling every ServoMap repository shares.

- `profile/README.md`: the organisation's public profile.
- `actions/setup`: the Node setup every repository's jobs run after checkout — pnpm from
  `packageManager`, Node from `.node-version`, a check that `engines` and `@types/node` name the same
  major, a frozen install, and (with `packages-token`) GitHub Packages auth for `@servo-map/*`.
  Reference it by commit SHA like any third-party action.
- `vendor/`: copies files one repository owns into another with recorded provenance (decision
  0015 in servo-map-core). A source repository lists its exports in `vendor.json` and calls
  `.github/workflows/vendor-sync.yml`; each target receives a pull request with the files, a
  `.vendor/<source>.json` lock and `.vendor/check.mjs`, which its CI runs to fail on a hand edit.

| Repository | Owns |
|---|---|
| `servo-map-core` | `@servo-map/shared`, the API and ingest Worker, the OpenAPI contract, catalogue assets (fuel brand logos, car images, map outlines), decisions |
| `servo-map-brand` | `@servo-map/design-tokens`, the app icon and mark, the design system spec |
| `servo-map-web` | the Next.js site at servo-map.com |
| `servo-map-ios` | the SwiftUI app |
| `servo-map-inbox` | the support inbox at inbox.servo-map.com, where every servo-map.com address arrives (a fork of jade-inbox; decision 0022 in servo-map-core) |
