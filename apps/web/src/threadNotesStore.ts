// The user's own scratchpad per thread, distinct from agent-authored plans.
// Notes stay in this browser's localStorage and never reach the server.
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDeferredStorage } from "./lib/storage";

const THREAD_NOTES_STORAGE_KEY = "t3code:thread-notes:v1";
const THREAD_NOTES_STORAGE_VERSION = 1;
// A note is a scratchpad, not a document store. The cap keeps a runaway paste
// from eating the ~5MB origin-wide localStorage quota shared with composer
// drafts and the prompt stash.
export const MAX_NOTE_TEXT_LENGTH = 50_000;

interface ThreadNotesStoreState {
  notesByThreadKey: Record<string, string>;
  setNote: (ref: ScopedThreadRef, text: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

/**
 * First non-blank line of a note, or null when the note is effectively empty
 * (whitespace and line endings only). Null is also the sidebar's "no icon"
 * signal, so rows re-render only when this line changes, not on every
 * keystroke further down the note.
 */
export function noteSummaryLine(text: string | undefined): string | null {
  if (text === undefined) return null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export function migratePersistedThreadNotesState(persistedState: unknown): {
  notesByThreadKey: Record<string, string>;
} {
  if (
    !persistedState ||
    typeof persistedState !== "object" ||
    !("notesByThreadKey" in persistedState) ||
    !persistedState.notesByThreadKey ||
    typeof persistedState.notesByThreadKey !== "object"
  ) {
    return { notesByThreadKey: {} };
  }
  const notesByThreadKey: Record<string, string> = {};
  for (const [threadKey, value] of Object.entries(
    persistedState.notesByThreadKey as Record<string, unknown>,
  )) {
    if (typeof value !== "string" || value.length === 0) continue;
    notesByThreadKey[threadKey] = value.slice(0, MAX_NOTE_TEXT_LENGTH);
  }
  return { notesByThreadKey };
}

// Note text changes on every keystroke; the store updates synchronously and
// only the localStorage flush is debounced, like the composer draft store.
const threadNotesDebouncedStorage = createDeferredStorage<string>(
  typeof window !== "undefined" ? window.localStorage : undefined,
  (value) => value,
);

// Flush pending note writes before page unload to prevent data loss.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    threadNotesDebouncedStorage.flush();
  });
}

export const useThreadNotesStore = create<ThreadNotesStoreState>()(
  persist(
    (set) => ({
      notesByThreadKey: {},
      setNote: (ref, text) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const capped = text.slice(0, MAX_NOTE_TEXT_LENGTH);
          // A backspaced-to-nothing note drops its key so browsed threads
          // never linger in localStorage. Whitespace-only text stays put —
          // deleting it out from under the editor would eat the keystroke —
          // and noteSummaryLine already treats it as "no note".
          if (capped.length === 0) {
            if (!(threadKey in state.notesByThreadKey)) return state;
            const { [threadKey]: _removed, ...rest } = state.notesByThreadKey;
            return { notesByThreadKey: rest };
          }
          if (state.notesByThreadKey[threadKey] === capped) return state;
          return { notesByThreadKey: { ...state.notesByThreadKey, [threadKey]: capped } };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.notesByThreadKey)) return state;
          const { [threadKey]: _removed, ...rest } = state.notesByThreadKey;
          return { notesByThreadKey: rest };
        }),
    }),
    {
      name: THREAD_NOTES_STORAGE_KEY,
      version: THREAD_NOTES_STORAGE_VERSION,
      storage: createJSONStorage(() => threadNotesDebouncedStorage),
      partialize: (state) => ({ notesByThreadKey: state.notesByThreadKey }),
      migrate: migratePersistedThreadNotesState,
    },
  ),
);
