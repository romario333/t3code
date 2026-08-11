import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { getProviderOptionStringSelectionValue } from "@t3tools/shared/model";
import {
  CLAUDE_BUILTIN_OUTPUT_STYLES,
  CLAUDE_OUTPUT_STYLE_CONTENT_OPTION_ID,
  CLAUDE_OUTPUT_STYLE_OPTION_ID,
  CLAUDE_OUTPUT_STYLE_PASSTHROUGH_OPTION_IDS,
} from "@t3tools/shared/outputStyles";
import { memo, useCallback, useState } from "react";
import { PaletteIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useOutputStylesStore } from "../../outputStylesStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";
import { Textarea } from "../ui/textarea";
import { ComposerControl, ComposerControlChevron, ComposerControlIcon } from "./ComposerControl";

type ProviderOptions = ReadonlyArray<ProviderOptionSelection>;

/** Radio value for "no output style"; style names themselves never collide with it. */
const DEFAULT_STYLE_VALUE = "__default__";

export function shouldRenderOutputStyleControl(provider: ProviderDriverKind): boolean {
  // Output styles are a Claude Code concept; other providers have no
  // equivalent of settings.outputStyle.
  return provider === "claudeAgent";
}

export interface OutputStylePickerProps {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  model: string | null | undefined;
  modelOptions?: ProviderOptions | null | undefined;
  triggerClassName?: string;
}

function getSelectedOutputStyleName(
  modelOptions: ProviderOptions | null | undefined,
): string | null {
  return getProviderOptionStringSelectionValue(modelOptions, CLAUDE_OUTPUT_STYLE_OPTION_ID) ?? null;
}

function useApplyOutputStyle(input: {
  provider: ProviderDriverKind;
  instanceId?: ProviderInstanceId | undefined;
  threadRef?: ScopedThreadRef | undefined;
  draftId?: DraftId | undefined;
  model: string | null | undefined;
  modelOptions?: ProviderOptions | null | undefined;
}) {
  const { provider, instanceId, threadRef, draftId, model, modelOptions } = input;
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  return useCallback(
    (style: { name: string; content?: string } | null) => {
      const threadTarget = threadRef ?? draftId;
      if (!threadTarget) {
        return;
      }
      const base = (modelOptions ?? []).filter(
        (selection) => !CLAUDE_OUTPUT_STYLE_PASSTHROUGH_OPTION_IDS.includes(selection.id),
      );
      const next = style
        ? [
            ...base,
            { id: CLAUDE_OUTPUT_STYLE_OPTION_ID, value: style.name },
            ...(style.content
              ? [{ id: CLAUDE_OUTPUT_STYLE_CONTENT_OPTION_ID, value: style.content }]
              : []),
          ]
        : base;
      setProviderModelOptions(threadTarget, provider, next.length > 0 ? next : undefined, {
        ...(instanceId ? { instanceId } : {}),
        model,
        persistSticky: true,
      });
    },
    [draftId, instanceId, model, modelOptions, provider, setProviderModelOptions, threadRef],
  );
}

export const OutputStyleMenuContent = memo(function OutputStyleMenuContentImpl({
  provider,
  instanceId,
  threadRef,
  draftId,
  model,
  modelOptions,
  onRequestCreate,
}: OutputStylePickerProps & {
  onRequestCreate?: () => void;
}) {
  const customStyles = useOutputStylesStore((store) => store.customStyles);
  const removeStyle = useOutputStylesStore((store) => store.removeStyle);
  const applyOutputStyle = useApplyOutputStyle({
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    modelOptions,
  });
  const selectedName = getSelectedOutputStyleName(modelOptions);

  const handleValueChange = (value: string) => {
    if (!value) return;
    if (value === DEFAULT_STYLE_VALUE) {
      applyOutputStyle(null);
      return;
    }
    const custom = customStyles.find((style) => style.name === value);
    applyOutputStyle(custom ? { name: custom.name, content: custom.content } : { name: value });
  };

  return (
    <MenuGroup>
      <div className="px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs">Output Style</div>
      <MenuRadioGroup value={selectedName ?? DEFAULT_STYLE_VALUE} onValueChange={handleValueChange}>
        <MenuRadioItem value={DEFAULT_STYLE_VALUE} hideIndicator closeOnClick>
          Default
        </MenuRadioItem>
        {CLAUDE_BUILTIN_OUTPUT_STYLES.map((style) => (
          <MenuRadioItem
            key={style.name}
            value={style.name}
            hideIndicator
            closeOnClick
            title={style.description}
          >
            {style.name}
          </MenuRadioItem>
        ))}
        {customStyles.map((style) => (
          <MenuRadioItem key={style.id} value={style.name} hideIndicator closeOnClick>
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate">{style.name}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Delete output style ${style.name}`}
                className="size-5 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (selectedName === style.name) {
                    applyOutputStyle(null);
                  }
                  removeStyle(style.id);
                }}
              >
                <Trash2Icon aria-hidden="true" className="size-3.5" />
              </Button>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {onRequestCreate ? (
        <>
          <MenuDivider />
          <MenuItem closeOnClick onClick={onRequestCreate}>
            <PlusIcon aria-hidden="true" className="size-4" />
            New style…
          </MenuItem>
        </>
      ) : null}
    </MenuGroup>
  );
});

export function OutputStyleCreateDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (style: { name: string; content: string }) => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const canCreate = name.trim().length > 0 && content.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate({ name: name.trim(), content });
    setName("");
    setContent("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New output style</DialogTitle>
          <DialogDescription>
            Output styles adjust how Claude responds. The instructions below are added to the system
            prompt for turns sent with this style. Styles are stored only in this browser.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (e.g. Concise)"
            aria-label="Output style name"
            autoFocus
          />
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={
              "Instructions (e.g. Keep responses brief. Prefer bullet points over prose.)"
            }
            aria-label="Output style instructions"
            className="min-h-40"
          />
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCreate} disabled={!canCreate}>
            Create
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export const OutputStylePicker = memo(function OutputStylePicker({
  provider,
  instanceId,
  threadRef,
  draftId,
  model,
  modelOptions,
  triggerClassName,
}: OutputStylePickerProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const addStyle = useOutputStylesStore((store) => store.addStyle);
  const applyOutputStyle = useApplyOutputStyle({
    provider,
    instanceId,
    threadRef,
    draftId,
    model,
    modelOptions,
  });

  if (!shouldRenderOutputStyleControl(provider) || (!threadRef && !draftId)) {
    return null;
  }

  const selectedName = getSelectedOutputStyleName(modelOptions);

  return (
    <>
      <Menu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <MenuTrigger
          render={
            <ComposerControl
              className={cn("shrink-0 whitespace-nowrap", triggerClassName)}
              aria-label="Output style"
            />
          }
        >
          <ComposerControlIcon icon={PaletteIcon} />
          <span>{selectedName ?? "Style"}</span>
          <ComposerControlChevron />
        </MenuTrigger>
        <MenuPopup align="start">
          <OutputStyleMenuContent
            provider={provider}
            {...(instanceId ? { instanceId } : {})}
            {...(threadRef ? { threadRef } : {})}
            {...(draftId ? { draftId } : {})}
            model={model}
            modelOptions={modelOptions}
            onRequestCreate={() => {
              setIsMenuOpen(false);
              setIsCreateOpen(true);
            }}
          />
        </MenuPopup>
      </Menu>
      <OutputStyleCreateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={(input) => {
          const style = addStyle(input);
          if (style) {
            applyOutputStyle({ name: style.name, content: style.content });
          }
        }}
      />
    </>
  );
});
