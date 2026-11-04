import { useDeepLinks } from "@/hooks/useDeepLinks";

/**
 * Headless bridge between the desktop URL scheme (`gamevault://`) and the
 * router. Renders nothing; mounted once inside the router.
 */
export default function DeepLinkHandler() {
  useDeepLinks();
  return null;
}
