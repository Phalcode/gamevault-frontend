import { useEffect, useRef, useState } from "react";

/**
 * Returns a ref and an `inView` flag that flips to `true` (and stays there)
 * once the element enters the viewport (or the extended `rootMargin` band).
 *
 * Used to defer expensive work — e.g. fetching a media blob — until the
 * element is actually near the screen, so scrolling a long list doesn't
 * trigger a burst of requests for images the user has not reached yet.
 *
 * The observer disconnects after the first intersection, so this is a
 * one-way transition. Elements that are already in the viewport on mount
 * resolve on the first observer callback (a frame later).
 */
export function useInView<T extends HTMLElement>(
  rootMargin = "600px",
  initial = false,
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(initial);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { ref, inView };
}
