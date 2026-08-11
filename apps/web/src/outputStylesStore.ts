/**
 * User-authored Claude Code output styles.
 *
 * These are browser-local: the library never leaves localStorage. A selected
 * custom style is sent per-turn on the model-selection options channel (name +
 * markdown body), and the server materializes it for the Claude CLI. Built-in
 * styles ("Explanatory", "Learning") ship with Claude Code and are not stored
 * here.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { randomUUID } from "~/lib/utils";
import { resolveStorage } from "./lib/storage";

const OUTPUT_STYLES_STORAGE_KEY = "t3code:output-styles:v1";
const OUTPUT_STYLES_STORAGE_VERSION = 1;
const MAX_STYLE_NAME_LENGTH = 64;
// A style is a system-prompt section, not a document dump. The cap keeps a
// runaway paste from bloating localStorage and every turn dispatch.
const MAX_STYLE_CONTENT_LENGTH = 20_000;

export interface CustomOutputStyle {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

export const EMPTY_CUSTOM_OUTPUT_STYLES: readonly CustomOutputStyle[] = Object.freeze([]);

interface OutputStylesStoreState {
  customStyles: CustomOutputStyle[];
  addStyle: (input: { name: string; content: string }) => CustomOutputStyle | null;
  removeStyle: (styleId: string) => void;
}

export function normalizeOutputStyleName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_STYLE_NAME_LENGTH);
}

export function normalizeOutputStyleContent(content: string): string {
  return content.trim().slice(0, MAX_STYLE_CONTENT_LENGTH);
}

export function migratePersistedOutputStylesState(persistedState: unknown): {
  customStyles: CustomOutputStyle[];
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { customStyles: [] };
  }
  if (!("customStyles" in persistedState) || !Array.isArray(persistedState.customStyles)) {
    return { customStyles: [] };
  }
  const customStyles = persistedState.customStyles.flatMap<CustomOutputStyle>((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<CustomOutputStyle>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) return [];
    if (typeof candidate.name !== "string" || typeof candidate.content !== "string") return [];
    const name = normalizeOutputStyleName(candidate.name);
    const content = normalizeOutputStyleContent(candidate.content);
    if (name.length === 0 || content.length === 0) return [];
    return [
      {
        id: candidate.id,
        name,
        content,
        createdAt:
          typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
      },
    ];
  });
  return { customStyles };
}

export const useOutputStylesStore = create<OutputStylesStoreState>()(
  persist(
    (set, get) => ({
      customStyles: [],
      addStyle: ({ name, content }) => {
        const normalizedName = normalizeOutputStyleName(name);
        const normalizedContent = normalizeOutputStyleContent(content);
        if (normalizedName.length === 0 || normalizedContent.length === 0) {
          return null;
        }
        const style: CustomOutputStyle = {
          id: randomUUID(),
          name: normalizedName,
          content: normalizedContent,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          // Re-using a name replaces the previous style: names are the identity
          // Claude Code sees, so two entries with one name would be ambiguous.
          customStyles: [
            ...state.customStyles.filter(
              (existing) => existing.name.toLowerCase() !== normalizedName.toLowerCase(),
            ),
            style,
          ],
        }));
        return get().customStyles.find((candidate) => candidate.id === style.id) ?? style;
      },
      removeStyle: (styleId) =>
        set((state) => {
          if (!state.customStyles.some((style) => style.id === styleId)) return state;
          return { customStyles: state.customStyles.filter((style) => style.id !== styleId) };
        }),
    }),
    {
      name: OUTPUT_STYLES_STORAGE_KEY,
      version: OUTPUT_STYLES_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ customStyles: state.customStyles }),
      migrate: migratePersistedOutputStylesState,
    },
  ),
);
