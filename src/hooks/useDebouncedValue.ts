import { useEffect, useState } from "react";

/**
 * Returns `value` only once it has been stable for `delay` ms.
 *
 * Useful for inputs like search boxes where the value changes on every
 * keystroke but the downstream effect (e.g. an API request) should not fire
 * until the user pauses typing. This prevents spamming the backend.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeoutId);
  }, [value, delay]);

  return debounced;
}
