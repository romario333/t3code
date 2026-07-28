import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  countUnresolvedTodos,
  migratePersistedThreadTodosState,
  selectThreadTodos,
  useThreadTodosStore,
} from "./threadTodosStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

const todosFor = (ref: typeof refA) =>
  selectThreadTodos(useThreadTodosStore.getState().todosByThreadKey, ref);

beforeEach(() => {
  useThreadTodosStore.setState({ todosByThreadKey: {} });
});

describe("threadTodosStore", () => {
  it("appends todos in entry order and keeps threads independent", () => {
    const { addTodo } = useThreadTodosStore.getState();
    addTodo(refA, "first");
    addTodo(refA, "second");
    addTodo(refB, "other thread");

    expect(todosFor(refA).map((todo) => todo.text)).toEqual(["first", "second"]);
    expect(todosFor(refB).map((todo) => todo.text)).toEqual(["other thread"]);
    expect(todosFor(refA).every((todo) => !todo.completed)).toBe(true);
  });

  it("trims text and ignores blank entries", () => {
    const { addTodo } = useThreadTodosStore.getState();
    addTodo(refA, "  padded  ");
    addTodo(refA, "   ");
    addTodo(refA, "");

    expect(todosFor(refA).map((todo) => todo.text)).toEqual(["padded"]);
  });

  it("caps runaway text so a paste cannot bloat persisted state", () => {
    useThreadTodosStore.getState().addTodo(refA, "x".repeat(2000));

    expect(todosFor(refA)[0]?.text).toHaveLength(500);
  });

  it("toggles only the targeted todo", () => {
    const { addTodo, toggleTodo } = useThreadTodosStore.getState();
    addTodo(refA, "first");
    addTodo(refA, "second");
    const [first, second] = todosFor(refA);
    toggleTodo(refA, second!.id);

    const todos = todosFor(refA);
    expect(todos.find((todo) => todo.id === first!.id)?.completed).toBe(false);
    expect(todos.find((todo) => todo.id === second!.id)?.completed).toBe(true);

    toggleTodo(refA, second!.id);
    expect(todosFor(refA).find((todo) => todo.id === second!.id)?.completed).toBe(false);
  });

  it("edits only the targeted todo and keeps its state", () => {
    const { addTodo, editTodo, toggleTodo } = useThreadTodosStore.getState();
    addTodo(refA, "first");
    addTodo(refA, "second");
    const [first, second] = todosFor(refA);
    toggleTodo(refA, first!.id);

    editTodo(refA, first!.id, "  edited  ");

    const todos = todosFor(refA);
    expect(todos.map((todo) => todo.text)).toEqual(["edited", "second"]);
    // Editing is a text change: completion, id, and order all survive it.
    expect(todos[0]!.completed).toBe(true);
    expect(todos[0]!.id).toBe(first!.id);
    expect(todos[0]!.createdAt).toBe(first!.createdAt);
    expect(todos[1]).toBe(second);
  });

  it("caps edited text and treats a blank edit as a cancel", () => {
    const { addTodo, editTodo } = useThreadTodosStore.getState();
    addTodo(refA, "keep me");
    const todoId = todosFor(refA)[0]!.id;

    editTodo(refA, todoId, "   ");
    expect(todosFor(refA)[0]!.text).toBe("keep me");

    editTodo(refA, todoId, "y".repeat(2000));
    expect(todosFor(refA)[0]!.text).toHaveLength(500);
  });

  it("leaves state untouched for unknown todo ids", () => {
    const { addTodo, editTodo, toggleTodo, removeTodo } = useThreadTodosStore.getState();
    addTodo(refA, "first");
    const before = useThreadTodosStore.getState().todosByThreadKey;

    toggleTodo(refA, "missing");
    removeTodo(refA, "missing");
    editTodo(refA, "missing", "nope");
    // An edit that changes nothing must not churn the map either: rows
    // subscribe to it by identity.
    editTodo(refA, todosFor(refA)[0]!.id, "first");

    expect(useThreadTodosStore.getState().todosByThreadKey).toBe(before);
  });

  it("drops the thread key once the last todo is removed", () => {
    const { addTodo, removeTodo } = useThreadTodosStore.getState();
    addTodo(refA, "only");
    const todoId = todosFor(refA)[0]!.id;

    removeTodo(refA, todoId);

    expect(useThreadTodosStore.getState().todosByThreadKey).toEqual({});
    expect(todosFor(refA)).toEqual([]);
  });

  it("removes all todos for a deleted thread and leaves siblings alone", () => {
    const { addTodo, removeThread } = useThreadTodosStore.getState();
    addTodo(refA, "first");
    addTodo(refB, "kept");

    removeThread(refA);

    expect(todosFor(refA)).toEqual([]);
    expect(todosFor(refB).map((todo) => todo.text)).toEqual(["kept"]);
  });

  it("counts only unresolved todos", () => {
    expect(countUnresolvedTodos([])).toBe(0);
    expect(
      countUnresolvedTodos([
        { id: "1", text: "open", completed: false, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "2", text: "done", completed: true, createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "3", text: "open", completed: false, createdAt: "2026-01-01T00:00:00.000Z" },
      ]),
    ).toBe(2);
  });

  it("returns empty state when migrating garbage", () => {
    expect(migratePersistedThreadTodosState(undefined)).toEqual({ todosByThreadKey: {} });
    expect(migratePersistedThreadTodosState("nope")).toEqual({ todosByThreadKey: {} });
    expect(migratePersistedThreadTodosState({})).toEqual({ todosByThreadKey: {} });
    expect(migratePersistedThreadTodosState({ todosByThreadKey: [] })).toEqual({
      todosByThreadKey: {},
    });
  });

  it("drops malformed todos and empty threads during migration", () => {
    expect(
      migratePersistedThreadTodosState({
        todosByThreadKey: {
          "env-1:thread-A": [
            { id: "1", text: "keep", completed: true, createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "", text: "no id", completed: false, createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "2", text: "   ", completed: false, createdAt: "2026-01-01T00:00:00.000Z" },
            { id: "3", completed: false },
            null,
          ],
          "env-1:thread-B": [{ id: "4", text: "", completed: false }],
          "env-1:thread-C": "not an array",
        },
      }),
    ).toEqual({
      todosByThreadKey: {
        "env-1:thread-A": [
          { id: "1", text: "keep", completed: true, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });
  });

  it("coerces a missing completed flag and timestamp during migration", () => {
    const migrated = migratePersistedThreadTodosState({
      todosByThreadKey: { "env-1:thread-A": [{ id: "1", text: "loose" }] },
    });

    expect(migrated.todosByThreadKey["env-1:thread-A"]).toEqual([
      { id: "1", text: "loose", completed: false, createdAt: "1970-01-01T00:00:00.000Z" },
    ]);
  });
});
