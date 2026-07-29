# Fork maintenance

This repository is a personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).
All customizations live as a small stack of commits on the single long-lived branch
**`fork`**, sitting directly on top of exactly one upstream release tag (stable `v*`
or nightly `v*-nightly.*`).

- `origin` = `git@github.com:romario333/t3code.git` (this fork)
- `upstream` = `git@github.com:pingdotgg/t3code.git` (official)

Do **not** create per-version branches. The old `custom/stable` / `custom/nightly`
pair is retired; their final states are pinned by tags `fork-v0.0.28` and
`fork-v0.0.29-nightly.20260727.915`.

## Invariants

1. `fork` = one upstream tag + the patch stack, nothing else. The current base tag
   is recorded in `build.sh` (`UPSTREAM_BASE=...`) and always matches
   `git merge-base fork upstream/main`.
2. Each customization is its own small commit so conflicts are attributable and a
   patch can be dropped cleanly once upstream absorbs it.
3. Before every move to a new base, the old tip is tagged `fork-<old-base>` and
   pushed to origin, so the previously running state can always be rebuilt exactly.
4. Never edit `package.json` version fields — checked-in versions are placeholders
   that get stamped at build time (`build.sh` passes `--build-version`).
5. New customizations are committed on `fork` (directly or via feature worktrees
   that are then rebased/cherry-picked onto `fork`).

## Moving to a new upstream version ("port")

```sh
git fetch upstream --tags

# 1. Identify the base tag the stack currently sits on
OLD_BASE=$(git describe --tags --exact-match "$(git merge-base fork upstream/main)")

# 2. Pin the current state for rollback BEFORE touching anything
git tag "fork-${OLD_BASE}" fork
git push origin "fork-${OLD_BASE}"

# 3. Rebase the stack onto the new tag (prefer stable v* tags)
git rebase --onto <NEW_TAG> "${OLD_BASE}" fork
# ...resolve conflicts; see "Conflict guidance" below

# 4. Repoint build.sh at the new base and fold it into its existing commit
#    Edit UPSTREAM_BASE="..." in build.sh to <NEW_TAG>, then:
git add build.sh
git commit --no-verify --fixup="$(git log -1 --format=%H --grep='^Add build.sh helper' fork)"
GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <NEW_TAG>

# 5. Verify
pnpm install
pnpm typecheck
pnpm test

# 6. Publish (force push is expected — the branch was rebased)
git push --force-with-lease origin fork
```

### Conflict guidance

- Before replaying, check whether upstream already absorbed a patch (it has
  happened: the "auto" runtime mode, Codex `auto_review`, and Opus 5 support all
  landed upstream). If a patch is now redundant, drop it (`git rebase --skip`
  when it conflicts, or remove it from the stack) rather than forcing it in.
- The chat/web UI area is upstream's hottest code — expect conflicts there and
  re-place the patch's intent in the refactored code instead of restoring old
  context lines.
- The pre-commit hook (`vp fmt` via lint-staged) fails on files it has no
  formatter target for (e.g. `build.sh`); use `git commit --no-verify` for those.

## Rollback

Every `fork-<base>` tag is an immutable snapshot of the full stack as it last ran
on that base:

```sh
git log --oneline fork-<base>        # inspect
git checkout fork-<base> && ./build.sh   # rebuild the old state without moving the branch
# or move the branch back entirely:
git checkout fork && git reset --hard fork-<base>
```

Keeping the old `.dmg` around allows instant rollback without rebuilding.

## Building

```sh
./build.sh       # desktop dmg (arm64) -> release/, versioned <base>-auto.1
./build.sh 3     # bump the build number when rebuilding on the same base
# CLI:
T3CODE_UPSTREAM_BASE=<base-tag> node apps/server/scripts/cli.ts build && npm i -g ./apps/server
```

`T3CODE_UPSTREAM_BASE` drives the in-app "new upstream release" sidebar pill;
`build.sh` keeps it in sync with the actual base automatically.

## Watching for new upstream versions

Upstream cuts GitHub Releases only for stable tags (nightlies are tags without a
Release). Watch pingdotgg/t3code with **Watch → Custom → Releases**, or poll the
`releases.atom` feed. The self-built app also shows an in-app pill when a newer
stable is out. Auto-update in self-built apps is inert by design — every new
version means: port, rebuild, reinstall.
