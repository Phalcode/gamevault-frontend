// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  PRERELEASE_NOTICE_KEY,
  isPrereleaseChannel,
  markPrereleaseNoticeSeen,
  prereleaseChannelOfBuild,
  prereleaseNoticeContent,
  shouldShowPrereleaseNotice,
} from "./prereleaseNotice";

beforeEach(() => {
  localStorage.clear();
});

describe("isPrereleaseChannel", () => {
  it("treats early-access and unstable as pre-release channels", () => {
    expect(isPrereleaseChannel("early-access")).toBe(true);
    expect(isPrereleaseChannel("unstable")).toBe(true);
  });

  it("treats stable as a regular channel", () => {
    expect(isPrereleaseChannel("stable")).toBe(false);
  });
});

describe("prereleaseChannelOfBuild", () => {
  it("returns null for builds without a pre-release channel", () => {
    // Tests run with __BUILD_CHANNEL__ = "dev", which is not a pre-release.
    expect(prereleaseChannelOfBuild()).toBeNull();
  });
});

describe("shouldShowPrereleaseNotice", () => {
  it("shows the notice until that channel has been acknowledged", () => {
    expect(shouldShowPrereleaseNotice("unstable")).toBe(true);

    markPrereleaseNoticeSeen("unstable");
    expect(shouldShowPrereleaseNotice("unstable")).toBe(false);
    // The other pre-release channel has its own, unrelated warning.
    expect(shouldShowPrereleaseNotice("early-access")).toBe(true);
    expect(localStorage.getItem(PRERELEASE_NOTICE_KEY)).toBe("unstable");
  });
});

describe("prereleaseNoticeContent", () => {
  it("warns unstable users about development builds", () => {
    const { title, description } = prereleaseNoticeContent(
      "unstable",
      "17.1.0-unstable.42.1",
    );
    expect(title).toContain("unstable");
    expect(description).toContain("17.1.0-unstable.42.1");
    expect(description).toContain("developers and testers");
    expect(description).toContain("additional setup steps may be necessary");
    expect(description).toContain("Stable update channel");
  });

  it("warns Early Access users about the program", () => {
    const { title, description } = prereleaseNoticeContent(
      "early-access",
      "17.1.0-ea.7.2",
    );
    expect(title).toContain("Early Access");
    expect(description).toContain("17.1.0-ea.7.2");
    expect(description).toContain("early access program");
    expect(description).toContain("additional setup steps may be necessary");
    expect(description).toContain("Stable update channel");
  });
});
