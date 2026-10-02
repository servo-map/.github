# servo-map/.github

Organisation profile and the tooling every ServoMap repository shares.

- `profile/README.md`: the organisation's public profile.
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
