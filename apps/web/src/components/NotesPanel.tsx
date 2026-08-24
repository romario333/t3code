import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { MAX_NOTE_TEXT_LENGTH, useThreadNotesStore } from "~/threadNotesStore";

/**
 * The Notes surface: a plain-text scratchpad for the user's own notes on this
 * thread (see threadNotesStore). No formatting, no toolbar — the store update
 * is synchronous and only the localStorage flush is debounced, so what you
 * see is what is saved.
 */
export function NotesPanel(props: { threadRef: ScopedThreadRef }) {
  const threadKey = scopedThreadKey(props.threadRef);
  const text = useThreadNotesStore((state) => state.notesByThreadKey[threadKey]) ?? "";
  const setNote = useThreadNotesStore((state) => state.setNote);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        autoFocus
        value={text}
        aria-label="Thread note"
        placeholder="Write a note for this thread…"
        maxLength={MAX_NOTE_TEXT_LENGTH}
        onChange={(event) => setNote(props.threadRef, event.target.value)}
        className="min-h-0 w-full flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-4 py-1.5 text-[11px] text-muted-foreground/70">
        <span>Saved in this browser · not synced</span>
        {text.length >= MAX_NOTE_TEXT_LENGTH * 0.9 ? (
          <span className="tabular-nums">
            {text.length.toLocaleString()} / {MAX_NOTE_TEXT_LENGTH.toLocaleString()}
          </span>
        ) : null}
      </div>
    </div>
  );
}
