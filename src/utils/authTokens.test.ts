import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeNextTokenRefresh,
  isAuthError,
  parseJwt,
} from "./authTokens";

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeToken(payload: Record<string, unknown>): string {
  return `${b64url("{}")}.${b64url(JSON.stringify(payload))}.${b64url("sig")}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseJwt", () => {
  it("decodes a valid token payload", () => {
    expect(parseJwt(makeToken({ exp: 123, sub: "u1" }))).toEqual({
      exp: 123,
      sub: "u1",
    });
  });

  it("returns null for a malformed token", () => {
    expect(parseJwt("only-one-part")).toBeNull();
    expect(parseJwt("a.b")).toBeNull();
    expect(parseJwt("")).toBeNull();
  });

  it("returns null when the payload is not valid JSON", () => {
    const token = `${b64url("{}")}.${b64url("not-json")}.${b64url("sig")}`;
    expect(parseJwt(token)).toBeNull();
  });
});

describe("computeNextTokenRefresh", () => {
  it("schedules a refresh at now + token lifetime when exp/creation present", () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const token = makeToken({ exp: 10000, iat: 5000 });
    const result = computeNextTokenRefresh(token);
    expect(result.getTime()).toBe(now + (10000 - 5000) * 1000);
  });

  it("falls back to exp*1000 when creation is missing", () => {
    const token = makeToken({ exp: 2000000000 });
    const result = computeNextTokenRefresh(token);
    expect(result.getTime()).toBe(2000000000 * 1000);
  });

  it("returns a Date for invalid/unparseable tokens", () => {
    expect(computeNextTokenRefresh("nope")).toBeInstanceOf(Date);
    expect(computeNextTokenRefresh(makeToken({}))).toBeInstanceOf(Date);
  });
});

describe("isAuthError", () => {
  it("matches HTTP status codes and auth wording", () => {
    expect(isAuthError("401 Unauthorized")).toBe(true);
    expect(isAuthError(new Error("403 Forbidden"))).toBe(true);
    expect(isAuthError("Invalid or expired refresh token")).toBe(true);
    expect(isAuthError("Unauthorized")).toBe(true);
    expect(isAuthError(new Error("backend said 401"))).toBe(true);
    // A non-Error object without a message stringifies to "[object Object]".
    expect(isAuthError({ status: 401 })).toBe(false);
  });

  it("does not match transient network errors", () => {
    expect(isAuthError("Failed to fetch")).toBe(false);
    expect(isAuthError("NetworkError: Connection refused")).toBe(false);
    expect(isAuthError("")).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});
