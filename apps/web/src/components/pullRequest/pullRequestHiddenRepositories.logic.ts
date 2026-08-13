import type { EnvironmentId } from "@t3tools/contracts";

import { repositoryKey, type AssignableProject } from "./pullRequestProjectAssignment.logic";

/** A project with enough of its identity to name the repository it is a copy of. */
export interface HideableProject extends AssignableProject {
  readonly workspaceRoot: string;
  readonly repositoryIdentity?:
    | {
        readonly canonicalKey?: string | undefined;
        readonly owner?: string | undefined;
        readonly name?: string | undefined;
        readonly displayName?: string | undefined;
      }
    | null
    | undefined;
}

/** One repository the list could read, as the menu that hides it names it. */
export interface PullRequestRepositoryChoice {
  readonly key: string;
  readonly label: string;
  /** A project holding this repository, which is where its favicon is read from. */
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string;
}

/**
 * The repositories behind the workspace's projects, one entry each: worktrees and second copies
 * on another server are the same repository, and hiding it is one decision rather than one per
 * checkout. A project with no repository identity is left out — there is nothing to hide it by,
 * and nothing the listing could exclude on its behalf.
 */
export function pullRequestRepositoryChoices(
  projects: ReadonlyArray<HideableProject>,
): ReadonlyArray<PullRequestRepositoryChoice> {
  const byKey = new Map<string, PullRequestRepositoryChoice>();
  for (const project of projects) {
    const key = repositoryKey(project);
    if (key === undefined || byKey.has(key)) continue;
    const identity = project.repositoryIdentity;
    const label =
      identity?.owner && identity.name
        ? `${identity.owner}/${identity.name}`
        : (identity?.displayName ?? key);
    byKey.set(key, {
      key,
      label,
      environmentId: project.environmentId,
      workspaceRoot: project.workspaceRoot,
    });
  }
  return [...byKey.values()].toSorted((left, right) => left.label.localeCompare(right.label));
}

/**
 * The projects the hosts may be asked about. Dropping a hidden repository here rather than
 * filtering its rows afterwards is the point of the setting: a repository nobody asked about
 * costs no search qualifier, no round trip and no rate limit.
 */
export function visiblePullRequestProjects<Project extends AssignableProject>(
  projects: ReadonlyArray<Project>,
  hiddenRepositoryKeys: ReadonlySet<string>,
): ReadonlyArray<Project> {
  if (hiddenRepositoryKeys.size === 0) return projects;
  return projects.filter((project) => {
    const key = repositoryKey(project);
    return key === undefined || !hiddenRepositoryKeys.has(key);
  });
}

/** How a row names the project it was read from, which is only unique within its own server. */
export function environmentProjectKey(entry: {
  readonly environmentId: string;
  readonly projectId: string;
}): string {
  return `${entry.environmentId}#${entry.projectId}`;
}

/**
 * The projects whose rows belong to a hidden repository. Nothing new is read from them, so this
 * is for the rows that arrived before it was hidden — the stored snapshot, and the rows the page
 * holds while the next answer travels — which would otherwise stay on screen until it lands.
 */
export function hiddenPullRequestProjectKeys(
  projects: ReadonlyArray<AssignableProject>,
  hiddenRepositoryKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  if (hiddenRepositoryKeys.size === 0) return new Set();
  const keys = new Set<string>();
  for (const project of projects) {
    const key = repositoryKey(project);
    if (key !== undefined && hiddenRepositoryKeys.has(key)) {
      keys.add(
        environmentProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      );
    }
  }
  return keys;
}
