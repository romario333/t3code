/**
 * Thread-scoped user todo lists.
 *
 * These are notes the *user* writes for themselves against a thread ("re-test
 * on mobile", "reply to the review comment") — deliberately distinct from the
 * agent-authored plan/TodoWrite steps rendered by PlanSidebar, which are
 * server state derived from provider events. These never leave the browser:
 * they are local scratch state, persisted like the right-panel layout.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { randomUUID } from "~/lib/utils";
import { resolveStorage } from "./lib/storage";

const THREAD_TODOS_STORAGE_KEY = "t3code:thread-todos:v1";
const THREAD_TODOS_STORAGE_VERSION = 1;
// A todo is a one-line reminder, not a document. The cap keeps a runaway
// paste from bloating localStorage for every future write of the whole map.
const MAX_TODO_TEXT_LENGTH = 500;

export interface ThreadTodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
}

/**
 * Stable reference for rows without todos: the sidebar row is memoized and
 * subscribes per thread key, so a fresh `[]` per render would defeat it.
 */
export const EMPTY_THREAD_TODOS: readonly ThreadTodoItem[] = Object.freeze([]);

interface ThreadTodosStoreState {
  todosByThreadKey: Record<string, ThreadTodoItem[]>;
  addTodo: (ref: ScopedThreadRef, text: string) => void;
  editTodo: (ref: ScopedThreadRef, todoId: string, text: string) => void;
  toggleTodo: (ref: ScopedThreadRef, todoId: string) => void;
  removeTodo: (ref: ScopedThreadRef, todoId: string) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const updateThread = (
  todosByThreadKey: Record<string, ThreadTodoItem[]>,
  threadKey: string,
  updater: (current: readonly ThreadTodoItem[]) => readonly ThreadTodoItem[],
): Record<string, ThreadTodoItem[]> => {
  const current = todosByThreadKey[threadKey] ?? EMPTY_THREAD_TODOS;
  const next = updater(current);
  // Emptying a list drops the key entirely: without this, every thread the
  // user ever opened a todo popover on would linger in localStorage forever.
  if (next.length === 0) {
    if (!(threadKey in todosByThreadKey)) return todosByThreadKey;
    const { [threadKey]: _removed, ...rest } = todosByThreadKey;
    return rest;
  }
  if (next === current) return todosByThreadKey;
  return { ...todosByThreadKey, [threadKey]: [...next] };
};

export function countUnresolvedTodos(todos: readonly ThreadTodoItem[]): number {
  return todos.reduce((count, todo) => (todo.completed ? count : count + 1), 0);
}

export function migratePersistedThreadTodosState(persistedState: unknown): {
  todosByThreadKey: Record<string, ThreadTodoItem[]>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { todosByThreadKey: {} };
  }
  if (
    !("todosByThreadKey" in persistedState) ||
    !persistedState.todosByThreadKey ||
    typeof persistedState.todosByThreadKey !== "object"
  ) {
    return { todosByThreadKey: {} };
  }
  const todosByThreadKey: Record<string, ThreadTodoItem[]> = {};
  for (const [threadKey, value] of Object.entries(
    persistedState.todosByThreadKey as Record<string, unknown>,
  )) {
    if (!Array.isArray(value)) continue;
    const todos = value.flatMap<ThreadTodoItem>((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<ThreadTodoItem>;
      if (typeof candidate.id !== "string" || candidate.id.length === 0) return [];
      if (typeof candidate.text !== "string") return [];
      const text = candidate.text.trim().slice(0, MAX_TODO_TEXT_LENGTH);
      if (text.length === 0) return [];
      return [
        {
          id: candidate.id,
          text,
          completed: candidate.completed === true,
          createdAt:
            typeof candidate.createdAt === "string"
              ? candidate.createdAt
              : new Date(0).toISOString(),
        },
      ];
    });
    if (todos.length > 0) todosByThreadKey[threadKey] = todos;
  }
  return { todosByThreadKey };
}

export const useThreadTodosStore = create<ThreadTodosStoreState>()(
  persist(
    (set) => ({
      todosByThreadKey: {},
      addTodo: (ref, text) =>
        set((state) => {
          const trimmed = text.trim().slice(0, MAX_TODO_TEXT_LENGTH);
          if (trimmed.length === 0) return state;
          return {
            todosByThreadKey: updateThread(
              state.todosByThreadKey,
              scopedThreadKey(ref),
              (current) => [
                ...current,
                {
                  id: randomUUID(),
                  text: trimmed,
                  completed: false,
                  createdAt: new Date().toISOString(),
                },
              ],
            ),
          };
        }),
      editTodo: (ref, todoId, text) =>
        set((state) => ({
          todosByThreadKey: updateThread(
            state.todosByThreadKey,
            scopedThreadKey(ref),
            (current) => {
              const trimmed = text.trim().slice(0, MAX_TODO_TEXT_LENGTH);
              // An emptied field is a cancelled edit, not a delete: the item has
              // its own delete button, and committing blank here would let a
              // stray Enter destroy the text with nothing to undo it.
              if (trimmed.length === 0) return current;
              const existing = current.find((todo) => todo.id === todoId);
              if (!existing || existing.text === trimmed) return current;
              return current.map((todo) =>
                todo.id === todoId ? { ...todo, text: trimmed } : todo,
              );
            },
          ),
        })),
      toggleTodo: (ref, todoId) =>
        set((state) => ({
          todosByThreadKey: updateThread(state.todosByThreadKey, scopedThreadKey(ref), (current) =>
            current.some((todo) => todo.id === todoId)
              ? current.map((todo) =>
                  todo.id === todoId ? { ...todo, completed: !todo.completed } : todo,
                )
              : current,
          ),
        })),
      removeTodo: (ref, todoId) =>
        set((state) => ({
          todosByThreadKey: updateThread(state.todosByThreadKey, scopedThreadKey(ref), (current) =>
            current.some((todo) => todo.id === todoId)
              ? current.filter((todo) => todo.id !== todoId)
              : current,
          ),
        })),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.todosByThreadKey)) return state;
          const { [threadKey]: _removed, ...rest } = state.todosByThreadKey;
          return { todosByThreadKey: rest };
        }),
    }),
    {
      name: THREAD_TODOS_STORAGE_KEY,
      version: THREAD_TODOS_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ todosByThreadKey: state.todosByThreadKey }),
      migrate: migratePersistedThreadTodosState,
    },
  ),
);

export function selectThreadTodos(
  todosByThreadKey: Record<string, ThreadTodoItem[]>,
  ref: ScopedThreadRef | null | undefined,
): readonly ThreadTodoItem[] {
  if (!ref) return EMPTY_THREAD_TODOS;
  return todosByThreadKey[scopedThreadKey(ref)] ?? EMPTY_THREAD_TODOS;
}
