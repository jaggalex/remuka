# Contributing to remo

Thanks for taking the time. This repository values small, deliberate changes over large
surprises.

## Before you start

- Read [ADR.md](ADR.md) for the decisions that shape the product.
- For a behaviour or data-model change, add an ADR first. Code without an ADR is a draft.
- For a bug, open an issue with the reproduction and the expected result.
- For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setup

Requirements: Node 22, pnpm 11, Docker.

```sh
pnpm install
cp .env.example .env
pnpm db:up
pnpm sync
pnpm dev:web
```

## The gate

```sh
pnpm verify --e2e   # includes pnpm lint
pnpm audit:prod     # separate CI step, not part of verify
```

`pnpm verify` checks the dedicated test database (start it first with `pnpm test:db:up`),
typecheck, lint, unit and database tests, the build, documentation and the guide, and the
design-system checks. `--e2e` adds browser acceptance and the guide audit. A pull request is
ready only when it is green. Run `pnpm verify:fast` in the inner loop.

`pnpm lint` runs Biome with the hook-placement rule as an error; `pnpm lint:strict` also
fails on warnings. `pnpm audit:prod` fails on a high or critical production advisory only
when a fix exists; CI runs it as its own step.

## Tenant isolation

Production connects as `remo_app`, a DML-only role with no table ownership and no
`BYPASSRLS`; each tenant request sets `app.org_id`, and a query without it returns zero
rows. A change to a tenant table must keep that true.

```sh
pnpm db:rls:setup            # create the role once (owner URL)
pnpm db:rls:enable           # apply apps/sync/rls.sql (owner URL)
pnpm db:rls --check          # exit 1 on any tenant table without FORCE RLS
pnpm db:rls:enable --check   # the 37 protected tables
```

Run these with `REMO_MIGRATION_DATABASE_URL`; the owner must be a superuser or have
`BYPASSRLS`, or the security-definer lookups return no rows. The RLS suite creates its own
database on the test server (`pnpm test:db:up`) because `FORCE` takes an exclusive lock. The
inventory is not part of `pnpm verify`: run it after a schema change.

## Branches, stage and the release train

One trunk, short-lived task branches, and deployments by commit rather than by branch.
The canonical remote is `remuka`; `origin` (the old `remo.git`) is the mirror of the old name
and is never deployed from. `main` is the only long-lived branch and always passes the gate.

| Branch | For | Lives |
|---|---|---|
| `main` | the trunk; only green work reaches it | always |
| `t/<n>-<slug>` | one task from a plan (`t3-canvas-objects`, `t4-cardboard`) | days |
| `fix/<slug>` | a bug without a task | days |
| `release/<x.y>` | only fixes after the release is cut | until the next minor |
| `hotfix/<slug>` | an urgent fix from a tag | hours |

1. Branch from `main`, keep one reason to change per branch, run `pnpm verify --e2e`.
2. Open a pull request. CI runs the full gate and `audit:prod`; the merge is a **squash**,
   so one task is one commit and its ADR and tests travel with it. `build` counts commits,
   so it grows by one per delivered task.
3. **Stage deploys `main`.** The commit that passed CI is what both zones run:
   `REMO_DEPLOY_ENV_FILE=.config/remo/stage-ru.env.local bash deploy/release.sh`, then the
   same for `stage-eu`. The two zones must report the same commit on `/api/health`; the
   acceptance list is `spec/stage.md` §8.
4. **Production deploys a tag.** Acceptance on stage is followed by
   `pnpm release:minor --notes "…" --commit`, which creates the annotated tag on the tested
   commit; production checks that tag out (a detached HEAD is fine) and runs the same
   `deploy/release.sh` with the production env file. Build once, promote the same commit.
5. A hotfix starts from the tag (not from `main`'s tip), gets a patch tag and goes to
   production; the fix is then merged back into `main` so the trunk does not lag.

### Choosing the target

The environment file **is** the target; `deploy/release.sh` has no `--stage` flag. Keep one
private file per installation (template: `deploy/deploy.env.example`; mode 600, outside
Git) and pass it with `REMO_DEPLOY_ENV_FILE`:

| Target | Command |
|---|---|
| stage-ru | `REMO_DEPLOY_ENV_FILE=.config/remo/stage-ru.env.local bash deploy/release.sh` |
| stage-eu | `REMO_DEPLOY_ENV_FILE=.config/remo/stage-eu.env.local bash deploy/release.sh` |
| production | `git checkout v0.x.0 && bash deploy/release.sh` (reads `.config/remo/deploy.env`) |

Every run refuses a dirty tree and untracked source, runs `pnpm verify --e2e`, uploads the
exact commit, prepares the schema, switches `current` and checks `/api/health` (commit and
schema), the app and the guide. A stand file also carries `REMO_DEPLOY_HTTP_AUTH` for the
basic-auth checks. Deploy the two stage zones one after the other from the same commit, and
deploy production only from a tag.

Rollback is a server command, not a release: `ssh deploy@<host> /srv/<instance>/remo
rollback --schema-compatible` returns to the previous release after its own backup; the
schema check is a person's decision, so the flag is required.

Rules around the train:

- `main` is protected: a pull request, a green CI, linear history, no force-push; tags are
  protected too. Nobody pushes to `main` directly.
- `deploy/release.sh` already refuses an unclean tree and runs `pnpm verify --e2e`; a deploy
  of an uncommitted or untested checkout is not a shortcut, it is a rollback.
- A schema change bumps `schema` in the same pull request; when a tenant table changes, run
  `pnpm db:rls --check` before the stage deploy.
- Commit subjects read `type(scope): summary`; the body names the ADR and the task (`T3`).
- Agents commit only on a `t/<n>` branch and only when the owner asks; merges, tags and
  pushes belong to the owner.
- The old local checkout `initial` (tracking `remuka/main`) becomes `main`; the stale local
  `main` at 0.4.1 is renamed or removed so the name means one thing.

## Versioning and releases

Three numbers, never mixed: `version` is the semver release in `package.json`, `build` is
the git commit count, `schema` is the database compatibility version. The app, `/api/health`
and `remo_build_info` report all three.

```sh
pnpm version:show
pnpm release:minor --notes "what changed for a user" --commit
```

Ordinary commits do not change the version; `build` grows with git history. A release
updates `package.json`, `README.md` and `CHANGELOG.md`, runs `pnpm verify`, commits and
creates an annotated tag — it does not push. The deploy passes the same values to Docker.

## Rules that reviewers enforce

- **One job, one mechanism.** A second way to do the same thing is a defect. Propose an
  ADR if the second way is genuinely needed.
- **Access is decided on a room.** A role is granted on a room; there are no per-object
  permissions.
- **UI in Russian and English.** Every user-visible string goes through `i18n.tsx`; a key
  without both languages fails `tsc`.
- **Tokens only.** No literal colours or sizes in UI components; use `@remo/ui` tokens.
- **Mutations go through commands.** The sync service checks permission and writes audit.
- **Tests stay close to the code.** A model change gets a unit test next to it; a browser
  scenario belongs in `e2e/` when the bug can only be seen in a browser.
- **Documentation is part of the change.** Update `content/help` for a user-facing change
  and `guide/` when a workflow changes. `pnpm docs:check` and `pnpm guide:check` must pass.

## Pull requests

- Keep the diff focused; explain the problem and the decision, not only the code.
- Use the pull-request template and fill in the verification you ran.
- New dependencies need a reason; prefer the standard library and existing packages.
- Do not commit secrets, database dumps, `.env` files or generated test artefacts.

## Licence

By contributing you agree that your contribution is licensed under
[AGPL-3.0-only](LICENSE).

## Trying the room agent locally

The room agent needs an assigned agent, an enabled organisation and a provider. For a
local run without a key, the deterministic demo model answers both MVP scenarios:

```sh
pnpm db:up
pnpm demo:seed          # account, organisation, agent "Мира" and a room with notes
REMO_DEMO=1 pnpm sync   # terminal 1: the fake model is explicitly non-production
pnpm dev                # terminal 2
```

Open `http://localhost:5173/?room=demo-mvp` and sign in as `demo@remo.local` with
`remo-demo-2026`. The room agent panel has the two scenarios and a note that the demo
answers are fixed examples. Run the seed before `pnpm sync` starts: the service keeps a
loaded room in memory and would write it back over a replaced snapshot.

To use a real model, configure a provider key in Organisation → Agents and start the
service without `REMO_DEMO`.
