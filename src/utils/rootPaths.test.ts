// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRootPath,
  getRootPaths,
  removeRootPath,
  setRootPaths,
  updateRootPath,
  updateRootPathLabel,
  type RootPathEntry,
} from "./rootPaths";

const ROOT_PATHS_KEY = "tauri_download_paths";
const LEGACY_KEY = "tauri_download_path";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", {
    randomUUID: (() => {
      let n = 0;
      return () => `test-uuid-${++n}`;
    })(),
  });
});

describe("getRootPaths", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(getRootPaths()).toEqual([]);
  });

  it("migrates the legacy single path to the array format", () => {
    localStorage.setItem(LEGACY_KEY, "/games ");
    const result = getRootPaths();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/games");
    expect(result[0].id).toBe("test-uuid-1");
    // Migration writes the array and removes the legacy key.
    expect(localStorage.getItem(ROOT_PATHS_KEY)).toContain("/games");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("returns empty for corrupt JSON", () => {
    localStorage.setItem(ROOT_PATHS_KEY, "{not json");
    expect(getRootPaths()).toEqual([]);
  });

  it("filters out invalid entries", () => {
    localStorage.setItem(
      ROOT_PATHS_KEY,
      JSON.stringify([
        { id: "ok", path: "/x", label: "" },
        { id: "", path: "/y", label: "" },
        { id: "no-path", path: "   ", label: "" },
      ]),
    );
    const result = getRootPaths();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ok");
  });
});

describe("addRootPath", () => {
  it("adds a new path and returns the updated array", () => {
    const result = addRootPath("/games");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/games");
    expect(getRootPaths()).toHaveLength(1);
  });

  it("deduplicates by normalized path", () => {
    addRootPath("/Games");
    const result = addRootPath("/games");
    expect(result).toHaveLength(1);
  });

  it("ignores blank paths", () => {
    expect(addRootPath("   ")).toEqual([]);
  });
});

describe("removeRootPath", () => {
  it("removes by id and clears the legacy key when empty", () => {
    const added = addRootPath("/games");
    const id = added[0].id;
    localStorage.setItem(LEGACY_KEY, "/old");
    const result = removeRootPath(id);
    expect(result).toEqual([]);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});

describe("updateRootPathLabel", () => {
  it("updates an existing entry's label", () => {
    const added = addRootPath("/games");
    const id = added[0].id;
    const result = updateRootPathLabel(id, "My Games");
    expect(result[0].label).toBe("My Games");
  });
});

describe("updateRootPath", () => {
  it("updates an existing entry's path", () => {
    const added = addRootPath("/games");
    const id = added[0].id;
    const result = updateRootPath(id, "/new");
    expect(result[0].path).toBe("/new");
  });

  it("ignores blank paths", () => {
    const added = addRootPath("/games");
    const id = added[0].id;
    const result = updateRootPath(id, "   ");
    expect(result[0].path).toBe("/games");
  });
});
