import { describe, expect, it } from "vitest";
import { getRoleLabel } from "./roles";

describe("getRoleLabel", () => {
  it("maps known roles to their labels", () => {
    expect(getRoleLabel(0)).toBe("Guest");
    expect(getRoleLabel(1)).toBe("User");
    expect(getRoleLabel(2)).toBe("Editor");
    expect(getRoleLabel(3)).toBe("Admin");
  });

  it("returns '' for null or undefined", () => {
    expect(getRoleLabel(null)).toBe("");
    expect(getRoleLabel(undefined)).toBe("");
  });

  it("falls back to the numeric value for unknown roles", () => {
    expect(getRoleLabel(99)).toBe("99");
  });

  it("handles numeric strings", () => {
    expect(getRoleLabel("2" as unknown as number)).toBe("Editor");
  });
});
