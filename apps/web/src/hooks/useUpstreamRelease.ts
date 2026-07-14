import { useEffect, useState } from "react";

import { HOSTED_APP_CHANNEL } from "../branding";
import {
  parseUpstreamRelease,
  UPSTREAM_LATEST_RELEASE_ENDPOINT,
  type UpstreamRelease,
} from "../upstreamRelease.logic";

// Upstream stable releases land roughly weekly, so a slow poll is plenty. A short
// startup delay keeps the request off the initial load path.
const STARTUP_DELAY_MS = 5_000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The check only makes sense for the self-built fork desktop/CLI app: skip it in
 * dev (noisy against the placeholder version) and on the hosted deployment, which
 * follows its own release channel rather than upstream tags.
 */
function isUpstreamReleaseCheckEnabled(): boolean {
  return !import.meta.env.DEV && HOSTED_APP_CHANNEL === null;
}

/**
 * Polls GitHub for the latest upstream stable release. Returns the parsed release
 * (regardless of whether it is newer than this build) or null while unknown.
 * Network/rate-limit failures are swallowed — the pill simply does not appear.
 */
export function useUpstreamRelease(): UpstreamRelease | null {
  const [release, setRelease] = useState<UpstreamRelease | null>(null);

  useEffect(() => {
    if (!isUpstreamReleaseCheckEnabled()) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      try {
        const response = await fetch(UPSTREAM_LATEST_RELEASE_ENDPOINT, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const parsed = parseUpstreamRelease(await response.json());
        if (!cancelled && parsed) {
          setRelease(parsed);
        }
      } catch {
        // Offline, rate-limited, or aborted — leave the last known value in place.
      }
    };

    const startupTimer = setTimeout(() => void check(), STARTUP_DELAY_MS);
    const interval = setInterval(() => void check(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(startupTimer);
      clearInterval(interval);
    };
  }, []);

  return release;
}
