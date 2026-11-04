/**
 * Builds the `Authorization` header for HTTP Basic authentication.
 *
 * `btoa()` treats its input as ISO-8859-1, while the GameVault server decodes
 * the credentials as UTF-8. Encoding the UTF-8 bytes by hand keeps passwords
 * containing characters like `ä`, `ö`, `ü`, `ß` or an emoji intact. RFC 7617
 * also specifies UTF-8 for Basic credentials.
 */
export function encodeBasicAuthorizationHeader(
  username: string,
  password: string,
): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${btoa(binary)}`;
}
