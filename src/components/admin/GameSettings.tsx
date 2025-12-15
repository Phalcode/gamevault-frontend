import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Input } from "@/components/tailwind/input";
import { Text } from "@/components/tailwind/text";
import { Listbox, ListboxOption, ListboxLabel } from "@/components/tailwind/listbox";
import { GamevaultGame } from "@/api/models/GamevaultGame";
import { UpdateGameDto } from "@/api/models/UpdateGameDto";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useState, useRef, useEffect, useCallback } from "react";
import { PhotoIcon, CircleStackIcon, PencilIcon, MagnifyingGlassIcon, SparklesIcon, ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import { PaintBrushIcon } from "@heroicons/react/16/solid";

interface Props {
  game: GamevaultGame;
  onClose: () => void;
  onGameUpdated?: (g: GamevaultGame) => void;
}

type TabKey = "images" | "metadata" | "custom-metadata";

interface ImageState {
  file: File | null;
  via: "none" | "file" | "url" | "paste" | "drag";
  preview: string | null;
  urlInput: string;
  original: string | null;
  loadedId?: number | null;
}

export function GameSettings({ game, onClose, onGameUpdated }: Props) {
  const { serverUrl, authFetch } = useAuth() as any;
  const { showAlert } = useAlertDialog();
  const [activeTab, setActiveTab] = useState<TabKey>("images");
  const [saving, setSaving] = useState(false);
  
  // Image state & logic
  const [coverImg, setCoverImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [bgImg, setBgImg] = useState<ImageState>({
    file: null,
    via: "none",
    preview: null,
    urlInput: "",
    original: null,
    loadedId: undefined,
  });
  const [savingImages, setSavingImages] = useState(false);
  const [imagesMsg, setImagesMsg] = useState<string | null>(null);
  const revokeRef = useRef<string[]>([]);

  // Custom metadata state
  const [customMetadata, setCustomMetadata] = useState({
    title: "",
    sort_title: "",
    description: "",
    notes: "",
    average_playtime: "",
    age_rating: "",
    release_date: "",
    rating: "",
    early_access: "",
  });
  const [savingCustomMetadata, setSavingCustomMetadata] = useState(false);

  useEffect(
    () => () => {
      revokeRef.current.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch {}
      });
    },
    [],
  );

  const coverMediaId = game.metadata?.cover?.id;
  const backgroundMediaId = game.metadata?.background?.id;

  const fetchMediaBlobUrl = useCallback(
    async (id: number): Promise<string | null> => {
      if (!serverUrl || !id) return null;
      try {
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/media/${id}`);
        if (!res.ok) throw new Error(`media ${id} ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        revokeRef.current.push(url);
        return url;
      } catch {
        return null;
      }
    },
    [serverUrl, authFetch],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (coverMediaId && coverImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(coverMediaId));
        if (!cancelled && url)
          setCoverImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(coverMediaId),
          }));
      }
      if (backgroundMediaId && bgImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(backgroundMediaId));
        if (!cancelled && url)
          setBgImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(backgroundMediaId),
          }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    coverMediaId,
    backgroundMediaId,
    fetchMediaBlobUrl,
    coverImg.original,
    bgImg.original,
  ]);

  const isProbablyImageUrl = (v: string) =>
    /^https?:\/\/.+\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(v.trim());
  const loadFile = (
    file: File,
    target: "cover" | "bg",
    via: ImageState["via"],
  ) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    revokeRef.current.push(url);
    const update = { file, via, preview: url };
    if (target === "cover") setCoverImg((prev) => ({ ...prev, ...update }));
    else setBgImg((prev) => ({ ...prev, ...update }));
  };
  const loadUrl = (url: string, target: "cover" | "bg") => {
    if (!url.trim()) return;
    const safe = url.trim();
    const update = { file: null, via: "url" as const, preview: safe };
    if (target === "cover")
      setCoverImg((prev) => ({ ...prev, ...update, urlInput: safe }));
    else setBgImg((prev) => ({ ...prev, ...update, urlInput: safe }));
  };
  const handlePaste = (e: React.ClipboardEvent, target: "cover" | "bg") => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            loadFile(f, target, "paste");
            e.preventDefault();
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text");
    if (text && isProbablyImageUrl(text)) {
      loadUrl(text, target);
      e.preventDefault();
    }
  };
  const handleDrop = (e: React.DragEvent, target: "cover" | "bg") => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f, target, "drag");
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesDirty =
    coverImg.preview !== coverImg.original ||
    bgImg.preview !== bgImg.original;
  const obtainFileForState = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File | null> => {
    if (state.file) return state.file;
    if (state.via === "url" && state.preview) {
      try {
        const r = await fetch(state.preview);
        if (!r.ok) throw new Error("url fetch failed");
        const b = await r.blob();
        const ext = (b.type && b.type.split("/")[1]) || "png";
        return new File([b], `${fallbackName}.${ext}`, {
          type: b.type || "image/png",
        });
      } catch {
        return null;
      }
    }
    return null;
  };
  const uploadImage = async (file: File): Promise<number> => {
    if (!serverUrl) throw new Error("No server URL");
    const base = serverUrl.replace(/\/+$/, "");
    const formData = new FormData();
    formData.append("file", file, file.name);
    const res = await authFetch(`${base}/api/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Upload failed (${res.status}): ${txt || res.statusText}`);
    }
    const media = await res.json();
    const mid = media?.id ?? media?.ID;
    if (!mid) throw new Error("Upload response missing id");
    return mid;
  };

  const saveImages = async () => {
    if (!imagesDirty || savingImages) return;
    setSavingImages(true);
    setImagesMsg(null);
    
    try {
      const newCover = coverImg.preview !== coverImg.original;
      const newBg = bgImg.preview !== bgImg.original;
      
      // Upload new images and get their IDs
      const coverId = newCover ? await uploadImage(await obtainFileForState(coverImg, "cover") as File) : undefined;
      const backgroundId = newBg ? await uploadImage(await obtainFileForState(bgImg, "background") as File) : undefined;
      
      // Update game with new media IDs
      if (coverId || backgroundId) {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");
        
        const updateGame: UpdateGameDto = {
          user_metadata: {},
        };
        
        if (coverId) updateGame.user_metadata!.cover = { id: coverId } as any;
        if (backgroundId) updateGame.user_metadata!.background = { id: backgroundId } as any;
        
        const res = await authFetch(`${base}/api/games/${game.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(updateGame),
        });
        
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Game update failed (${res.status}): ${txt || res.statusText}`);
        }
        
        const updatedGame = await res.json();
        onGameUpdated?.(updatedGame);
      }
      
      // Update local state to mark as saved
      setImagesMsg("Images saved successfully");
      if (newCover) {
        setCoverImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: coverId ?? s.loadedId,
        }));
      }
      if (newBg) {
        setBgImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: backgroundId ?? s.loadedId,
        }));
      }
    } catch (e: any) {
      setImagesMsg(e?.message || "Failed to save images");
    } finally {
      setSavingImages(false);
    }
  };

  const applyWatermark = (field: keyof typeof customMetadata) => {
    const metadata = game.metadata;
    let value: any = "";
    
    switch (field) {
      case "title":
        value = metadata?.title || game.title || "";
        break;
      case "sort_title":
        value = game.sort_title || "";
        break;
      case "description":
        value = metadata?.description || "";
        break;
      case "notes":
        value = metadata?.notes || "";
        break;
      case "average_playtime":
        value = metadata?.average_playtime?.toString() || "";
        break;
      case "age_rating":
        value = metadata?.age_rating?.toString() || "";
        break;
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          value = date.toISOString().split('T')[0];
        } else if (game.release_date) {
          const date = new Date(game.release_date);
          value = date.toISOString().split('T')[0];
        }
        break;
      case "rating":
        value = metadata?.rating?.toString() || "";
        break;
      case "early_access":
        value = metadata?.early_access !== undefined ? metadata.early_access.toString() : (game.early_access !== undefined ? game.early_access.toString() : "");
        break;
    }
    
    setCustomMetadata(prev => ({ ...prev, [field]: value }));
  };

  const getWatermark = (field: keyof typeof customMetadata): string => {
    const metadata = game.metadata;
    
    switch (field) {
      case "title":
        return metadata?.title || game.title || "";
      case "sort_title":
        return game.sort_title || "";
      case "description":
        return metadata?.description || "";
      case "notes":
        return metadata?.notes || "";
      case "average_playtime":
        return metadata?.average_playtime?.toString() || "";
      case "age_rating":
        return metadata?.age_rating?.toString() || "";
      case "release_date":
        if (metadata?.release_date) {
          const date = new Date(metadata.release_date);
          return date.toISOString().split('T')[0];
        } else if (game.release_date) {
          const date = new Date(game.release_date);
          return date.toISOString().split('T')[0];
        }
        return "";
      case "rating":
        return metadata?.rating?.toString() || "";
      case "early_access":
        return metadata?.early_access !== undefined ? (metadata.early_access ? "true" : "false") : (game.early_access !== undefined ? (game.early_access ? "true" : "false") : "");
      default:
        return "";
    }
  };

  const saveCustomMetadata = async () => {
    setSavingCustomMetadata(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error("Missing server URL");

      const updateDto: any = {};
      
      if (customMetadata.title) updateDto.title = customMetadata.title;
      if (customMetadata.sort_title) updateDto.sort_title = customMetadata.sort_title;
      if (customMetadata.description) updateDto.description = customMetadata.description;
      if (customMetadata.notes) updateDto.notes = customMetadata.notes;
      if (customMetadata.average_playtime) updateDto.average_playtime = Number(customMetadata.average_playtime);
      if (customMetadata.age_rating) updateDto.age_rating = Number(customMetadata.age_rating);
      if (customMetadata.release_date) updateDto.release_date = customMetadata.release_date;
      if (customMetadata.rating) updateDto.rating = Number(customMetadata.rating);
      if (customMetadata.early_access !== "") updateDto.early_access = customMetadata.early_access === "true";

      const payload: UpdateGameDto = {
        user_metadata: updateDto,
      };

      const res = await authFetch(`${base}/api/games/${game.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Failed to save custom metadata (${res.status}): ${txt || res.statusText}`);
      }

      const updatedGame = await res.json();
      onGameUpdated?.(updatedGame);

      await showAlert({
        title: "Success",
        description: "Custom metadata has been saved successfully.",
        affirmativeText: "OK",
      });
      
      // Reset form
      setCustomMetadata({
        title: "",
        sort_title: "",
        description: "",
        notes: "",
        average_playtime: "",
        age_rating: "",
        release_date: "",
        rating: "",
        early_access: "",
      });
    } catch (e: any) {
      await showAlert({
        title: "Error",
        description: e?.message || "Failed to save custom metadata",
        affirmativeText: "OK",
      });
    } finally {
      setSavingCustomMetadata(false);
    }
  };

  const handleWipeCustomMetadata = async () => {
    const result = await showAlert({
      title: "Are you sure you want to wipe all manually edited custom metadata and images?",
      description: "All fields will revert to the merged provider metadata (if available).\n\nThis action cannot be undone.",
      affirmativeText: "Yes",
      negativeText: "No",
    });

    if (result) {
      setSaving(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");

        const updateGame: UpdateGameDto = {
          mapping_requests: [
            {
              provider_slug: "user",
              provider_priority: 0,
            }
          ],
        };

        const res = await authFetch(`${base}/api/games/${game.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to wipe custom metadata (${res.status}): ${txt || res.statusText}`);
        }

        const updatedGame = await res.json();
        onGameUpdated?.(updatedGame);
        
        await showAlert({
          title: "Success",
          description: "Custom metadata has been wiped successfully.",
          affirmativeText: "OK",
        });
      } catch (e: any) {
        await showAlert({
          title: "Error",
          description: e?.message || "Failed to wipe custom metadata",
          affirmativeText: "OK",
        });
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <Dialog open onClose={onClose} size="4xl" className="">
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>Game Settings</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300/40 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          aria-label="Close"
          disabled={saving}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>
      
      {/* Vertical tab navigation layout */}
      <div className="flex gap-0 h-[600px]">
        {/* Left sidebar - vertical tabs */}
        <div className="w-52 border-r border-zinc-200 dark:border-zinc-700 py-4">
          <nav className="flex flex-col gap-1 px-3">
            <button
              onClick={() => setActiveTab("images")}
              className={
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left " +
                (activeTab === "images"
                  ? "bg-indigo-500 text-white"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800")
              }
            >
              <PhotoIcon className="w-5 h-5 flex-shrink-0" />
              <span>Edit Images</span>
            </button>
            <button
              onClick={() => setActiveTab("metadata")}
              className={
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left " +
                (activeTab === "metadata"
                  ? "bg-indigo-500 text-white"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800")
              }
            >
              <CircleStackIcon className="w-5 h-5 flex-shrink-0" />
              <span>Metadata</span>
            </button>
            <button
              onClick={() => setActiveTab("custom-metadata")}
              className={
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left " +
                (activeTab === "custom-metadata"
                  ? "bg-indigo-500 text-white"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800")
              }
            >
              <PencilIcon className="w-5 h-5 flex-shrink-0" />
              <span className="whitespace-nowrap">Custom Metadata</span>
            </button>
          </nav>
        </div>

        {/* Right content area */}
        <div className="flex-1 flex flex-col">
          <DialogBody className="flex-1 px-6 py-4 overflow-y-auto">
            {activeTab === "images" && (
              <div className="grid gap-8 md:grid-cols-2">
                {/* Cover zone */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <span>Cover</span>
                    {coverImg.via !== "none" && (
                      <span className="rounded-full bg-zinc-200/60 dark:bg-zinc-700/60 px-2 py-0.5 text-[10px] font-semibold">
                        {coverImg.via}
                      </span>
                    )}
                  </div>
                 
                  <div
                    onPaste={(e) => handlePaste(e, "cover")}
                    onDrop={(e) => handleDrop(e, "cover")}
                    onDragOver={handleDragOver}
                    className="relative rounded-xl border border-dashed border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50 h-56 flex items-center justify-center cursor-pointer overflow-hidden"
                    onClick={() => coverFileInputRef.current?.click()}
                  >
                    {coverImg.preview ? (
                      <img
                        src={coverImg.preview}
                        alt="Cover preview"
                        className="object-contain w-full h-full"
                        draggable={false}
                      />
                    ) : (
                      <div className="text-[11px] text-zinc-500 text-center px-4">
                        {coverMediaId ? "Loading…" : "Drag & Drop / Click / Paste"}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="Paste image URL"
                      value={coverImg.urlInput}
                      onChange={(e) =>
                        setCoverImg((p) => ({ ...p, urlInput: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && coverImg.urlInput.trim()) {
                          loadUrl(coverImg.urlInput, "cover");
                        }
                      }}
                    />
                    {coverImg.urlInput.trim() && (
                      <Button
                        color="indigo"
                        type="button"
                        onClick={() => loadUrl(coverImg.urlInput, "cover")}
                      >
                        Load
                      </Button>
                    )}
                    {coverImg.preview &&
                      coverImg.preview !== coverImg.original && (
                        <Button
                          color="rose"
                          type="button"
                          onClick={() =>
                            setCoverImg((p) => ({
                              ...p,
                              file: null,
                              via: "none",
                              preview: p.original,
                              urlInput: "",
                            }))
                          }
                        >
                          Reset
                        </Button>
                      )}
                  </div>
                  <input
                    ref={coverFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadFile(f, "cover", "file");
                      e.target.value = "";
                    }}
                  />
                   <Button
                    type="button"
                    color="zinc"
                    onClick={() => {
                      const gameTitle = game.metadata?.title || game.title || "";
                      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(gameTitle)} Game Box Art&tbm=isch`;
                      window.open(searchUrl, "_blank");
                    }}
                    className="w-full"
                  >
                    <MagnifyingGlassIcon className="w-4 h-4" />
                    Find Images
                  </Button>
                </div>
                {/* Background zone */}
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <span>Background</span>
                    {bgImg.via !== "none" && (
                      <span className="rounded-full bg-zinc-200/60 dark:bg-zinc-700/60 px-2 py-0.5 text-[10px] font-semibold">
                        {bgImg.via}
                      </span>
                    )}
                  </div>
                 
                  <div
                    onPaste={(e) => handlePaste(e, "bg")}
                    onDrop={(e) => handleDrop(e, "bg")}
                    onDragOver={handleDragOver}
                    className="relative rounded-xl border border-dashed border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800/50 h-56 flex items-center justify-center cursor-pointer overflow-hidden"
                    onClick={() => bgFileInputRef.current?.click()}
                  >
                    {bgImg.preview ? (
                      <img
                        src={bgImg.preview}
                        alt="Background preview"
                        className="object-cover w-full h-full"
                        draggable={false}
                      />
                    ) : (
                      <div className="text-[11px] text-zinc-500 text-center px-4">
                        {backgroundMediaId
                          ? "Loading…"
                          : "Drag & Drop / Click / Paste"}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="Paste image URL"
                      value={bgImg.urlInput}
                      onChange={(e) =>
                        setBgImg((p) => ({ ...p, urlInput: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && bgImg.urlInput.trim()) {
                          loadUrl(bgImg.urlInput, "bg");
                        }
                      }}
                    />
                    {bgImg.urlInput.trim() && (
                      <Button
                        color="indigo"
                        type="button"
                        onClick={() => loadUrl(bgImg.urlInput, "bg")}
                      >
                        Load
                      </Button>
                    )}
                    {bgImg.preview && bgImg.preview !== bgImg.original && (
                      <Button
                        color="rose"
                        type="button"
                        onClick={() =>
                          setBgImg((p) => ({
                            ...p,
                            file: null,
                            via: "none",
                            preview: p.original,
                            urlInput: "",
                          }))
                        }
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  <input
                    ref={bgFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) loadFile(f, "bg", "file");
                      e.target.value = "";
                    }}
                  />
                   <Button
                    type="button"
                    color="zinc"
                    onClick={() => {
                      const gameTitle = game.metadata?.title || game.title || "";
                      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(gameTitle)} Game Background Art&tbm=isch`;
                      window.open(searchUrl, "_blank");
                    }}
                    className="w-full"
                  >
                    <MagnifyingGlassIcon className="w-4 h-4" />
                    Find Images
                  </Button>
                </div>
                {/* Save button for images tab */}
                <div className="md:col-span-2 flex items-center gap-4 pt-2">
                  {imagesMsg && (
                    <Text
                      className={
                        "text-xs " +
                        (imagesMsg.includes("successfully")
                          ? "text-emerald-400"
                          : "text-rose-400")
                      }
                    >
                      {imagesMsg}
                    </Text>
                  )}
                  <div className="flex-1" />
                  <Button
                    color="indigo"
                    disabled={!imagesDirty || savingImages}
                    onClick={saveImages}
                  >
                    {savingImages ? "Saving Images…" : "Save Images"}
                  </Button>
                </div>
              </div>
            )}

            {activeTab === "metadata" && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4 text-zinc-800 dark:text-zinc-100">
                    Metadata
                  </h3>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    View and manage game metadata from external sources.
                  </p>
                </div>
                {/* TODO: Implement metadata management UI */}
              
                 <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                    Full metadata editing coming soon
                  </p>
              </div>
            )}

            {activeTab === "custom-metadata" && (
              <div className="flex flex-col h-full">
                {/* Header - fixed */}
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-4 text-zinc-800 dark:text-zinc-100">
                      Custom Metadata
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      Add custom fields and override metadata for this game.
                    </p>
                  </div>
                  <Button
                    color="rose"
                    onClick={handleWipeCustomMetadata}
                    disabled={saving}
                  >
                    <PaintBrushIcon className="w-4 h-4" />
                    Wipe CustomMetadata
                  </Button>
                </div>
                
                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600">
                  <div className="space-y-4">
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Title
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.title}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, title: e.target.value })}
                        placeholder={getWatermark("title")}
                        className="pr-10"
                      />
                      {getWatermark("title") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("title")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sort Title */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Sort Title
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.sort_title}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, sort_title: e.target.value })}
                        placeholder={getWatermark("sort_title")}
                        className="pr-10"
                      />
                      {getWatermark("sort_title") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("sort_title")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Description
                    </label>
                    <div className="relative">
                      <textarea
                        value={customMetadata.description}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, description: e.target.value })}
                        placeholder={getWatermark("description")}
                        rows={4}
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                      />
                      {getWatermark("description") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("description")}
                          className="absolute right-2 top-2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Notes
                    </label>
                    <div className="relative">
                      <textarea
                        value={customMetadata.notes}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, notes: e.target.value })}
                        placeholder={getWatermark("notes")}
                        rows={3}
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 pr-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                      />
                      {getWatermark("notes") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("notes")}
                          className="absolute right-2 top-2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Average Playtime */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Avg Playtime (minutes)
                      </label>
                      <div className="relative">
                        <Input
                          type="number"
                          value={customMetadata.average_playtime}
                          onChange={(e) => setCustomMetadata({ ...customMetadata, average_playtime: e.target.value })}
                          placeholder={getWatermark("average_playtime")}
                          className="pr-10"
                        />
                        {getWatermark("average_playtime") && (
                          <button
                            type="button"
                            onClick={() => applyWatermark("average_playtime")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="Apply current value"
                          >
                            <ArrowUturnLeftIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Age Rating */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Age Rating
                      </label>
                      <div className="relative">
                        <Input
                          type="number"
                          value={customMetadata.age_rating}
                          onChange={(e) => setCustomMetadata({ ...customMetadata, age_rating: e.target.value })}
                          placeholder={getWatermark("age_rating")}
                          className="pr-10"
                        />
                        {getWatermark("age_rating") && (
                          <button
                            type="button"
                            onClick={() => applyWatermark("age_rating")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="Apply current value"
                          >
                            <ArrowUturnLeftIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Release Date */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Release Date
                      </label>
                      <div className="relative">
                        <Input
                          type="date"
                          value={customMetadata.release_date}
                          onChange={(e) => setCustomMetadata({ ...customMetadata, release_date: e.target.value })}
                          placeholder={getWatermark("release_date")}
                          className="pr-10"
                        />
                        {getWatermark("release_date") && (
                          <button
                            type="button"
                            onClick={() => applyWatermark("release_date")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="Apply current value"
                          >
                            <ArrowUturnLeftIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Rating */}
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                        Rating
                      </label>
                      <div className="relative">
                        <Input
                          type="number"
                          step="0.1"
                          value={customMetadata.rating}
                          onChange={(e) => setCustomMetadata({ ...customMetadata, rating: e.target.value })}
                          placeholder={getWatermark("rating")}
                          className="pr-10"
                        />
                        {getWatermark("rating") && (
                          <button
                            type="button"
                            onClick={() => applyWatermark("rating")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            title="Apply current value"
                          >
                            <ArrowUturnLeftIcon className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Early Access */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Early Access
                    </label>
                    <Listbox
                      value={customMetadata.early_access || null}
                      onChange={(value) => setCustomMetadata({ ...customMetadata, early_access: value as string })}
                      placeholder={getWatermark("early_access") ? `Current: ${getWatermark("early_access")}` : "Select..."}
                    >
                      <ListboxOption value="true">
                        <ListboxLabel>True</ListboxLabel>
                      </ListboxOption>
                      <ListboxOption value="false">
                        <ListboxLabel>False</ListboxLabel>
                      </ListboxOption>
                    </Listbox>
                  </div>

                  </div>
                </div>
                
                {/* Fixed save button at bottom */}
                <div className="flex justify-end pt-4 mt-4">
                  <Button
                    color="indigo"
                    onClick={saveCustomMetadata}
                    disabled={savingCustomMetadata}
                  >
                    {savingCustomMetadata ? "Saving..." : "Save Custom Metadata"}
                  </Button>
                </div>
              </div>
            )}
          </DialogBody>
        </div>
      </div>
      
      {/* Bottom left info */}
      <div className="absolute bottom-4 left-4 text-xs text-zinc-500 dark:text-zinc-400 space-y-0.5">
        <div>{game.metadata?.title || game.title || "Unknown"}</div>
        <div>ID: {game.id}</div>
        <div>Version: {game.version || "N/A"}</div>
      </div>
    </Dialog>
  );
}
