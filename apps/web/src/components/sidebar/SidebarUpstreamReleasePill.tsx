import { SparklesIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { UPSTREAM_BASE_VERSION } from "../../branding";
import { useUpstreamRelease } from "../../hooks/useUpstreamRelease";
import { readLocalApi } from "../../localApi";
import {
  dismissUpstreamRelease,
  isUpstreamReleaseDismissed,
  isUpstreamReleaseNewer,
} from "../../upstreamRelease.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Informational pill shown when a newer upstream stable release than this fork
 * build's base is available. It only links to the release notes — porting is
 * manual, so there is deliberately no download/install action here.
 */
export function SidebarUpstreamReleasePill() {
  const release = useUpstreamRelease();
  const [dismissed, setDismissed] = useState(false);

  if (!release || dismissed) {
    return null;
  }
  if (!isUpstreamReleaseNewer(UPSTREAM_BASE_VERSION, release.tag)) {
    return null;
  }
  if (isUpstreamReleaseDismissed(release.tag)) {
    return null;
  }

  const tooltip = `${release.tag} was released upstream. You're on ${UPSTREAM_BASE_VERSION}. Click to view the release notes.`;

  const handleOpen = () => {
    const api = readLocalApi();
    if (!api) {
      return;
    }
    void api.shell.openExternal(release.url).catch((error: unknown) => {
      console.error("Could not open the upstream release notes.", error);
    });
  };

  const handleDismiss = () => {
    dismissUpstreamRelease(release.tag);
    setDismissed(true);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="group/upstream relative flex h-7 w-full items-center rounded-lg bg-primary/15 text-xs font-medium text-primary">
        <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.upstream-main:hover]/upstream:bg-primary/22" />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={tooltip}
                className="upstream-main relative flex h-full flex-1 cursor-pointer items-center gap-2 px-2"
                onClick={handleOpen}
              >
                <SparklesIcon className="size-3.5" />
                <span>New release {release.tag}</span>
              </button>
            }
          />
          <TooltipPopup side="top">{tooltip}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Dismiss upstream release notice"
                className="mr-1 inline-flex size-5 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
                onClick={handleDismiss}
              >
                <XIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipPopup side="top">Dismiss until the next release</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}
