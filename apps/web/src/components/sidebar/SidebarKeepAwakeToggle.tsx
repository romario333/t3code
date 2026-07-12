import { CoffeeIcon } from "lucide-react";
import { useAtomValue } from "@effect/atom-react";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { primaryServerConfigAtom } from "../../state/server";
import { SidebarMenu, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Global keep-awake toggle rendered in the sidebar footer. While enabled the
 * server holds a `caffeinate` process so the host Mac and its display do not
 * sleep during unattended agent work. Gated on the primary server's platform (not the
 * browser's) because `caffeinate` runs on the machine hosting the server.
 */
export function SidebarKeepAwakeToggle() {
  const serverOs = useAtomValue(primaryServerConfigAtom)?.environment.platform.os;
  const keepAwake = usePrimarySettings((settings) => settings.keepAwake);
  const updateSettings = useUpdatePrimarySettings();

  if (serverOs !== "darwin") {
    return null;
  }

  const tooltip = keepAwake
    ? "This Mac and its display are being kept awake so agents can keep working. Click to allow sleep again."
    : "Prevent this Mac and its display from sleeping while the T3 Code server is running (uses caffeinate).";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={keepAwake}
                className={
                  keepAwake
                    ? "flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg bg-primary/15 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/22"
                    : "flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                }
                onClick={() => updateSettings({ keepAwake: !keepAwake })}
              >
                <CoffeeIcon className="size-3.5" />
                <span>Keep awake</span>
                {keepAwake && (
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    <span className="inline-flex size-2 rounded-full bg-primary" />
                    On
                  </span>
                )}
              </button>
            }
          />
          <TooltipPopup side="top">{tooltip}</TooltipPopup>
        </Tooltip>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
