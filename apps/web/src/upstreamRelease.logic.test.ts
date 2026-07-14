import { describe, expect, it } from "vite-plus/test";

import {
  dismissUpstreamRelease,
  isUpstreamReleaseDismissed,
  isUpstreamReleaseNewer,
  parseUpstreamRelease,
} from "./upstreamRelease.logic";

describe("parseUpstreamRelease", () => {
  it("extracts the tag and url from a GitHub latest-release payload", () => {
    expect(
      parseUpstreamRelease({
        tag_name: "v0.0.29",
        html_url: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.29",
        name: "T3 Code v0.0.29",
        prerelease: false,
      }),
    ).toEqual({
      tag: "v0.0.29",
      url: "https://github.com/pingdotgg/t3code/releases/tag/v0.0.29",
    });
  });

  it("returns null for missing fields, wrong types, and non-objects", () => {
    expect(parseUpstreamRelease({ tag_name: "v0.0.29" })).toBeNull();
    expect(parseUpstreamRelease({ tag_name: 29, html_url: "https://x" })).toBeNull();
    expect(parseUpstreamRelease(null)).toBeNull();
    expect(parseUpstreamRelease("not-json")).toBeNull();
    expect(parseUpstreamRelease({ message: "Not Found" })).toBeNull();
  });

  it("returns null when the tag or url is blank", () => {
    expect(parseUpstreamRelease({ tag_name: "  ", html_url: "https://x" })).toBeNull();
    expect(parseUpstreamRelease({ tag_name: "v0.0.29", html_url: "   " })).toBeNull();
  });
});

describe("isUpstreamReleaseNewer", () => {
  it("is true only when the release is strictly newer than the base", () => {
    expect(isUpstreamReleaseNewer("v0.0.28", "v0.0.29")).toBe(true);
    expect(isUpstreamReleaseNewer("0.0.28", "v0.0.29")).toBe(true);
    expect(isUpstreamReleaseNewer("v0.0.28", "v0.0.28")).toBe(false);
    expect(isUpstreamReleaseNewer("v0.0.29", "v0.0.28")).toBe(false);
  });

  it("ignores the fork's prerelease suffix when comparing the base", () => {
    // The build stamps e.g. 0.0.28-auto.3; its numeric base is still 0.0.28.
    expect(isUpstreamReleaseNewer("0.0.28-auto.3", "v0.0.29")).toBe(true);
    expect(isUpstreamReleaseNewer("0.0.28-auto.3", "v0.0.28")).toBe(false);
  });

  it("returns false when either side is not valid semver", () => {
    expect(isUpstreamReleaseNewer("nightly", "v0.0.29")).toBe(false);
    expect(isUpstreamReleaseNewer("v0.0.28", "not-a-version")).toBe(false);
    expect(isUpstreamReleaseNewer("", "v0.0.29")).toBe(false);
  });
});

describe("upstream release dismissals", () => {
  it("is not dismissed until dismissed, then persists for that tag", () => {
    const tag = "v9.9.1-dismissal-test";
    expect(isUpstreamReleaseDismissed(tag)).toBe(false);
    dismissUpstreamRelease(tag);
    expect(isUpstreamReleaseDismissed(tag)).toBe(true);
  });

  it("dismissing one tag does not dismiss another", () => {
    const dismissed = "v9.9.2-dismissal-test";
    const other = "v9.9.3-dismissal-test";
    dismissUpstreamRelease(dismissed);
    expect(isUpstreamReleaseDismissed(dismissed)).toBe(true);
    expect(isUpstreamReleaseDismissed(other)).toBe(false);
  });

  it("treats a missing tag as not dismissed and ignores dismissing it", () => {
    expect(isUpstreamReleaseDismissed(null)).toBe(false);
    expect(isUpstreamReleaseDismissed(undefined)).toBe(false);
    expect(() => dismissUpstreamRelease(null)).not.toThrow();
  });
});
