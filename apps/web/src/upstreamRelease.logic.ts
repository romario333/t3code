import { parseSemver } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

/**
 * Upstream repository this fork tracks. The GitHub "latest release" endpoint only
 * returns published, non-prerelease releases, so nightlies (which are plain tags,
 * not Releases) never appear here — it is a clean stable-only signal.
 */
export const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
export const UPSTREAM_LATEST_RELEASE_ENDPOINT = `https://api.github.com/repos/${UPSTREAM_REPOSITORY}/releases/latest`;

export interface UpstreamRelease {
  /** Release tag, e.g. "v0.0.29". */
  readonly tag: string;
  /** URL of the release notes on GitHub. */
  readonly url: string;
}

const GithubLatestReleaseSchema = Schema.Struct({
  tag_name: Schema.String,
  html_url: Schema.String,
});

const decodeGithubLatestRelease = Schema.decodeUnknownSync(GithubLatestReleaseSchema);

/**
 * Parse the GitHub `releases/latest` response into the fields we surface. Returns
 * null on any shape we do not recognize so a malformed/error payload is ignored
 * rather than shown as a bogus release.
 */
export function parseUpstreamRelease(raw: unknown): UpstreamRelease | null {
  try {
    const decoded = decodeGithubLatestRelease(raw);
    const tag = decoded.tag_name.trim();
    const url = decoded.html_url.trim();
    if (tag.length === 0 || url.length === 0) {
      return null;
    }
    return { tag, url };
  } catch {
    return null;
  }
}

/**
 * Whether `releaseTag` names a newer stable than the build's base.
 *
 * Compares only the numeric major.minor.patch and deliberately ignores any
 * prerelease suffix: the fork stamps its base as e.g. `0.0.28-auto.3`, which
 * standard semver would rank *below* the upstream `0.0.28` tag it is built on —
 * the opposite of what we mean. Upstream stable tags never carry a prerelease, so
 * a numeric comparison is the correct signal. Returns false if either side is not
 * valid semver, to avoid a false positive from the lexical fallback in
 * {@link compareSemverVersions}.
 */
export function isUpstreamReleaseNewer(baseVersion: string, releaseTag: string): boolean {
  const base = parseSemver(baseVersion);
  const release = parseSemver(releaseTag);
  if (!base || !release) {
    return false;
  }
  if (release.major !== base.major) {
    return release.major > base.major;
  }
  if (release.minor !== base.minor) {
    return release.minor > base.minor;
  }
  return release.patch > base.patch;
}

export const UPSTREAM_RELEASE_DISMISSALS_STORAGE_KEY = "t3code:upstream-release-dismissals:v1";

const UpstreamReleaseDismissalsSchema = Schema.Struct({
  tags: Schema.Array(Schema.String),
});

type UpstreamReleaseDismissals = typeof UpstreamReleaseDismissalsSchema.Type;

function readUpstreamReleaseDismissals(): UpstreamReleaseDismissals {
  try {
    return (
      getLocalStorageItem(
        UPSTREAM_RELEASE_DISMISSALS_STORAGE_KEY,
        UpstreamReleaseDismissalsSchema,
      ) ?? { tags: [] }
    );
  } catch (error) {
    console.error("Could not read upstream-release dismissals.", error);
    return { tags: [] };
  }
}

function writeUpstreamReleaseDismissals(document: UpstreamReleaseDismissals): void {
  try {
    setLocalStorageItem(
      UPSTREAM_RELEASE_DISMISSALS_STORAGE_KEY,
      document,
      UpstreamReleaseDismissalsSchema,
    );
  } catch (error) {
    console.error("Could not persist upstream-release dismissals.", error);
  }
}

export function isUpstreamReleaseDismissed(tag: string | null | undefined): boolean {
  if (!tag) {
    return false;
  }
  return readUpstreamReleaseDismissals().tags.includes(tag);
}

export function dismissUpstreamRelease(tag: string | null | undefined): void {
  if (!tag) {
    return;
  }
  const document = readUpstreamReleaseDismissals();
  if (document.tags.includes(tag)) {
    return;
  }
  writeUpstreamReleaseDismissals({ tags: [...document.tags, tag] });
}
