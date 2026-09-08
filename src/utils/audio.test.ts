// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_VOLUME_EVENT,
  DEFAULT_AUDIO_VOLUME,
  getAudioVolume,
  playSound,
  setAudioVolume,
} from "./audio";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getAudioVolume / setAudioVolume", () => {
  it("defaults the volume", () => {
    expect(getAudioVolume()).toBe(DEFAULT_AUDIO_VOLUME);
  });

  it("persists and clamps the volume", () => {
    setAudioVolume(1.5);
    expect(getAudioVolume()).toBe(1);
    setAudioVolume(-1);
    expect(getAudioVolume()).toBe(0);
    setAudioVolume(0.4);
    expect(getAudioVolume()).toBe(0.4);
    expect(localStorage.getItem("gv_audio_volume")).toBe("0.4");
  });

  it("broadcasts a volume change event", () => {
    const spy = vi.spyOn(window, "dispatchEvent");
    setAudioVolume(0.5);
    const dispatched = spy.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === AUDIO_VOLUME_EVENT,
    );
    expect((dispatched?.[0] as CustomEvent).detail).toEqual({ volume: 0.5 });
  });
});

describe("playSound", () => {
  it("plays a fetched sound and returns the audio element", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["x"]),
    }));
    (URL as any).createObjectURL = vi.fn(() => "blob:mock");

    const play = vi.fn().mockResolvedValue(undefined);
    const audio = { volume: 1, play, addEventListener: vi.fn() } as any;
    function FakeAudio(): any {
      return audio;
    }
    vi.stubGlobal("Audio", FakeAudio);

    const result = await playSound("pop");
    expect(result).toBe(audio);
    expect(play).toHaveBeenCalled();
  });

  it("returns null when autoplay is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["x"]),
    }));
    (URL as any).createObjectURL = vi.fn(() => "blob:mock");
    const play = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    const audio = { volume: 1, play, addEventListener: vi.fn() } as any;
    function FakeAudio(): any {
      return audio;
    }
    vi.stubGlobal("Audio", FakeAudio);

    await expect(playSound("pop")).resolves.toBeNull();
  });
});
