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
- `.github/workflows/actionlint.yml`: the workflow lint every repository runs, this one included.
  It owns the actionlint version and the action's commit, so neither is copied into a caller.

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
- **Trigger paths are checked against `vendor.json`.** A trigger cannot be computed, so the caller's
  `on.push.paths` restates the `from` entries by hand. The first job runs `vendor/trigger-paths.mjs`
  on the caller's workflow file and fails, naming them, when a `from` path is not covered: a file
  must match the filter, and a directory must match at any depth (`exports/**`, not `exports/*`).
  Patterns are read as GitHub reads them, later `!` exclusions included. A caller without a push
  trigger, or with a push trigger and no `paths`, passes.
- **The lock.** `.vendor/<source>.json` records `source`, `commit` and `files` (path to SHA-256,
  sorted), plus `tooling`, the SHA-256 of the `.vendor/check.mjs` that sync installed. The check
  fails on an edited or missing vendored file, and on a `.vendor/check.mjs` that no lock records.
  One matching lock is enough, because two sources may pin different commits of this repository.
  A lock written before `tooling` existed keeps passing and gains the key at its source's next sync.
- **One lock per vendored path.** Before writing, a sync reads the target's other locks. A lock of
  the same repository under a longer name (`servo-map-core.shared-tests.json`, left by a hand run of
  `sync.mjs` before the workflow targeted that repository) gives up the paths the sync now records
  and is deleted once it records none; otherwise it would keep the old hashes and fail the check at
  the next change. A lock of another repository naming a path the sync would write is two owners for
  one file: the sync fails, naming both, and changes nothing.

## Workflow lint

A repository calls the reusable workflow from its own `.github/workflows/actionlint.yml`, pinned by
commit SHA, and keeps its triggers, permissions and concurrency there:

```yaml
jobs:
  actionlint:
    uses: servo-map/.github/.github/workflows/actionlint.yml@<sha> # main
```

- **One owner for the versions.** The actionlint version and the `raven-actions/actionlint` commit
  are written in the reusable workflow only. Dependabot moves the action here; a caller moves its
  pin.
- **`runs-on`** is a JSON array of runner labels and defaults to `["ubicloud-standard-2"]`, the
  private repositories' runner (the job holds a read-only token). This repository is public and
  passes `'["ubuntu-latest"]'` from `ci.yml`, which calls the workflow by its local path.
- **Runner labels stay with the caller.** The job checks out the calling repository, so its
  `.github/actionlint.yaml` applies: each repository declares there the labels its own workflows
  use and actionlint does not know (`ubicloud-standard-2`; `xcode-27` in servo-map-ios).
- **Check name.** GitHub names a called job `<caller job id> / <called job name>`: with the job id
  `actionlint` the check is `actionlint / Lint workflows`.

## Node major check

`actions/setup/check-node-version.mjs` compares `.node-version` with the root `package.json`
(`engines.node` and `@types/node`) and with `@types/node` in every workspace package. The packages
are the `packages:` entries of `pnpm-workspace.yaml` (names, `*`, `**` and `!` exclusions); a
repository without that list has only its root checked.

## Checks

`.github/workflows/ci.yml` runs on pull requests and on `main`:

```sh
node --test                          # vendor/ and actions/setup, on the Node in .node-version
actionlint .github/workflows/*.yml   # the reusable actionlint.yml, called locally
```

The tests run the scripts as processes on temporary directories and need no install.

| Repository | Owns |
|---|---|
| `servo-map-core` | `@servo-map/shared`, the API and ingest Worker, the OpenAPI contract, catalogue assets (fuel brand logos, car images, map outlines), decisions |
| `servo-map-brand` | `@servo-map/design-tokens`, the app icon and mark, the design system spec |
| `servo-map-web` | the Next.js site at servo-map.com |
| `servo-map-ios` | the SwiftUI app |
| `servo-map-inbox` | the support inbox at inbox.servo-map.com, where every servo-map.com address arrives (a fork of jade-inbox; decision 0022 in servo-map-core) |
