# servo-map/.github

Organisation profile and the tooling every Servo Map repository shares.

- `profile/README.md`: the organisation's public profile.
- `actions/setup`: the Node setup every repository's jobs run after checkout — pnpm from
  `packageManager`, Node from `.node-version`, a check that `engines` and `@types/node` name the same
  major, a frozen install, and (with `packages-token`) GitHub Packages auth for `@servo-map/*`.
  Reference it by commit SHA like any third-party action.
- `vendor/`: copies files one repository owns into another with recorded provenance (decision
  0015 in servo-map-core). A source repository lists its exports in `vendor.json` and calls
  `.github/workflows/vendor-sync.yml`; each target receives a pull request with the files, a
  `.vendor/<source>.json` lock and `.vendor/check.mjs`, which its CI runs to fail on a hand edit.

## Vendor sync

A source repository's `vendor.json` maps each target repository to `{ "from", "to" }` pairs, and its
caller workflow pins the reusable workflow by commit SHA:

```yaml
jobs:
  sync:
    uses: servo-map/.github/.github/workflows/vendor-sync.yml@<sha> # main
    with:
      app-client-id: ${{ vars.APP_CLIENT_ID }}
      tooling-ref: <sha> # the same commit as the line above
    secrets:
      APP_PRIVATE_KEY: ${{ secrets.APP_PRIVATE_KEY }}
```

- **Targets come from `vendor.json`.** The workflow's first job reads the keys of `targets` and the
  sync runs once per key. There is no `targets` input: a caller that still passes one fails to start.
- **`tooling-ref` is the pinned commit.** A reusable workflow cannot read its own commit (its
  `github` context is the caller's), so the caller passes it. The run fails unless it is a full
  40-character SHA and the caller's workflow file pins `vendor-sync.yml` at that same SHA;
  `vendor/sync.mjs` and `vendor/check.mjs` are then checked out at it rather than at `main`. Move
  both lines together.
- **The lock.** `.vendor/<source>.json` records `source`, `commit` and `files` (path to SHA-256,
  sorted), plus `tooling`, the SHA-256 of the `.vendor/check.mjs` that sync installed. The check
  fails on an edited or missing vendored file, and on a `.vendor/check.mjs` that no lock records.
  One matching lock is enough, because two sources may pin different commits of this repository.
  A lock written before `tooling` existed keeps passing and gains the key at its source's next sync.

## Node major check

`actions/setup/check-node-version.mjs` compares `.node-version` with the root `package.json`
(`engines.node` and `@types/node`) and with `@types/node` in every workspace package. The packages
are the `packages:` entries of `pnpm-workspace.yaml` (names, `*`, `**` and `!` exclusions); a
repository without that list has only its root checked.

## Checks

`.github/workflows/ci.yml` runs on pull requests and on `main`:

```sh
node --test                          # vendor/ and actions/setup, on the Node in .node-version
actionlint .github/workflows/*.yml
```

The tests run the scripts as processes on temporary directories and need no install.

| Repository | Owns |
|---|---|
| `servo-map-core` | `@servo-map/shared`, the API and ingest Worker, the OpenAPI contract, catalogue assets (fuel brand logos, car images, map outlines), decisions |
| `servo-map-brand` | `@servo-map/design-tokens`, the app icon and mark, the design system spec |
| `servo-map-web` | the Next.js site at servo-map.com |
| `servo-map-ios` | the SwiftUI app |
| `servo-map-inbox` | the support inbox at inbox.servo-map.com, where every servo-map.com address arrives (a fork of jade-inbox; decision 0022 in servo-map-core) |
