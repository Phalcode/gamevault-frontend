/**
 * Extracts a user-friendly error message from an HTTP response.
 *
 * Backend errors are JSON shaped like `{ message, error, statusCode }`. This
 * reads the body once, prefers the backend `message`, then falls back to the
 * HTTP status text and finally to `fallback`, so the UI never shows raw JSON.
 */
export async function getErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    // Ignore failures reading the body.
  }

  if (bodyText.trim()) {
    try {
      const parsed = JSON.parse(bodyText);
      const msg =
        typeof parsed?.message === "string" && parsed.message.trim()
          ? parsed.message.trim()
          : "";
      if (msg) return msg;
    } catch {
      // Body wasn't JSON; fall through to status/generic.
    }
  }

  return res.statusText?.trim() || fallback;
}
