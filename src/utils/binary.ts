/**
 * Binary ⇄ Base64 helpers for the Tauri IPC boundary.
 *
 * Tauri's default IPC serialises a Rust `Vec<u8>` — in either direction — as a
 * JSON array of numbers. For an image of a few MB that becomes a JS array with
 * millions of entries: a huge synchronous allocation on the renderer's main
 * thread (the field log showed heap spikes up to ~140MB right after the library
 * loaded) plus an equally huge JSON payload/response. The native commands now
 * take and return Base64 instead, and these helpers convert without ever
 * materialising such an array.
 */

/** Base64 of a Blob (no `data:` URL prefix), via FileReader so the bytes are
 *  never spread into a giant argument list. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read binary data"));
    reader.readAsDataURL(blob);
  });
}

/** Decodes Base64 into a Uint8Array (single allocation, no number array). */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Decodes Base64 into a Blob. Pass the media type when it is known. */
export function base64ToBlob(base64: string, contentType = ""): Blob {
  return new Blob([base64ToBytes(base64)], { type: contentType });
}
