import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  migratePersistedOutputStylesState,
  normalizeOutputStyleContent,
  normalizeOutputStyleName,
  useOutputStylesStore,
} from "./outputStylesStore";

describe("outputStylesStore", () => {
  beforeEach(() => {
    useOutputStylesStore.setState({ customStyles: [] });
  });

  it("adds a style with normalized name and content", () => {
    const style = useOutputStylesStore.getState().addStyle({
      name: "  My   Style  ",
      content: "  Respond briefly.  ",
    });
    expect(style).not.toBeNull();
    expect(style?.name).toBe("My Style");
    expect(style?.content).toBe("Respond briefly.");
    expect(useOutputStylesStore.getState().customStyles).toHaveLength(1);
  });

  it("rejects blank names or content", () => {
    expect(useOutputStylesStore.getState().addStyle({ name: "  ", content: "x" })).toBeNull();
    expect(useOutputStylesStore.getState().addStyle({ name: "x", content: "  " })).toBeNull();
    expect(useOutputStylesStore.getState().customStyles).toHaveLength(0);
  });

  it("replaces an existing style when re-using a name case-insensitively", () => {
    const store = useOutputStylesStore.getState();
    store.addStyle({ name: "Concise", content: "Old body" });
    useOutputStylesStore.getState().addStyle({ name: "concise", content: "New body" });

    const styles = useOutputStylesStore.getState().customStyles;
    expect(styles).toHaveLength(1);
    expect(styles[0]?.content).toBe("New body");
  });

  it("removes styles by id", () => {
    const style = useOutputStylesStore.getState().addStyle({ name: "Concise", content: "Body" });
    useOutputStylesStore.getState().removeStyle(style?.id ?? "");
    expect(useOutputStylesStore.getState().customStyles).toHaveLength(0);
  });

  it("migrates persisted state and drops malformed entries", () => {
    const migrated = migratePersistedOutputStylesState({
      customStyles: [
        { id: "a", name: "Valid", content: "Body", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "", name: "No id", content: "Body" },
        { id: "b", name: "   ", content: "Blank name" },
        { id: "c", name: "No content", content: "" },
        "not-an-object",
      ],
    });
    expect(migrated.customStyles).toHaveLength(1);
    expect(migrated.customStyles[0]?.name).toBe("Valid");
  });

  it("caps runaway name and content lengths", () => {
    expect(normalizeOutputStyleName("x".repeat(500))).toHaveLength(64);
    expect(normalizeOutputStyleContent("x".repeat(100_000)).length).toBeLessThanOrEqual(20_000);
  });
});
