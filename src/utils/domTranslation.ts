import {
  ensureBergamotModelLoaded,
  translateStringsWithBergamot,
} from "./bergamotEngine";
import {
  flushTranslationCache,
  getCachedTranslation,
  isTranslationCacheLoaded,
  loadTranslationCache,
  rememberTranslations,
} from "./translationCache";

/**
 * Translates the app's own interface text in place, using the local Bergamot
 * engine.
 *
 * Game titles, tags, descriptions, user names and other content are marked
 * with `translate="no"` in the UI and are skipped here, so proper names and
 * user-written text stay untouched. Content that should be translatable on
 * demand (game description, notes) opts in through an explicit button instead.
 *
 * A MutationObserver picks up text React renders after the initial pass, e.g.
 * when navigating or loading more games.
 */

/** Elements whose text is never interface copy. */
const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
  "SVG",
  "CANVAS",
  "IFRAME",
]);

/** Elements that opted out of translation (content, not chrome). */
const NO_TRANSLATE_SELECTOR = '[translate="no"], [data-no-translate]';

const MAX_BATCH_CHARS = 2000;
const MAX_BATCH_NODES = 40;
const FLUSH_DELAY_MS = 40;

export interface UiTranslationState {
  status: "idle" | "translating" | "active" | "error";
  /** Number of text nodes translated in this session. */
  translated: number;
  error?: string;
}

let language: string | null = null;
let startPromise: Promise<void> | null = null;
let observer: MutationObserver | null = null;
let flushTimer: number | null = null;
let lastState: UiTranslationState = { status: "idle", translated: 0 };
const listeners = new Set<(state: UiTranslationState) => void>();

/** Original text per node, so the page can be restored exactly. */
const originals = new Map<Text, string>();
/** Last translation written per node, so a re-walk can skip it. */
const written = new Map<Text, string>();
/** Nodes waiting to be translated. */
const queue = new Set<Text>();

function emit(state: UiTranslationState): void {
  lastState = state;
  for (const listener of listeners) listener(state);
}

/** Subscribes to translation progress; returns an unsubscribe function. */
export function onUiTranslationState(
  listener: (state: UiTranslationState) => void,
): () => void {
  listeners.add(listener);
  listener(lastState);
  return () => listeners.delete(listener);
}

export function translatedUiLanguage(): string | null {
  return language;
}

/** Text that is worth sending to the engine. */
function isTranslatable(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  // Needs at least two letters; skips numbers, sizes, dates, punctuation.
  if (!/\p{L}.*\p{L}/u.test(trimmed)) return false;
  // URLs, paths, e-mail addresses and hashes are not interface copy.
  if (/^(?:https?:\/\/|mailto:|\/|\\)/i.test(trimmed)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(trimmed)) return false;
  if (/^[0-9a-f]{16,}$/i.test(trimmed)) return false;
  return true;
}

function isInsideSkippedElement(element: Element | null): boolean {
  if (!element) return true;
  if (SKIP_TAGS.has(element.tagName)) return true;
  if ((element as HTMLElement).isContentEditable === true) return true;
  return element.closest(NO_TRANSLATE_SELECTOR) !== null;
}

/** Collects text nodes under `root` that should be translated. */
function collectTextNodes(root: Node, into: Set<Text>): void {
  if (root.nodeType === Node.TEXT_NODE) {
    considerNode(root as Text, into);
    return;
  }
  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_NODE
  ) {
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    considerNode(current as Text, into);
    current = walker.nextNode();
  }
}

function considerNode(node: Text, into: Set<Text>): void {
  const value = node.nodeValue ?? "";
  if (!isTranslatable(value)) return;
  if (isInsideSkippedElement(node.parentElement)) return;
  // Still holding our translation: nothing to do. If React wrote the original
  // English back, the values differ and the node is queued again.
  if (written.get(node) === value) return;
  // Known string: replace it right here. MutationObserver callbacks run before
  // the browser paints, so a cached translation never shows the English text.
  if (language && applyCachedTranslation(node, language)) return;
  into.add(node);
}

/** Writes a cached translation to `node`; returns false when there is none. */
function applyCachedTranslation(node: Text, target: string): boolean {
  const value = node.nodeValue ?? "";
  const cached = getCachedTranslation(target, value);
  if (!cached || cached === value) return false;
  if (!originals.has(node)) originals.set(node, value);
  written.set(node, cached);
  node.nodeValue = cached;
  return true;
}

/**
 * Applies every cached translation under `root`, synchronously. Used before
 * the first paint so the initial screen never shows English for strings the
 * cache already knows.
 */
export function applyCachedUiTranslations(
  target: string,
  root: Node = document.body,
): number {
  if (!isTranslationCacheLoaded(target)) return 0;

  let applied = 0;
  const apply = (node: Text) => {
    const value = node.nodeValue ?? "";
    if (!isTranslatable(value)) return;
    if (isInsideSkippedElement(node.parentElement)) return;
    if (written.get(node) === value) return;
    if (applyCachedTranslation(node, target)) applied += 1;
  };

  if (root.nodeType === Node.TEXT_NODE) {
    apply(root as Text);
    return applied;
  }
  if (
    root.nodeType !== Node.ELEMENT_NODE &&
    root.nodeType !== Node.DOCUMENT_NODE
  ) {
    return 0;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    apply(current as Text);
    current = walker.nextNode();
  }
  return applied;
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_DELAY_MS);
}

async function flushQueue(): Promise<void> {
  const target = language;
  if (!target) return;

  while (queue.size > 0) {
    const batch: Text[] = [];
    let chars = 0;
    for (const node of queue) {
      queue.delete(node);
      const value = node.nodeValue ?? "";
      if (!isTranslatable(value)) continue;
      if (isInsideSkippedElement(node.parentElement)) continue;
      // Another pass may have cached this string in the meantime.
      if (applyCachedTranslation(node, target)) continue;
      batch.push(node);
      chars += value.length;
      if (batch.length >= MAX_BATCH_NODES || chars >= MAX_BATCH_CHARS) break;
    }
    if (batch.length === 0) continue;

    const texts = batch.map((node) => node.nodeValue ?? "");
    try {
      const translated = await translateStringsWithBergamot(texts, target);
      // React may have re-rendered while the engine was busy.
      writeBack(target, batch, texts, translated);
      emit({
        status: "active",
        translated: lastState.translated + batch.length,
      });
    } catch (error) {
      emit({
        status: "error",
        translated: lastState.translated,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (lastState.status === "translating") {
    emit({ status: "active", translated: lastState.translated });
  }
}

function writeBack(
  target: string,
  batch: Text[],
  before: string[],
  translated: string[],
): void {
  // A language switch or "off" while the engine was busy must win.
  if (language !== target) return;

  const remembered: [string, string][] = [];

  // Our own writes must not feed the observer again.
  const observing = observer !== null;
  if (observing) observer?.disconnect();
  try {
    batch.forEach((node, index) => {
      const next = translated[index];
      if (typeof next !== "string" || next.length === 0) return;
      if ((node.nodeValue ?? "") !== before[index]) return;
      if (!originals.has(node)) originals.set(node, before[index]);
      written.set(node, next);
      node.nodeValue = next;
      remembered.push([before[index], next]);
    });
  } finally {
    if (observing && observer) observe();
  }

  if (remembered.length > 0) rememberTranslations(target, remembered);
}

function observe(): void {
  observer?.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

function handleMutations(records: MutationRecord[]): void {
  let scheduled = false;
  for (const record of records) {
    if (record.type === "characterData") {
      const before = queue.size;
      considerNode(record.target as Text, queue);
      scheduled = scheduled || queue.size !== before;
      continue;
    }
    for (const added of record.addedNodes) {
      if (added.nodeType === Node.TEXT_NODE) {
        const before = queue.size;
        considerNode(added as Text, queue);
        scheduled = scheduled || queue.size !== before;
      } else if (added.nodeType === Node.ELEMENT_NODE) {
        const before = queue.size;
        collectTextNodes(added, queue);
        scheduled = scheduled || queue.size !== before;
      }
    }
  }
  if (scheduled) scheduleFlush();
}

/**
 * Starts translating the interface into `language`. The model has to be
 * downloaded already; this only loads it and walks the DOM.
 *
 * Known strings are applied synchronously from the cache, so a warm start
 * never paints English. Only strings the cache does not know go to the engine.
 */
export async function startUiTranslation(target: string): Promise<void> {
  if (language === target) {
    // React StrictMode runs effects twice; never restart a running pass.
    if (startPromise) return startPromise;
    if (lastState.status !== "error") {
      emit({ status: "active", translated: lastState.translated });
    }
    return;
  }

  if (language) {
    // Switching language: restore the previous translation first.
    stopUiTranslation();
  } else {
    // Fresh start: keep the cached pass that ran before the first paint.
    resetPass();
  }
  startPromise = null;
  language = target;
  emit({ status: "translating", translated: 0 });

  const run = (async () => {
    // Load the model before touching the DOM so a failure leaves the page alone.
    await ensureBergamotModelLoaded(target).catch((error) => {
      language = null;
      emit({
        status: "error",
        translated: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    });

    // Everything the cache knows is written before the engine is asked for
    // anything, keep that pass ahead of the first observer flush.
    await loadTranslationCache(target);
    applyCachedUiTranslations(target);

    collectTextNodes(document.body, queue);
    observer = new MutationObserver(handleMutations);
    observe();
    await flushQueue();
  })();

  startPromise = run;
  try {
    await run;
  } finally {
    if (startPromise === run) startPromise = null;
  }
}

/** Disconnects the observer and drops pending work, keeping applied text. */
function resetPass(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  observer?.disconnect();
  observer = null;
  queue.clear();
}

/** Restores the original English text and stops translating. */
export function stopUiTranslation(): void {
  resetPass();
  startPromise = null;

  for (const [node, original] of originals) {
    if (node.isConnected) node.nodeValue = original;
  }
  originals.clear();
  written.clear();
  language = null;
  emit({ status: "idle", translated: 0 });
  // Keep what was learned for the next start or language switch.
  void flushTranslationCache();
}

/** Restores one node's original text (used by on-demand translations). */
export function translateTextOnDemand(
  text: string,
  target: string,
): Promise<string> {
  return translateStringsWithBergamot([text], target).then(
    (result) => result[0] ?? text,
  );
}
