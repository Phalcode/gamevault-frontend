// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeServerOutdatedNotice,
  isServerVersionTooOld,
  parseVersionParts,
  readServerOutdatedNoticeAck,
  SERVER_OUTDATED_NOTICE_KEY,
  serverOutdatedAckKey,
  serverOutdatedNoticeContent,
} from "./serverCompatibility";

describe("parseVersionParts", () => {
  it("parses full and partial versions", () => {
    expect(parseVersionParts("17.1.2")).toEqual({
      major: 17,
      minor: 1,
      patch: 2,
    });
    expect(parseVersionParts("v17.2")).toEqual({
      major: 17,
      minor: 2,
      patch: 0,
    });
    expect(parseVersionParts("18")).toEqual({ major: 18, minor: 0, patch: 0 });
    expect(parseVersionParts(" 16.0.0 ")).toEqual({
      major: 16,
      minor: 0,
      patch: 0,
    });
  });

  it("returns null for unknown versions", () => {
    expect(parseVersionParts(null)).toBeNull();
    expect(parseVersionParts(undefined)).toBeNull();
    expect(parseVersionParts("")).toBeNull();
    expect(parseVersionParts("dev")).toBeNull();
    expect(parseVersionParts("unstable")).toBeNull();
  });
});

describe("isServerVersionTooOld", () => {
  it("warns when the server has an older major version", () => {
    expect(isServerVersionTooOld("17.2.0", "16.9.9")).toBe(true);
    expect(isServerVersionTooOld("17.0.0", "17.1.0")).toBe(false);
  });

  it("does not warn for a newer major version", () => {
    expect(isServerVersionTooOld("17.2.0", "18.0.0")).toBe(false);
  });

  it("does not warn when a version is unknown", () => {
    expect(isServerVersionTooOld("dev", "16.2.1")).toBe(false);
    expect(isServerVersionTooOld("17.2.0", "unknown")).toBe(false);
  });
});

describe("serverOutdatedAckKey", () => {
  it("changes with the client major and the server version", () => {
    const key = serverOutdatedAckKey("17.2.0", "16.3.1");

    expect(key).toBe("17:16.3.1");
    expect(serverOutdatedAckKey("17.3.0", "16.3.1")).toBe(key);
    expect(serverOutdatedAckKey("18.0.0", "16.3.1")).not.toBe(key);
    expect(serverOutdatedAckKey("17.2.0", "16.3.2")).not.toBe(key);
  });

  it("returns null when a version cannot be parsed", () => {
    expect(serverOutdatedAckKey("17.2.0", "unknown")).toBeNull();
  });
});

describe("notice acknowledgement", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers the acknowledged warning", () => {
    expect(readServerOutdatedNoticeAck()).toBeNull();

    acknowledgeServerOutdatedNotice("17:16.3.1");

    expect(readServerOutdatedNoticeAck()).toBe("17:16.3.1");
    expect(localStorage.getItem(SERVER_OUTDATED_NOTICE_KEY)).toBe("17:16.3.1");
  });
});

describe("serverOutdatedNoticeContent", () => {
  it("names both versions and the expected major", () => {
    const content = serverOutdatedNoticeContent("17.2.0", "16.3.1");

    expect(content.title).toBe("Server is outdated");
    expect(content.description).toContain("17.2.0");
    expect(content.description).toContain("16.3.1");
    expect(content.description).toContain("17.x");
  });
});
