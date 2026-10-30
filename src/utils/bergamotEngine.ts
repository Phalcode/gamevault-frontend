/**
 * Bergamot translation engine, running locally in a Web Worker.
 *
 * The engine is Mozilla's CPU-optimised NMT runtime, the one Firefox ships for
 * its built-in translation. Its worker and WASM files are copied into
 * `public/bergamot-engine` from the npm package at dev/build time, so the
 * repository stays free of binaries.
 *
 * Models are Mozilla's published English→X models. They are downloaded once
 * per language, stored as the original gzip archives, and decompressed into
 * memory when the engine loads them. Desktop builds keep them in the app data
 * folder, because the installer clears the webview storage on updates; the web
 * build uses the Cache API.
 */

const REGISTRY_URL =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json";
const FILE_BASE_URL =
  "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/";

/** Language the interface is written in. */
export const BERGAMOT_SOURCE_LANGUAGE = "en";

const ENGINE_DIR = "bergamot-engine/";
const MODEL_CACHE = "gv-bergamot-models-v1";

/** Cache API keys must be http(s) URLs, so derive one from the app origin. */
const registryCacheKey = () => `${location.origin}/__bergamot/registry.json`;

/**
 * The desktop webviews do not always have a usable Cache API (custom scheme),
 * so the registry gets a second home in localStorage. It is only 190 kB and it
 * keeps the language picker working offline.
 */
const REGISTRY_STORAGE_KEY = "gv_bergamot_registry";

/** Archive names as they exist on Mozilla's storage bucket. */
const ARCHIVE = {
  model: "model.gz",
  shortlist: "shortlist.gz",
  vocab: "vocab.gz",
  srcVocab: "srcvocab.gz",
  trgVocab: "trgvocab.gz",
} as const;

interface RegistryFile {
  path: string;
  uncompressedSize?: number;
}

interface RegistryEntry {
  architecture?: string;
  releaseStatus?: string;
  files?: Partial<
    Record<
      "model" | "lexicalShortlist" | "vocab" | "srcVocab" | "trgVocab",
      RegistryFile
    >
  >;
}

interface Registry {
  models: Record<string, RegistryEntry[]>;
}

export interface BergamotModelStatus {
  language: string;
  ready: boolean;
  /** Download size of the stored archives, in bytes. */
  bytes: number;
}

/** What has to be downloaded for one language. */
export interface BergamotModelPlan {
  language: string;
  /** Archive name → download URL. */
  files: { name: string; url: string }[];
  /** Archive names holding the vocabularies, in the order the engine expects. */
  vocabularies: string[];
}

let registryPromise: Promise<Registry> | null = null;

async function cacheMatch(key: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(key);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function cacheWrite(key: string, body: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(MODEL_CACHE);
    await cache.put(key, new Response(body));
  } catch {
    // Cache unavailable: the model stays in memory for this session.
  }
}

/** True inside the Tauri webview, where the Rust model store is available. */
function hasDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeDesktop<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(command, args);
}

async function loadRegistry(): Promise<Registry> {
  if (registryPromise) return registryPromise;

  registryPromise = (async () => {
    const cached = await cacheMatch(registryCacheKey());
    if (cached) {
      try {
        return JSON.parse(new TextDecoder().decode(cached)) as Registry;
      } catch {
        // Corrupt cache entry: fetch a fresh copy below.
      }
    }

    const stored = readStoredRegistry();
    if (stored) return stored;

    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      throw new Error(`Model registry unavailable (${response.status})`);
    }
    const text = await response.text();
    storeRegistry(text);
    await cacheWrite(registryCacheKey(), new TextEncoder().encode(text).buffer);
    return JSON.parse(text) as Registry;
  })();

  try {
    return await registryPromise;
  } catch (error) {
    registryPromise = null;
    throw error;
  }
}

function readStoredRegistry(): Registry | null {
  try {
    const raw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Registry) : null;
  } catch {
    return null;
  }
}

function storeRegistry(text: string): void {
  try {
    localStorage.setItem(REGISTRY_STORAGE_KEY, text);
  } catch {
    // Storage full or blocked: the network fetch still works for this session.
  }
}

function pickEntry(entries: RegistryEntry[] | undefined): RegistryEntry | null {
  if (!entries || entries.length === 0) return null;
  const released = entries.filter(
    (entry) => entry.releaseStatus === "Release" && entry.files?.model,
  );
  const pool = released.length > 0 ? released : entries;
  return (
    pool.find((entry) => entry.architecture === "base-memory") ??
    pool.find((entry) => entry.architecture === "base") ??
    pool[0] ??
    null
  );
}

/**
 * Resolves the archives for a language. Some models ship one shared
 * vocabulary, others a separate source and target one.
 */
export async function resolveBergamotModelPlan(
  language: string,
): Promise<BergamotModelPlan> {
  if (hasDesktopRuntime()) {
    // A stored plan keeps a downloaded model working offline, long after the
    // registry is out of reach.
    try {
      const stored = await invokeDesktop<{
        files: { name: string; url: string }[];
        vocabularies?: string[];
      } | null>("read_bergamot_model_plan", { language });
      if (stored?.files?.length) {
        return {
          language,
          files: stored.files,
          vocabularies: stored.vocabularies ?? [],
        };
      }
    } catch {
      // No stored plan yet: fall back to the registry below.
    }
  }

  const registry = await loadRegistry();
  const entry = pickEntry(
    registry.models[`${BERGAMOT_SOURCE_LANGUAGE}-${language}`],
  );
  const files = entry?.files;
  const model = files?.model;
  const shortlist = files?.lexicalShortlist;
  if (!model || !shortlist) {
    throw new Error(`No translation model available for "${language}"`);
  }

  const plan: BergamotModelPlan = {
    language,
    files: [
      { name: ARCHIVE.model, url: FILE_BASE_URL + model.path },
      { name: ARCHIVE.shortlist, url: FILE_BASE_URL + shortlist.path },
    ],
    vocabularies: [],
  };

  if (files?.vocab) {
    plan.files.push({
      name: ARCHIVE.vocab,
      url: FILE_BASE_URL + files.vocab.path,
    });
    plan.vocabularies = [ARCHIVE.vocab];
  } else if (files?.srcVocab && files?.trgVocab) {
    plan.files.push(
      { name: ARCHIVE.srcVocab, url: FILE_BASE_URL + files.srcVocab.path },
      { name: ARCHIVE.trgVocab, url: FILE_BASE_URL + files.trgVocab.path },
    );
    plan.vocabularies = [ARCHIVE.srcVocab, ARCHIVE.trgVocab];
  } else {
    throw new Error(`No vocabulary available for "${language}"`);
  }

  return plan;
}

/**
 * Languages that can actually be installed: everything Mozilla publishes a
 * complete English→X model for.
 */
export async function listBergamotLanguages(): Promise<string[]> {
  const registry = await loadRegistry();
  const prefix = `${BERGAMOT_SOURCE_LANGUAGE}-`;
  return Object.keys(registry.models)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
    .filter((code) => {
      const files = pickEntry(registry.models[prefix + code])?.files;
      const hasVocab = Boolean(
        files?.vocab || (files?.srcVocab && files?.trgVocab),
      );
      return Boolean(files?.model && files.lexicalShortlist && hasVocab);
    })
    .sort();
}

/** Whether all archives for a language are stored locally. */
export async function getBergamotModelStatus(
  language: string,
): Promise<BergamotModelStatus> {
  if (hasDesktopRuntime()) {
    const desktop = await invokeDesktop<{ ready: boolean; bytes: number }>(
      "bergamot_model_status",
      { language },
    );
    return { language, ready: desktop.ready, bytes: desktop.bytes };
  }

  let bytes = 0;
  let plan: BergamotModelPlan;
  try {
    plan = await resolveBergamotModelPlan(language);
  } catch {
    // Registry unreachable and not cached: nothing can be loaded offline.
    return { language, ready: false, bytes };
  }
  for (const file of plan.files) {
    const hit = await cacheMatch(file.url);
    if (!hit) return { language, ready: false, bytes };
    bytes += hit.byteLength;
  }
  return { language, ready: true, bytes };
}

async function readArchive(
  language: string,
  name: string,
): Promise<ArrayBuffer> {
  if (hasDesktopRuntime()) {
    return await invokeDesktop<ArrayBuffer>("read_bergamot_model_file", {
      language,
      name,
    });
  }

  const plan = await resolveBergamotModelPlan(language);
  const file = plan.files.find((entry) => entry.name === name);
  const cached = file ? await cacheMatch(file.url) : null;
  if (!cached) {
    throw new Error(`Translation model for "${language}" is not downloaded`);
  }
  return cached;
}

/**
 * Downloads the archives for a language. `onProgress` receives a value
 * between 0 and 1.
 */
export async function downloadBergamotModel(
  language: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const plan = await resolveBergamotModelPlan(language);
  onProgress?.(0);

  if (hasDesktopRuntime()) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{
      language: string;
      received: number;
      total: number;
    }>("bergamot-model-progress", (event) => {
      if (event.payload.language !== language) return;
      if (event.payload.total <= 0) return;
      onProgress?.(Math.min(1, event.payload.received / event.payload.total));
    });
    try {
      await invokeDesktop<number>("download_bergamot_model", {
        language,
        plan: { files: plan.files, vocabularies: plan.vocabularies },
      });
    } finally {
      unlisten();
    }
    onProgress?.(1);
    return;
  }

  let done = 0;
  const total = plan.files.length;
  for (const file of plan.files) {
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`Download failed for ${file.name} (${response.status})`);
    }
    await cacheWrite(file.url, await response.arrayBuffer());
    done += 1;
    onProgress?.(done / total);
  }
}

/** Removes the stored archives for a language. */
export async function deleteBergamotModel(language: string): Promise<void> {
  if (hasDesktopRuntime()) {
    await invokeDesktop<boolean>("delete_bergamot_model", { language });
    return;
  }

  try {
    const plan = await resolveBergamotModelPlan(language);
    const cache = await caches.open(MODEL_CACHE);
    for (const file of plan.files) {
      await cache.delete(file.url);
    }
  } catch {
    // Nothing to clean up.
  }
}

async function gunzip(archive: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([archive])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

interface WorkerMessage {
  id: number;
  result?: unknown;
  error?: { name?: string; message?: string; stack?: string };
}

/**
 * Thin client for the engine worker (`translator-worker.js`). It keeps one
 * model loaded at a time and serialises translation requests.
 */
class BergamotEngine {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private ready: Promise<void> | null = null;
  private loadedLanguage: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  get loaded(): string | null {
    return this.loadedLanguage;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Resolve against the origin: the app uses paths like /library/<id>, so a
    // relative URL would point inside the current route.
    const url = new URL(
      `${import.meta.env.BASE_URL}${ENGINE_DIR}translator-worker.js`,
      window.location.origin,
    );
    const worker = new Worker(url);
    worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      const { id, result, error } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (error) {
        const failure = new Error(
          error.message || error.name || "Translation failed",
        );
        failure.stack = error.stack;
        entry.reject(failure);
      } else {
        entry.resolve(result);
      }
    });
    worker.addEventListener("error", (event) => {
      const failure = new Error(event.message || "Translation engine crashed");
      for (const entry of this.pending.values()) entry.reject(failure);
      this.pending.clear();
      this.ready = null;
      this.loadedLanguage = null;
      this.worker?.terminate();
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private call<T>(name: string, ...args: unknown[]): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, name, args });
    });
  }

  private initialize(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.call<void>("initialize").catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  /** Loads (and switches to) the model for `language`. */
  async useLanguage(language: string): Promise<void> {
    if (this.loadedLanguage === language) return;
    await this.initialize();

    if (this.loadedLanguage) {
      const previous = this.loadedLanguage;
      this.loadedLanguage = null;
      await this.call("freeTranslationModel", {
        from: BERGAMOT_SOURCE_LANGUAGE,
        to: previous,
      }).catch(() => undefined);
    }

    const plan = await resolveBergamotModelPlan(language);
    const buffers = new Map<string, ArrayBuffer>();
    for (const file of plan.files) {
      buffers.set(
        file.name,
        await gunzip(await readArchive(language, file.name)),
      );
    }

    const vocabularies = plan.vocabularies.map((name) => {
      const buffer = buffers.get(name);
      if (!buffer) throw new Error(`Vocabulary ${name} is missing`);
      return buffer;
    });

    await this.call(
      "loadTranslationModel",
      { from: BERGAMOT_SOURCE_LANGUAGE, to: language },
      {
        model: buffers.get(ARCHIVE.model),
        shortlist: buffers.get(ARCHIVE.shortlist),
        vocabs: vocabularies,
        config: {
          models: ["model.bin"],
          vocabs: plan.vocabularies.map((name) =>
            name.replace(/\.gz$/, ".bin"),
          ),
          shortlist: ["shortlist.bin"],
        },
      },
    );
    this.loadedLanguage = language;
  }

  /** Translates plain-text strings, preserving order. */
  translate(texts: string[], language: string): Promise<string[]> {
    const run = async () => {
      await this.useLanguage(language);
      const result = await this.call<{ target: { text: string } }[]>(
        "translate",
        {
          models: [{ from: BERGAMOT_SOURCE_LANGUAGE, to: language }],
          texts: texts.map((text) => ({ text, html: false })),
        },
      );
      return result.map((entry) => entry.target.text);
    };
    // Serialise: the worker only ever handles one model at a time.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

const engine = new BergamotEngine();

/**
 * Words the engine must leave alone. Machine translation happily turns a
 * product name into a translated noun when it stands on its own, so they are
 * swapped for neutral tokens before translating and put back afterwards.
 */
const PROTECTED_TERMS = ["GameVault+", "GameVault", "Phalcode", "Steam"];

const maskPattern = new RegExp(
  `(${PROTECTED_TERMS.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})`,
  "g",
);

function maskProtectedTerms(text: string): string {
  return text.replace(maskPattern, (match) => {
    const index = PROTECTED_TERMS.indexOf(match);
    return `QZV${index}Z`;
  });
}

function unmaskProtectedTerms(text: string): string {
  return text.replace(
    /QZV(\d+)Z/g,
    (match, index: string) => PROTECTED_TERMS[Number(index)] ?? match,
  );
}

/** Translates plain strings from English into `language`. */
export function translateStringsWithBergamot(
  texts: string[],
  language: string,
): Promise<string[]> {
  return engine
    .translate(texts.map(maskProtectedTerms), language)
    .then((translated) => translated.map(unmaskProtectedTerms));
}

/** Loads the model for `language` into the worker without translating. */
export async function ensureBergamotModelLoaded(
  language: string,
): Promise<void> {
  await engine.useLanguage(language);
}
