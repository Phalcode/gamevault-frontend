import { describe, expect, it, vi } from "vitest";
import {
  applyDroppedSources,
  extractFirstUrl,
  extractImageCandidatesFromDataTransfer,
  extractImgSrcsFromHtml,
  pickBestImageUrl,
} from "./droppedImage";

const PAGE_URL = "https://store.steampowered.com/app/123456/Some_Game";
const IMAGE_URL =
  "https://cdn.akamai.steamstatic.com/steam/apps/123456/header.jpg";

function fakeDrop(data: Record<string, string>) {
  return { getData: (format: string) => data[format] ?? "" };
}

describe("droppedImage URL extraction", () => {
  it("extractFirstUrl pulls the URL and drops trailing link text", () => {
    expect(extractFirstUrl(`${IMAGE_URL} 45 - phalanx`)).toBe(IMAGE_URL);
    expect(extractFirstUrl("plain text without urls")).toBeNull();
    expect(extractFirstUrl("file:///home/user/image.png")).toBeNull();
  });

  it("extractImgSrcsFromHtml returns img src URLs", () => {
    const html = `<meta charset='utf-8'><img src="${IMAGE_URL}" alt="art">`;
    expect(extractImgSrcsFromHtml(html)).toEqual([IMAGE_URL]);
    expect(extractImgSrcsFromHtml("<p>no images</p>")).toEqual([]);
  });

  it("extractImgSrcsFromHtml decodes HTML entities in src", () => {
    const html = `<img src="https://cdn.example.com/a.jpg?x=1&amp;y=2">`;
    expect(extractImgSrcsFromHtml(html)).toEqual([
      "https://cdn.example.com/a.jpg?x=1&y=2",
    ]);
  });

  it("extractImageCandidatesFromDataTransfer prioritizes html img src, dedupes", () => {
    const dt = fakeDrop({
      "text/html": `<img src="${IMAGE_URL}">`,
      "text/uri-list": `${PAGE_URL}\n${IMAGE_URL}`,
      "text/plain": PAGE_URL,
    });
    expect(extractImageCandidatesFromDataTransfer(dt)).toEqual([
      IMAGE_URL,
      PAGE_URL,
    ]);
  });

  it("extractImageCandidatesFromDataTransfer ignores uri-list comments", () => {
    const dt = fakeDrop({
      "text/uri-list": `# comment\n${IMAGE_URL}\n${PAGE_URL}`,
    });
    expect(extractImageCandidatesFromDataTransfer(dt)).toEqual([
      IMAGE_URL,
      PAGE_URL,
    ]);
  });

  it("pickBestImageUrl prefers a direct image link over the page URL", () => {
    expect(pickBestImageUrl([PAGE_URL, IMAGE_URL])).toBe(IMAGE_URL);
    expect(pickBestImageUrl([PAGE_URL])).toBe(PAGE_URL);
    expect(pickBestImageUrl([])).toBeNull();
  });
});

describe("applyDroppedSources", () => {
  it("prefers a direct image URL even when the page URL comes first", async () => {
    const onUrl = vi.fn();
    const onFile = vi.fn();
    const applied = await applyDroppedSources(
      [PAGE_URL, `${IMAGE_URL} 45 - phalanx`],
      { onUrl, onFile },
    );
    expect(applied).toBe(true);
    expect(onUrl).toHaveBeenCalledWith(IMAGE_URL);
    expect(onFile).not.toHaveBeenCalled();
  });

  it("applies a single image URL source", async () => {
    const onUrl = vi.fn();
    const applied = await applyDroppedSources([IMAGE_URL], {
      onUrl,
      onFile: vi.fn(),
    });
    expect(applied).toBe(true);
    expect(onUrl).toHaveBeenCalledWith(IMAGE_URL);
  });
});
