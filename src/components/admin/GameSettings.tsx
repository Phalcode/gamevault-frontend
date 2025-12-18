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
import { MetadataProviderDto } from "@/api/models/MetadataProviderDto";
import { GameMetadata } from "@/api/models/GameMetadata";
import { MapGameDto } from "@/api/models/MapGameDto";
import { useAuth } from "@/context/AuthContext";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { PhotoIcon, CircleStackIcon, PencilIcon, MagnifyingGlassIcon, SparklesIcon, ArrowUturnLeftIcon, ArrowPathIcon, LinkSlashIcon } from "@heroicons/react/24/outline";
import { PaintBrushIcon } from "@heroicons/react/16/solid";

interface Props {
  game: GamevaultGame;
  onClose: () => void;
  onGameUpdated?: (g: GamevaultGame) => void;
}

// No cool object binding in react, so we manually pick fields for custom metadata. But at least this is type save
type CustomMetadataForm = {
  [K in keyof Pick<GameMetadata, 
    'title' | 
    'description' | 
    'notes' | 
    'average_playtime' | 
    'age_rating' | 
    'release_date' | 
    'rating' | 
    'early_access' |
    'launch_executable' |
    'launch_parameters' |
    'installer_executable' |
    'installer_parameters' |
    'uninstaller_executable' |
    'uninstaller_parameters' |
    'url_websites' |
    'url_trailers' |
    'url_gameplays' |
    'url_screenshots'
  >]: string;
} & {
  sort_title: string;
  genres: string;
  tags: string;
  publishers: string;
  developers: string;
};

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
  const [fullGame, setFullGame] = useState<GamevaultGame | null>(null);
  const [loadingFullGame, setLoadingFullGame] = useState(true);
  
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

  // Custom metadata state - initialize empty object with all editable GameMetadata fields
  const getEmptyCustomMetadata = (): CustomMetadataForm => ({
    title: "",
    sort_title: "",
    description: "",
    notes: "",
    average_playtime: "",
    age_rating: "",
    release_date: "",
    rating: "",
    early_access: "",
    launch_executable: "",
    launch_parameters: "",
    installer_executable: "",
    installer_parameters: "",
    uninstaller_executable: "",
    uninstaller_parameters: "",
    url_websites: "",
    genres: "",
    tags: "",
    publishers: "",
    developers: "",
    url_trailers: "",
    url_gameplays: "",
    url_screenshots: "",
  });

  const [customMetadata, setCustomMetadata] = useState<CustomMetadataForm>(getEmptyCustomMetadata());
  const [savingCustomMetadata, setSavingCustomMetadata] = useState(false);

  // Metadata providers state
  const [metadataProviders, setMetadataProviders] = useState<MetadataProviderDto[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedMetadataProviderIndex, setSelectedMetadataProviderIndex] = useState<number>(0);
  const [remapSearchResults, setRemapSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [customPriority, setCustomPriority] = useState<string>("");
  const [remapping, setRemapping] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const [gameCoverUrl, setGameCoverUrl] = useState<string | null>(null);
  const [mappedGameCoverUrl, setMappedGameCoverUrl] = useState<string | null>(null);

  // Fetch full game object on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFullGame(true);
        const base = serverUrl.replace(/\/+$/, "");
        const res = await authFetch(`${base}/api/games/${game.id}`, {
          method: "GET",
        });
        if (!res.ok) throw new Error(`Failed to load game (${res.status})`);
        const json = await res.json();
        if (!cancelled) setFullGame(json);
      } catch (e: any) {
        console.error("Failed to fetch full game:", e);
        if (!cancelled) setFullGame(game); // fallback to slim version
      } finally {
        if (!cancelled) setLoadingFullGame(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, authFetch, game]);

  // Use fullGame if available, otherwise fallback to game prop
  const workingGame = fullGame || game;

  // Computed: Current shown mapped game
  const currentShownMappedGame = useMemo<GameMetadata | null>(() => {
    if (!workingGame.provider_metadata || metadataProviders.length === 0) return null;
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return null;
    
    return workingGame.provider_metadata.find(
      (meta) => meta.provider_slug === selectedProvider.slug
    ) || null;
  }, [workingGame.provider_metadata, metadataProviders, selectedMetadataProviderIndex]);

  // Initialize providers on metadata tab open
  useEffect(() => {
    if (activeTab === "metadata" && metadataProviders.length === 0 && !loadingProviders) {
      const initializeProviders = async () => {
        setLoadingProviders(true);
        try {
          const base = serverUrl?.replace(/\/+$/, "");
          if (!base) throw new Error("Missing server URL");
          
          const res = await authFetch(`${base}/api/metadata/providers`);
          if (!res.ok) {
            throw new Error(`Failed to fetch providers (${res.status})`);
          }
          
          let providers: MetadataProviderDto[] = await res.json();
          console.log('📦 Providers from API:', providers.map(p => ({ slug: p.slug, name: p.name, priority: p.priority })));
          
          // Override priorities from game's provider_metadata
          if (workingGame.provider_metadata) {
            console.log('🎮 Game provider_metadata:', workingGame.provider_metadata.map(m => ({ slug: m.provider_slug, priority: m.provider_priority })));
            providers = providers.map(provider => {
              const gameProviderMeta = workingGame.provider_metadata?.find(
                meta => meta.provider_slug === provider.slug
              );
              if (gameProviderMeta?.provider_priority != null) {
                console.log(`✅ Overriding ${provider.slug}: ${provider.priority} -> ${gameProviderMeta.provider_priority}`);
                return { ...provider, priority: gameProviderMeta.provider_priority };
              }
              return provider;
            });
          }
          
          // Sort by priority descending
          providers.sort((a, b) => b.priority - a.priority);
          console.log('🔄 Providers after sort:', providers.map(p => ({ slug: p.slug, name: p.name, priority: p.priority })));
          
          setMetadataProviders(providers);
          setSelectedMetadataProviderIndex(0);
          
        } catch (e: any) {
          console.error("Failed to fetch metadata providers:", e);
          await showAlert({
            title: "Error",
            description: e?.message || "Failed to load metadata providers",
            affirmativeText: "OK",
          });
        } finally {
          setLoadingProviders(false);
        }
      };
      
      initializeProviders();
    }
  }, [activeTab, metadataProviders.length, loadingProviders, serverUrl, authFetch, workingGame.provider_metadata, showAlert]);

  // Clear search results when provider selection changes
  useEffect(() => {
    setRemapSearchResults([]);
    setSearchQuery("");
    setMappedGameCoverUrl(null);
    
    // Set the current priority as the input value
    if (currentShownMappedGame?.provider_priority != null) {
      setCustomPriority(currentShownMappedGame.provider_priority.toString());
    } else {
      setCustomPriority("");
    }
  }, [selectedMetadataProviderIndex, currentShownMappedGame]);

  // Debounced search function
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim() || metadataProviders.length === 0) {
      setRemapSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
      if (!selectedProvider) return;

      setSearching(true);
      try {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");
        
        const res = await authFetch(
          `${base}/api/metadata/providers/${selectedProvider.slug}/search?query=${encodeURIComponent(searchQuery)}`
        );
        
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        
        const results = await res.json();
        setRemapSearchResults(Array.isArray(results) ? results : []);
      } catch (e: any) {
        console.error("Search failed:", e);
        setRemapSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, metadataProviders, selectedMetadataProviderIndex, serverUrl, authFetch]);

  // Core remap function
  const remapGame = async (
    providerDataId: string | null,
    priority?: number
  ) => {
    const selectedProvider = metadataProviders[selectedMetadataProviderIndex];
    if (!selectedProvider) return;

    setRemapping(true);
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) throw new Error("Missing server URL");

      const mappingRequest: MapGameDto = {
        provider_slug: selectedProvider.slug,
        provider_data_id: providerDataId || undefined,
        provider_priority: priority !== undefined ? priority : selectedProvider.priority,
      };

      const updateDto: UpdateGameDto = {
        mapping_requests: [mappingRequest],
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(updateDto),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Remap failed (${res.status}): ${txt || res.statusText}`);
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);

      // Refresh providers to get updated priorities
      setMetadataProviders([]);
      
      await showAlert({
        title: "Success",
        description: providerDataId 
          ? "Game remapped successfully" 
          : "Game unmapped successfully",
        affirmativeText: "OK",
      });
    } catch (e: any) {
      await showAlert({
        title: "Error",
        description: e?.message || "Failed to remap game",
        affirmativeText: "OK",
      });
    } finally {
      setRemapping(false);
    }
  };

  const handleSavePriority = async () => {
    const priority = parseInt(customPriority, 10);
    if (isNaN(priority)) {
      await showAlert({
        title: "Invalid Priority",
        description: "Please enter a valid number for priority",
        affirmativeText: "OK",
      });
      return;
    }

    if (!currentShownMappedGame?.provider_data_id) {
      await showAlert({
        title: "No Mapping",
        description: "This game is not mapped to the selected provider",
        affirmativeText: "OK",
      });
      return;
    }

    await remapGame(currentShownMappedGame.provider_data_id, priority);
    setCustomPriority("");
  };

  const handleUnmap = async () => {
    const result = await showAlert({
      title: "Unmap Provider",
      description: "Are you sure you want to unmap this game from the selected provider?",
      affirmativeText: "Yes",
      negativeText: "Cancel",
    });

    if (result) {
      await remapGame(null);
    }
  };

  const handleRecache = async () => {
    if (!currentShownMappedGame?.provider_data_id) return;
    await remapGame(currentShownMappedGame.provider_data_id);
  };

  const handleRemapToResult = async (providerDataId: string) => {
    await remapGame(providerDataId);
    setRemapSearchResults([]);
    setSearchQuery("");
  };

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

  const coverMediaId = workingGame.metadata?.cover?.id;
  const backgroundMediaId = workingGame.metadata?.background?.id;

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

  // Load game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadGameCover = async () => {
      if (workingGame.metadata?.cover?.id) {
        const url = await fetchMediaBlobUrl(Number(workingGame.metadata.cover.id));
        if (!cancelled && url) {
          setGameCoverUrl(url);
        }
      }
    };
    loadGameCover();
    return () => { cancelled = true; };
  }, [workingGame.metadata?.cover?.id, fetchMediaBlobUrl]);

  // Load mapped game cover image for metadata tab
  useEffect(() => {
    let cancelled = false;
    const loadMappedCover = async () => {
      if (currentShownMappedGame?.cover?.id) {
        const url = await fetchMediaBlobUrl(Number(currentShownMappedGame.cover.id));
        if (!cancelled && url) {
          setMappedGameCoverUrl(url);
        }
      } else {
        setMappedGameCoverUrl(null);
      }
    };
    loadMappedCover();
    return () => { cancelled = true; };
  }, [currentShownMappedGame?.cover?.id, fetchMediaBlobUrl]);

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
        
        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(updateGame),
        });
        
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Game update failed (${res.status}): ${txt || res.statusText}`);
        }
        
        const updatedGame = await res.json();
        setFullGame(updatedGame);
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

  const applyWatermark = (field: keyof CustomMetadataForm) => {
    const metadata = workingGame.metadata;
    let value: any = "";
    
    switch (field) {
      case "title":
        value = metadata?.title || workingGame.title || "";
        break;
      case "sort_title":
        value = workingGame.sort_title || "";
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
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          value = date.toISOString().split('T')[0];
        }
        break;
      case "rating":
        value = metadata?.rating?.toString() || "";
        break;
      case "early_access":
        value = metadata?.early_access !== undefined ? metadata.early_access.toString() : (workingGame.early_access !== undefined ? workingGame.early_access.toString() : "");
        break;
      case "launch_executable":
        value = metadata?.launch_executable || "";
        break;
      case "launch_parameters":
        value = metadata?.launch_parameters || "";
        break;
      case "installer_executable":
        value = metadata?.installer_executable || "";
        break;
      case "installer_parameters":
        value = metadata?.installer_parameters || "";
        break;
      case "uninstaller_executable":
        value = metadata?.uninstaller_executable || "";
        break;
      case "uninstaller_parameters":
        value = metadata?.uninstaller_parameters || "";
        break;
      case "url_websites":
        value = Array.isArray(metadata?.url_websites) ? metadata.url_websites.join(", ") : "";
        break;
      case "genres":
        value = Array.isArray(metadata?.genres) ? metadata.genres.map((g: any) => g.name || g).join(", ") : "";
        break;
      case "tags":
        value = Array.isArray(metadata?.tags) ? metadata.tags.map((t: any) => t.name || t).join(", ") : "";
        break;
      case "publishers":
        value = Array.isArray(metadata?.publishers) ? metadata.publishers.map((p: any) => p.name || p).join(", ") : "";
        break;
      case "developers":
        value = Array.isArray(metadata?.developers) ? metadata.developers.map((d: any) => d.name || d).join(", ") : "";
        break;
      case "url_trailers":
        value = Array.isArray(metadata?.url_trailers) ? metadata.url_trailers.join(", ") : "";
        break;
      case "url_gameplays":
        value = Array.isArray(metadata?.url_gameplays) ? metadata.url_gameplays.join(", ") : "";
        break;
      case "url_screenshots":
        value = Array.isArray(metadata?.url_screenshots) ? metadata.url_screenshots.join(", ") : "";
        break;
    }
    
    setCustomMetadata(prev => ({ ...prev, [field]: value }));
  };

  const getWatermark = (field: keyof CustomMetadataForm): string => {
    const metadata = workingGame.metadata;
    
    switch (field) {
      case "title":
        return metadata?.title || workingGame.title || "";
      case "sort_title":
        return workingGame.sort_title || "";
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
        } else if (workingGame.release_date) {
          const date = new Date(workingGame.release_date);
          return date.toISOString().split('T')[0];
        }
        return "";
      case "rating":
        return metadata?.rating?.toString() || "";
      case "early_access":
        return metadata?.early_access !== undefined ? (metadata.early_access ? "true" : "false") : (workingGame.early_access !== undefined ? (workingGame.early_access ? "true" : "false") : "");
      case "launch_executable":
        return metadata?.launch_executable || "";
      case "launch_parameters":
        return metadata?.launch_parameters || "";
      case "installer_executable":
        return metadata?.installer_executable || "";
      case "installer_parameters":
        return metadata?.installer_parameters || "";
      case "uninstaller_executable":
        return metadata?.uninstaller_executable || "";
      case "uninstaller_parameters":
        return metadata?.uninstaller_parameters || "";
      case "url_websites":
        return Array.isArray(metadata?.url_websites) ? metadata.url_websites.join(", ") : "";
      case "genres":
        return Array.isArray(metadata?.genres) ? metadata.genres.map((g: any) => g.name || g).join(", ") : "";
      case "tags":
        return Array.isArray(metadata?.tags) ? metadata.tags.map((t: any) => t.name || t).join(", ") : "";
      case "publishers":
        return Array.isArray(metadata?.publishers) ? metadata.publishers.map((p: any) => p.name || p).join(", ") : "";
      case "developers":
        return Array.isArray(metadata?.developers) ? metadata.developers.map((d: any) => d.name || d).join(", ") : "";
      case "url_trailers":
        return Array.isArray(metadata?.url_trailers) ? metadata.url_trailers.join(", ") : "";
      case "url_gameplays":
        return Array.isArray(metadata?.url_gameplays) ? metadata.url_gameplays.join(", ") : "";
      case "url_screenshots":
        return Array.isArray(metadata?.url_screenshots) ? metadata.url_screenshots.join(", ") : "";
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
      
      if (customMetadata.launch_executable) updateDto.launch_executable = customMetadata.launch_executable;
      if (customMetadata.launch_parameters) updateDto.launch_parameters = customMetadata.launch_parameters;
      if (customMetadata.installer_executable) updateDto.installer_executable = customMetadata.installer_executable;
      if (customMetadata.installer_parameters) updateDto.installer_parameters = customMetadata.installer_parameters;
      if (customMetadata.uninstaller_executable) updateDto.uninstaller_executable = customMetadata.uninstaller_executable;
      if (customMetadata.uninstaller_parameters) updateDto.uninstaller_parameters = customMetadata.uninstaller_parameters;
      
      if (customMetadata.url_websites) updateDto.url_websites = customMetadata.url_websites.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.genres) updateDto.genres = customMetadata.genres.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.tags) updateDto.tags = customMetadata.tags.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.publishers) updateDto.publishers = customMetadata.publishers.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.developers) updateDto.developers = customMetadata.developers.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.url_trailers) updateDto.url_trailers = customMetadata.url_trailers.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.url_gameplays) updateDto.url_gameplays = customMetadata.url_gameplays.split(',').map(s => s.trim()).filter(Boolean);
      if (customMetadata.url_screenshots) updateDto.url_screenshots = customMetadata.url_screenshots.split(',').map(s => s.trim()).filter(Boolean);

      const payload: UpdateGameDto = {
        user_metadata: updateDto,
      };

      const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Failed to save custom metadata (${res.status}): ${txt || res.statusText}`);
      }

      const updatedGame = await res.json();
      setFullGame(updatedGame);
      onGameUpdated?.(updatedGame);

      await showAlert({
        title: "Success",
        description: "Custom metadata has been saved successfully.",
        affirmativeText: "OK",
      });
      
      // Reset form
      setCustomMetadata(getEmptyCustomMetadata());
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

        const res = await authFetch(`${base}/api/games/${workingGame.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(updateGame),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Failed to wipe custom metadata (${res.status}): ${txt || res.statusText}`);
        }

        const updatedGame = await res.json();
        setFullGame(updatedGame);
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
    <Dialog open onClose={onClose} size="7xl" className="!max-w-[min(95vw,1200px)] sm:!max-w-[min(65vw,1200px)] !max-h-[min(90vh,900px)] !w-full flex flex-col">
      <DialogTitle className="flex items-center justify-between gap-2 sm:gap-4 pb-1 flex-shrink-0">
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
      
      {loadingFullGame ? (
        <div className="flex items-center justify-center p-8">
          <div className="text-sm text-fg-muted">Loading game data...</div>
        </div>
      ) : (
      <>
      {/* Vertical tab navigation layout */}
      <div className="flex flex-col sm:flex-row gap-0 flex-1 min-h-0">
        {/* Left sidebar - vertical tabs */}
        <div className="w-full sm:w-52 border-b sm:border-b-0 sm:border-r border-zinc-200 dark:border-zinc-700 py-2 sm:py-4">
          <nav className="flex flex-row sm:flex-col gap-1 px-2 sm:px-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <button
              onClick={() => setActiveTab("images")}
              className={
                "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
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
                "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
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
                "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-3 rounded-lg text-xs sm:text-sm font-medium transition-colors text-left whitespace-nowrap " +
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
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <DialogBody className="flex-1 px-6 py-4 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600">
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
                      const gameTitle = workingGame.metadata?.title || workingGame.title || "";
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
                      const gameTitle = workingGame.metadata?.title || workingGame.title || "";
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
              <div className="h-full flex flex-col overflow-hidden">
                {loadingProviders ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">Loading providers...</div>
                  </div>
                ) : metadataProviders.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-sm text-zinc-500 dark:text-zinc-400">No metadata providers available</div>
                  </div>
                ) : (
                  <div className="flex flex-col h-full overflow-hidden">
                    {/* Provider Selector */}
                    <div className="flex-shrink-0 flex gap-2 flex-wrap mb-4 pb-4 border-b border-zinc-200 dark:border-zinc-700">
                      {metadataProviders.map((provider, index) => {
                        const isMapped = workingGame.provider_metadata?.some(
                          meta => meta.provider_slug === provider.slug
                        );
                        return (
                          <button
                            key={provider.slug}
                            onClick={() => setSelectedMetadataProviderIndex(index)}
                            disabled={remapping}
                            className={
                              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all " +
                              (selectedMetadataProviderIndex === index
                                ? "bg-indigo-500 text-white shadow-sm"
                                : isMapped
                                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                  : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 opacity-60 hover:opacity-100")
                            }
                          >
                            {provider.name} ({provider.priority})
                          </button>
                        );
                      })}
                    </div>

                    {/* Content Area with fixed sections */}
                    <div className="flex-1 flex flex-col gap-4 min-h-0 overflow-y-auto overflow-x-hidden pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600 max-w-full">
                      {/* Three Column Layout - Fixed height section */}
                      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px] gap-6 xl:gap-[30px] flex-shrink-0 w-full max-w-full">
                        {/* Left Column: GameVault Data */}
                        <div className="flex flex-col overflow-x-hidden space-y-4 pb-4 xl:pb-0 border-b xl:border-b-0 border-zinc-200 dark:border-zinc-700 min-w-0">
                        <h4 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                          GameVault
                        </h4>
                        
                        <div className="flex gap-4">
                          {/* Cover Image */}
                          {gameCoverUrl && (
                            <div className="flex-shrink-0 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                              <img
                                src={gameCoverUrl}
                                alt="Cover"
                                className="w-32 h-44 object-cover"
                                style={{ aspectRatio: '2/3' }}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </div>
                          )}

                          <div className="flex-1 space-y-2 text-sm">
                          <div>
                            <div className="text-zinc-500 dark:text-zinc-400 mb-1">File Path:</div>
                            <div className="text-zinc-900 dark:text-zinc-100 font-mono text-xs overflow-hidden whitespace-nowrap text-ellipsis">
                              {workingGame.file_path || "N/A"}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500 dark:text-zinc-400 mb-1">Release Date:</div>
                            <div className="text-zinc-900 dark:text-zinc-100 overflow-hidden whitespace-nowrap text-ellipsis">
                              {workingGame.release_date 
                                ? new Date(workingGame.release_date).toLocaleDateString() 
                                : "N/A"}
                            </div>
                          </div>
                          <div>
                            <div className="text-zinc-500 dark:text-zinc-400 mb-1">Added:</div>
                            <div className="text-zinc-900 dark:text-zinc-100 overflow-hidden whitespace-nowrap text-ellipsis">
                              {new Date(workingGame.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          </div>
                        </div>
                      </div>

                      {/* Middle Column: Mapped Game Data */}
                      <div className="flex flex-col overflow-x-hidden space-y-4 pb-4 xl:pb-0 border-b xl:border-b-0 border-zinc-200 dark:border-zinc-700 min-w-0">
                        <h4 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                          Mapped Game
                        </h4>

                        {currentShownMappedGame ? (
                          <>
                            <div className="flex gap-4">
                              {/* Cover Image */}
                              {mappedGameCoverUrl && (
                                <div className="flex-shrink-0 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                                  <img
                                    src={mappedGameCoverUrl}
                                    alt="Provider Cover"
                                    className="w-32 h-44 object-cover"
                                    style={{ aspectRatio: '2/3' }}
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              )}

                              <div className="flex-1 space-y-2 text-sm">
                              <div>
                                <div className="text-zinc-500 dark:text-zinc-400 mb-1">Title:</div>
                                <div className="text-zinc-900 dark:text-zinc-100 overflow-hidden whitespace-nowrap text-ellipsis">
                                  {currentShownMappedGame.title || "N/A"}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500 dark:text-zinc-400 mb-1">Release Date:</div>
                                <div className="text-zinc-900 dark:text-zinc-100 overflow-hidden whitespace-nowrap text-ellipsis">
                                  {currentShownMappedGame.release_date 
                                    ? new Date(currentShownMappedGame.release_date).toLocaleDateString() 
                                    : "N/A"}
                                </div>
                              </div>
                              <div>
                                <div className="text-zinc-500 dark:text-zinc-400 mb-1">Last Cached:</div>
                                <div className="text-zinc-900 dark:text-zinc-100 overflow-hidden whitespace-nowrap text-ellipsis">
                                  {currentShownMappedGame.updated_at 
                                    ? new Date(currentShownMappedGame.updated_at).toLocaleDateString() 
                                    : "N/A"}
                                </div>
                              </div>
                              {currentShownMappedGame.provider_data_url && (
                                <div>
                                  <a
                                    href={currentShownMappedGame.provider_data_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-600 dark:text-indigo-400 hover:underline text-xs"
                                  >
                                    View on {metadataProviders[selectedMetadataProviderIndex]?.name}
                                  </a>
                                </div>
                              )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-center h-32 text-sm text-zinc-500 dark:text-zinc-400">
                            Not mapped to this provider
                          </div>
                        )}
                      </div>

                      {/* Actions Column */}
                      <div className="flex flex-col space-y-4 w-full max-w-full xl:max-w-none">
                        <h4 className="text-base font-semibold text-zinc-800 dark:text-zinc-100">
                          Actions
                        </h4>
                        
                        {currentShownMappedGame ? (
                          <div className="space-y-3 w-full max-w-full">
                            <div className="w-full max-w-full">
                              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                Priority
                              </label>
                              <div className="flex gap-2 w-full max-w-full">
                                <Input
                                  type="number"
                                  placeholder={`${currentShownMappedGame?.provider_priority ?? metadataProviders[selectedMetadataProviderIndex]?.priority ?? ''}`}
                                  value={customPriority}
                                  onChange={(e) => setCustomPriority(e.target.value)}
                                  disabled={remapping}
                                  className="flex-1"
                                />
                                <Button
                                  color="indigo"
                                  onClick={handleSavePriority}
                                  disabled={!customPriority || remapping}
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                            
                            <Button
                              color="amber"
                              onClick={handleRecache}
                              disabled={remapping}
                              className="w-full"
                            >
                              <ArrowPathIcon className="w-4 h-4" />
                              Recache
                            </Button>
                            <Button
                              color="rose"
                              onClick={handleUnmap}
                              disabled={remapping}
                              className="w-full"
                            >
                              <LinkSlashIcon className="w-4 h-4" />
                              Unmap
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center flex-1 text-sm text-zinc-500 dark:text-zinc-400 text-center">
                            No actions available
                          </div>
                        )}
                      </div>
                    </div>

                      {/* Search & Remap Section - Full Width with own scrollbar */}
                      <div className="flex-1 min-h-[300px] flex flex-col space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700 min-w-0 max-w-full">
                        <div className="flex-shrink-0">
                        <h4 className="text-base font-semibold mb-3 text-zinc-800 dark:text-zinc-100">
                          Search & Remap
                        </h4>
                        <Input
                          type="text"
                          placeholder={`Search ${metadataProviders[selectedMetadataProviderIndex]?.name}...`}
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          disabled={remapping}
                        />
                      </div>

                      {searching && (
                        <div className="text-center py-4 text-sm text-zinc-500 dark:text-zinc-400">
                          Searching...
                        </div>
                      )}

                      {!searching && remapSearchResults.length > 0 && (
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600 min-w-0">
                          {remapSearchResults.map((result, idx) => (
                            <div
                              key={idx}
                              className="relative flex gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 min-w-0 max-w-full overflow-hidden"
                            >
                              {result.provider_data_id && (
                                <div className="absolute top-2 right-2 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded z-10">
                                  ID: {result.provider_data_id}
                                </div>
                              )}
                              {result.cover_url && (
                                <img
                                  src={result.cover_url}
                                  alt={result.title}
                                  className="w-16 h-20 object-cover rounded flex-shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="flex-1 min-w-0 pr-20">
                                <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                                  {result.title || "Untitled"}
                                </div>
                                {result.release_date && (
                                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {new Date(result.release_date).getFullYear()}
                                  </div>
                                )}
                                {result.description && (
                                  <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 line-clamp-2">
                                    {result.description}
                                  </div>
                                )}
                              </div>
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 mt-5 z-10">
                                <Button
                                  color="indigo"
                                  onClick={() => handleRemapToResult(result.provider_data_id)}
                                  disabled={remapping || !result.provider_data_id}
                                >
                                  Remap
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                      </div>
                    </div>
                )}
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
                      Add custom fields and override metadata for this workingGame.
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
                      {getWatermark("release_date") && !customMetadata.release_date && (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Current: {new Date(getWatermark("release_date")).toLocaleDateString()}
                        </p>
                      )}
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

                  {/* Launch Executable */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Launch Executable
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.launch_executable}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, launch_executable: e.target.value })}
                        placeholder={getWatermark("launch_executable")}
                        className="pr-10"
                      />
                      {getWatermark("launch_executable") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("launch_executable")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Launch Parameters */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Launch Parameters
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.launch_parameters}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, launch_parameters: e.target.value })}
                        placeholder={getWatermark("launch_parameters")}
                        className="pr-10"
                      />
                      {getWatermark("launch_parameters") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("launch_parameters")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Installer Executable */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Installer Executable
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.installer_executable}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, installer_executable: e.target.value })}
                        placeholder={getWatermark("installer_executable")}
                        className="pr-10"
                      />
                      {getWatermark("installer_executable") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("installer_executable")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Installer Parameters */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Installer Parameters
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.installer_parameters}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, installer_parameters: e.target.value })}
                        placeholder={getWatermark("installer_parameters")}
                        className="pr-10"
                      />
                      {getWatermark("installer_parameters") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("installer_parameters")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Uninstaller Executable */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Uninstaller Executable
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.uninstaller_executable}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, uninstaller_executable: e.target.value })}
                        placeholder={getWatermark("uninstaller_executable")}
                        className="pr-10"
                      />
                      {getWatermark("uninstaller_executable") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("uninstaller_executable")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Uninstaller Parameters */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Default Uninstaller Parameters
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.uninstaller_parameters}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, uninstaller_parameters: e.target.value })}
                        placeholder={getWatermark("uninstaller_parameters")}
                        className="pr-10"
                      />
                      {getWatermark("uninstaller_parameters") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("uninstaller_parameters")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Website URLs */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Website URLs <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.url_websites}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, url_websites: e.target.value })}
                        placeholder={getWatermark("url_websites")}
                        className="pr-10"
                      />
                      {getWatermark("url_websites") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("url_websites")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Genres */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Genres <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.genres}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, genres: e.target.value })}
                        placeholder={getWatermark("genres")}
                        className="pr-10"
                      />
                      {getWatermark("genres") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("genres")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Tags <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.tags}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, tags: e.target.value })}
                        placeholder={getWatermark("tags")}
                        className="pr-10"
                      />
                      {getWatermark("tags") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("tags")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Publishers */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Publishers <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.publishers}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, publishers: e.target.value })}
                        placeholder={getWatermark("publishers")}
                        className="pr-10"
                      />
                      {getWatermark("publishers") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("publishers")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Developers */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Developers <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.developers}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, developers: e.target.value })}
                        placeholder={getWatermark("developers")}
                        className="pr-10"
                      />
                      {getWatermark("developers") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("developers")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Trailer URLs */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Trailer URLs <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.url_trailers}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, url_trailers: e.target.value })}
                        placeholder={getWatermark("url_trailers")}
                        className="pr-10"
                      />
                      {getWatermark("url_trailers") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("url_trailers")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Gameplay URLs */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Gameplay URLs <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.url_gameplays}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, url_gameplays: e.target.value })}
                        placeholder={getWatermark("url_gameplays")}
                        className="pr-10"
                      />
                      {getWatermark("url_gameplays") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("url_gameplays")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Screenshot URLs */}
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Screenshot URLs <span className="text-xs text-zinc-400">(comma-separated)</span>
                    </label>
                    <div className="relative">
                      <Input
                        type="text"
                        value={customMetadata.url_screenshots}
                        onChange={(e) => setCustomMetadata({ ...customMetadata, url_screenshots: e.target.value })}
                        placeholder={getWatermark("url_screenshots")}
                        className="pr-10"
                      />
                      {getWatermark("url_screenshots") && (
                        <button
                          type="button"
                          onClick={() => applyWatermark("url_screenshots")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                          title="Apply current value"
                        >
                          <ArrowUturnLeftIcon className="w-4 h-4" />
                        </button>
                      )}
                    </div>
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
      <div className="absolute bottom-4 left-4 text-xs text-zinc-500 dark:text-zinc-400 flex flex-row gap-4 lg:flex-col lg:gap-0 lg:space-y-0.5">
        <div className="truncate max-w-[200px] lg:max-w-none">{workingGame.metadata?.title || workingGame.title || "Unknown"}</div>
        <div>ID: {workingGame.id}</div>
        <div>Version: {workingGame.version || "N/A"}</div>
      </div>
      </>
      )}
    </Dialog>
  );
}
