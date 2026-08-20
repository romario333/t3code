#!/usr/bin/env bash
# Remove T3 Code worktrees that are no longer in use, across every project.
#
# Usage: prune-worktrees.sh [--yes] [--all] [project]
#
#   --yes      actually remove (default is a dry run) and report freed disk space
#   --all      also consider worktrees outside the T3 worktree directory, such as
#              Conductor workspaces and hand-made sibling checkouts
#   project    limit the scan to one project, by title, path, or directory name
#
# A worktree is removed only when all of these hold:
#   1. it is not the repository's primary checkout,
#   2. it has a branch checked out, so removing it strands no commits,
#   3. its working tree is clean (no modified, staged, or untracked files),
#   4. no running process has its cwd inside it,
#   5. the T3 thread that owns it is archived or gone from the T3 database.
#
# Branches are never touched, so the commits stay reachable after removal.

set -euo pipefail

T3_HOME="${T3CODE_HOME:-$HOME/.t3}"
DB="$T3_HOME/userdata/state.sqlite"
WORKTREE_ROOT="$T3_HOME/worktrees"
APPLY=false
ALL=false
FILTER=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes) APPLY=true ;;
    -a|--all) ALL=true ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) FILTER="$arg" ;;
  esac
done

command -v sqlite3 >/dev/null || { echo "sqlite3 not found" >&2; exit 1; }
[ -f "$DB" ] || { echo "T3 database not found at $DB" >&2; exit 1; }

query() { sqlite3 "file:$DB?mode=ro" "$1"; }

# Worktree paths owned by a thread that is still live (not archived, not deleted).
ACTIVE=$(query "select worktree_path from projection_threads
                where worktree_path is not null and archived_at is null and deleted_at is null;")

# Current working directory of every running process, one absolute path per line.
CWDS=$(lsof -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')

# True when any running process sits inside the given directory.
in_use() { awk -v p="$1" 'index($0, p "/") == 1 || $0 == p { found = 1 } END { exit !found }' <<<"$CWDS"; }

# Free bytes on the filesystem holding the T3 home.
free_bytes() { df -k "$T3_HOME" | awk 'NR == 2 { print $4 * 1024 }'; }

human() { awk -v b="$1" 'BEGIN {
  split("B KB MB GB TB", u, " "); i = 1
  while (b >= 1024 && i < 5) { b /= 1024; i++ }
  printf (i > 2 ? "%.1f %s\n" : "%d %s\n"), b, u[i]
}'; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Several projects can point at the same repository, one per linked worktree, so
# group them by shared git directory and scan each repository exactly once.
while IFS=$'\t' read -r root title; do
  [ -n "$root" ] || continue
  gitdir=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
  printf '%s\t%s\t%s\n' "$gitdir" "$root" "$title" >> "$tmp/projects"
done < <(query "select distinct workspace_root || char(9) || title from projection_projects
                where workspace_root is not null order by title;")

awk -F'\t' '!seen[$1]++ { root[$1] = $2 }
  { titles[$1] = titles[$1] ? titles[$1] ", " $3 : $3 }
  END { for (g in root) print root[g] "\t" titles[g] }' "$tmp/projects" | sort > "$tmp/repos"

$APPLY && before=$(free_bytes)
removed=0 skipped=0 scanned=0

while IFS=$'\t' read -r repo titles; do
  if [ -n "$FILTER" ]; then
    match=false
    [ "$repo" = "$FILTER" ] && match=true
    [ "$(basename "$repo")" = "$FILTER" ] && match=true
    while IFS= read -r t; do [ "$t" = "$FILTER" ] && match=true; done < <(tr ',' '\n' <<<"$titles" | sed 's/^ *//')
    $match || continue
  fi
  scanned=$((scanned + 1))
  primary=""
  any=false

  while read -r line; do
    wt="${line%% *}"
    [[ "$line" == *"(bare)"* ]] && continue
    # git lists the repository's primary checkout first; never remove that one.
    if [ -z "$primary" ]; then primary="$wt"; continue; fi
    $ALL || [[ "$wt" == "$WORKTREE_ROOT"/* ]] || continue

    if branch=$(git -C "$wt" symbolic-ref --short -q HEAD 2>/dev/null); then
      reason=""
    else
      branch="detached HEAD"
      reason="no branch, removing it would strand its commits"
    fi

    if [ -n "$reason" ]; then :
    elif ! status=$(git -C "$wt" status --porcelain 2>&1); then
      reason="cannot read its status: ${status%%$'\n'*}"
    elif [ -n "$status" ]; then
      reason="uncommitted changes"
    elif in_use "$wt"; then
      reason="a running process is inside it"
    elif grep -Fxq "$wt" <<<"$ACTIVE"; then
      reason="owned by a live T3 thread"
    fi

    $any || { printf '\n%s  (%s)\n' "$titles" "$repo"; any=true; }

    if [ -n "$reason" ]; then
      printf '  skip    %-40s %s (%s)\n' "$(basename "$wt")" "$reason" "$branch"
      skipped=$((skipped + 1))
      continue
    fi

    if $APPLY; then
      git -C "$repo" worktree remove "$wt"
      printf '  removed %-40s %s\n' "$(basename "$wt")" "$branch"
    else
      printf '  remove  %-40s %s\n' "$(basename "$wt")" "$branch"
    fi
    removed=$((removed + 1))
  done < <(git -C "$repo" worktree list)

  $any && $APPLY && git -C "$repo" worktree prune
done < "$tmp/repos"

if [ "$scanned" -eq 0 ]; then
  echo "no matching project${FILTER:+ for \"$FILTER\"}" >&2
  exit 1
fi

echo
if $APPLY; then
  after=$(free_bytes)
  echo "removed $removed worktree(s), kept $skipped across $scanned project(s). Branches are unchanged."
  echo "free space: $(human "$before") -> $(human "$after")  (+$(human $((after - before))))"
else
  echo "$removed removable, $skipped kept across $scanned project(s). Re-run with --yes to remove them."
fi
