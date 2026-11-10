import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  MAX_NOTE_TEXT_LENGTH,
  migratePersistedThreadNotesState,
  noteSummaryLine,
  useThreadNotesStore,
} from "./threadNotesStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const noteFor = (ref: typeof refA) =>
  useThreadNotesStore.getState().notesByThreadKey[scopedThreadKey(ref)] ?? "";

beforeEach(() => {
  useThreadNotesStore.setState({ notesByThreadKey: {} });
});

describe("threadNotesStore", () => {
  it("stores notes per thread and keeps threads independent", () => {
    const { setNote } = useThreadNotesStore.getState();
    setNote(refA, "note A");
    setNote(refB, "note B");

    expect(noteFor(refA)).toBe("note A");
    expect(noteFor(refB)).toBe("note B");

    setNote(refA, "note A edited");
    expect(noteFor(refA)).toBe("note A edited");
    expect(noteFor(refB)).toBe("note B");
  });

  it("drops the thread key when the note is emptied", () => {
    const { setNote } = useThreadNotesStore.getState();
    setNote(refA, "something");
    setNote(refA, "");

    expect(useThreadNotesStore.getState().notesByThreadKey).toEqual({});
  });

  it("keeps whitespace-only text so the editor is not fought mid-keystroke", () => {
    useThreadNotesStore.getState().setNote(refA, "  \n");

    expect(noteFor(refA)).toBe("  \n");
    expect(noteSummaryLine(noteFor(refA))).toBeNull();
  });

  it("caps runaway text so a paste cannot bloat persisted state", () => {
    useThreadNotesStore.getState().setNote(refA, "x".repeat(MAX_NOTE_TEXT_LENGTH + 1000));

    expect(noteFor(refA)).toHaveLength(MAX_NOTE_TEXT_LENGTH);
  });

  it("leaves the map untouched for no-op writes", () => {
    const { setNote } = useThreadNotesStore.getState();
    setNote(refA, "same");
    const before = useThreadNotesStore.getState().notesByThreadKey;

    setNote(refA, "same");
    setNote(refB, "");

    expect(useThreadNotesStore.getState().notesByThreadKey).toBe(before);
  });

  it("removes the note for a deleted thread and leaves siblings alone", () => {
    const { setNote, removeThread } = useThreadNotesStore.getState();
    setNote(refA, "gone");
    setNote(refB, "kept");

    removeThread(refA);

    expect(noteFor(refA)).toBe("");
    expect(noteFor(refB)).toBe("kept");
  });

  it("summarizes a note by its first non-blank line", () => {
    expect(noteSummaryLine(undefined)).toBeNull();
    expect(noteSummaryLine("")).toBeNull();
    expect(noteSummaryLine(" \n\t\n")).toBeNull();
    expect(noteSummaryLine("first line\nsecond")).toBe("first line");
    expect(noteSummaryLine("\n\n  indented first  \nrest")).toBe("indented first");
  });

  it("returns empty state when migrating garbage", () => {
    expect(migratePersistedThreadNotesState(undefined)).toEqual({ notesByThreadKey: {} });
    expect(migratePersistedThreadNotesState("nope")).toEqual({ notesByThreadKey: {} });
    expect(migratePersistedThreadNotesState({})).toEqual({ notesByThreadKey: {} });
    expect(migratePersistedThreadNotesState({ notesByThreadKey: [] })).toEqual({
      notesByThreadKey: {},
    });
  });

  it("drops non-string and empty entries during migration and re-caps text", () => {
    expect(
      migratePersistedThreadNotesState({
        notesByThreadKey: {
          "env-1:thread-A": "keep",
          "env-1:thread-B": "",
          "env-1:thread-C": 42,
          "env-1:thread-D": "y".repeat(MAX_NOTE_TEXT_LENGTH + 5),
        },
      }),
    ).toEqual({
      notesByThreadKey: {
        "env-1:thread-A": "keep",
        "env-1:thread-D": "y".repeat(MAX_NOTE_TEXT_LENGTH),
      },
    });
  });
});
