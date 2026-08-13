import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  hiddenPullRequestProjectKeys,
  pullRequestRepositoryChoices,
  visiblePullRequestProjects,
  type HideableProject,
} from "./pullRequestHiddenRepositories.logic";

const project = (
  id: string,
  environmentId: string,
  identity?: { canonicalKey: string; owner?: string; name?: string; displayName?: string },
): HideableProject => ({
  id: id as ProjectId,
  environmentId: environmentId as EnvironmentId,
  repositoryIdentity: identity ?? null,
  workspaceRoot: `/srv/${environmentId}/${id}`,
});

const github = (owner: string, name: string) => ({
  canonicalKey: `github.com/${owner}/${name}`,
  owner,
  name,
});

describe("repositories offered for hiding", () => {
  it("names each repository once, whatever it is checked out as", () => {
    const choices = pullRequestRepositoryChoices([
      project("app", "env-1", github("acme", "app")),
      project("app-worktree", "env-1", github("acme", "app")),
      project("app-elsewhere", "env-2", github("acme", "app")),
      project("site", "env-1", github("acme", "site")),
    ]);
    expect(choices.map((choice) => choice.label)).toEqual(["acme/app", "acme/site"]);
    expect(choices[0]?.workspaceRoot).toBe("/srv/env-1/app");
  });

  it("leaves out a project with no repository to hide", () => {
    expect(pullRequestRepositoryChoices([project("scratch", "env-1")])).toEqual([]);
  });

  it("falls back to the remote when the host did not name an owner", () => {
    const choices = pullRequestRepositoryChoices([
      project("app", "env-1", { canonicalKey: "git.acme.dev/team/app" }),
    ]);
    expect(choices[0]?.label).toBe("git.acme.dev/team/app");
  });
});

describe("hidden repositories are never asked about", () => {
  const projects = [
    project("app", "env-1", github("acme", "app")),
    project("app-worktree", "env-1", github("acme", "app")),
    project("site", "env-1", github("acme", "site")),
    project("scratch", "env-1"),
  ];

  it("drops every checkout of a hidden repository", () => {
    const visible = visiblePullRequestProjects(projects, new Set(["github.com/acme/app"]));
    expect(visible.map((candidate) => candidate.id)).toEqual(["site", "scratch"]);
  });

  it("keeps a project whose repository is unknown, since nothing hid it", () => {
    const visible = visiblePullRequestProjects(projects, new Set(["github.com/acme/other"]));
    expect(visible).toEqual(projects);
  });

  it("returns the projects untouched when nothing is hidden", () => {
    expect(visiblePullRequestProjects(projects, new Set())).toBe(projects);
  });
});

describe("rows read before a repository was hidden", () => {
  it("names the projects whose rows must go, per server", () => {
    const keys = hiddenPullRequestProjectKeys(
      [
        project("app", "env-1", github("acme", "app")),
        project("app", "env-2", github("acme", "app")),
        project("site", "env-1", github("acme", "site")),
      ],
      new Set(["github.com/acme/app"]),
    );
    expect([...keys].toSorted()).toEqual(["env-1#app", "env-2#app"]);
  });

  it("names nothing while nothing is hidden", () => {
    expect(
      hiddenPullRequestProjectKeys([project("app", "env-1", github("acme", "app"))], new Set())
        .size,
    ).toBe(0);
  });
});
