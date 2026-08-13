import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface PullRequestVisibilityState {
  /**
   * Repositories kept out of the pull request list, by the canonical key of their remote — the
   * same identity the listing de-duplicates copies by, so hiding one reaches every worktree and
   * every server holding it.
   */
  hiddenRepositoryKeys: ReadonlyArray<string>;
  setRepositoryHidden: (repositoryKey: string, hidden: boolean) => void;
}

export const usePullRequestVisibilityStore = create<PullRequestVisibilityState>()(
  persist(
    (set) => ({
      hiddenRepositoryKeys: [],
      setRepositoryHidden: (repositoryKey, hidden) =>
        set((state) => {
          if (state.hiddenRepositoryKeys.includes(repositoryKey) === hidden) return state;
          return {
            hiddenRepositoryKeys: hidden
              ? [...state.hiddenRepositoryKeys, repositoryKey]
              : state.hiddenRepositoryKeys.filter((key) => key !== repositoryKey),
          };
        }),
    }),
    {
      name: "t3code:pull-request-visibility:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ hiddenRepositoryKeys: state.hiddenRepositoryKeys }),
    },
  ),
);

export const selectHiddenRepositoryKeys = (
  state: PullRequestVisibilityState,
): ReadonlyArray<string> => state.hiddenRepositoryKeys;
