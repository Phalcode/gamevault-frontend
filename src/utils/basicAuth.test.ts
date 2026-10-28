import { describe, expect, it } from "vitest";
import { encodeBasicAuthorizationHeader } from "./basicAuth";

/** Reverses the header the way the server does: base64 -> UTF-8 text. */
function decodeHeader(header: string): string {
  const base64 = header.replace(/^Basic /, "");
  const bytes = Uint8Array.from(atob(base64), (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

describe("encodeBasicAuthorizationHeader", () => {
  it("encodes plain ASCII credentials", () => {
    expect(
      decodeHeader(encodeBasicAuthorizationHeader("alice", "secret123")),
    ).toBe("alice:secret123");
  });

  it("keeps umlauts in the password intact", () => {
    expect(
      decodeHeader(encodeBasicAuthorizationHeader("alice", "pässwort123")),
    ).toBe("alice:pässwort123");
  });

  it("keeps other non-ASCII characters intact", () => {
    expect(
      decodeHeader(encodeBasicAuthorizationHeader("alice", "pässwörd-ß-é")),
    ).toBe("alice:pässwörd-ß-é");
  });

  it("does not throw on characters outside the Latin-1 range", () => {
    expect(
      decodeHeader(encodeBasicAuthorizationHeader("alice", "pässwort-🎮")),
    ).toBe("alice:pässwort-🎮");
  });

  it("keeps colons inside the password", () => {
    expect(
      decodeHeader(encodeBasicAuthorizationHeader("alice", "pa:ss:word")),
    ).toBe("alice:pa:ss:word");
  });
});
