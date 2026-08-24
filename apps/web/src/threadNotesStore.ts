/**
 * Thread-scoped user note.
 *
 * A free-form scratchpad the *user* writes for themselves against a thread —
 * deliberately distinct from the agent-authored plan/TodoWrite steps, which
 * are server state derived from provider events. Notes never leave the
 * browser: they are local scratch state, persisted like the right-panel
 * layout. Successor to the per-thread todo lists (t3code:thread-todos:v1),
 * which are converted into note text on first load.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { createDebouncedStorage, type StateStorage } from "./lib/storage";

const THREAD_NOTES_STORAGE_KEY = "t3code:thread-notes:v1";
const THREAD_NOTES_STORAGE_VERSION = 1;
const LEGACY_THREAD_TODOS_STORAGE_KEY = "t3code:thread-todos:v1";
// The converted todos stay recoverable, but under a name the migration never
// reads again — otherwise clearing a note would resurrect them on reload.
const LEGACY_THREAD_TODOS_BACKUP_KEY = "t3code:thread-todos:v1-backup";
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

/**
 * Renders a legacy todo store's persisted JSON (the raw localStorage value,
 * zustand-persist envelope included) as note text per thread key: markdown
 * task-list lines in stored order, `- [x]` for completed items. Malformed
 * entries are dropped rather than failing the whole conversion.
 */
export function convertLegacyThreadTodos(rawPersistedJson: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPersistedJson);
  } catch {
    return {};
  }
  const state =
    parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : undefined;
  const todosByThreadKey =
    state && typeof state === "object" && "todosByThreadKey" in state
      ? state.todosByThreadKey
      : undefined;
  if (!todosByThreadKey || typeof todosByThreadKey !== "object") return {};
  const converted: Record<string, string> = {};
  for (const [threadKey, value] of Object.entries(todosByThreadKey as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const lines = value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as { text?: unknown; completed?: unknown };
      if (typeof candidate.text !== "string") return [];
      const text = candidate.text.trim();
      if (text.length === 0) return [];
      return [`- [${candidate.completed === true ? "x" : " "}] ${text}`];
    });
    if (lines.length > 0) converted[threadKey] = lines.join("\n");
  }
  return converted;
}

/**
 * One-time conversion of the legacy todo lists into notes. Runs only while
 * the legacy key exists; afterwards the raw value lives on under the backup
 * key, so a re-run is a no-op and the data stays recoverable. A thread that
 * already has a note gets the converted list appended, not overwritten.
 */
export function migrateLegacyThreadTodosIntoNotes(storage: StateStorage): void {
  const raw = storage.getItem(LEGACY_THREAD_TODOS_STORAGE_KEY);
  if (typeof raw !== "string") return;
  const converted = convertLegacyThreadTodos(raw);
  if (Object.keys(converted).length > 0) {
    useThreadNotesStore.setState((state) => {
      const notesByThreadKey = { ...state.notesByThreadKey };
      for (const [threadKey, todoText] of Object.entries(converted)) {
        const existing = notesByThreadKey[threadKey];
        notesByThreadKey[threadKey] = (
          existing === undefined ? todoText : `${existing}\n\n${todoText}`
        ).slice(0, MAX_NOTE_TEXT_LENGTH);
      }
      return { notesByThreadKey };
    });
  }
  storage.setItem(LEGACY_THREAD_TODOS_BACKUP_KEY, raw);
  storage.removeItem(LEGACY_THREAD_TODOS_STORAGE_KEY);
}

// Note text changes on every keystroke; the store updates synchronously and
// only the localStorage flush is debounced, like the composer draft store.
const threadNotesDebouncedStorage = createDebouncedStorage(
  typeof window !== "undefined" ? window.localStorage : undefined,
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

if (typeof window !== "undefined") {
  migrateLegacyThreadTodosIntoNotes(window.localStorage);
}

export function selectThreadNote(
  notesByThreadKey: Record<string, string>,
  ref: ScopedThreadRef | null | undefined,
): string {
  if (!ref) return "";
  return notesByThreadKey[scopedThreadKey(ref)] ?? "";
}
