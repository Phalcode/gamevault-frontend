import { Button } from "@/components/tailwind/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Field, Label } from "@/components/tailwind/fieldset";
import { Input } from "@/components/tailwind/input";
import { Text } from "@/components/tailwind/text";
import { useAuth } from "@/context/AuthContext";
import { resolveApiMediaBlob } from "@/utils/mediaCache";
import { isTauriApp } from "@/utils/tauri";
import {
  applyDroppedSources,
  isProbablyImageUrl,
} from "@/utils/droppedImage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GamevaultUser } from "../../api";

interface Props {
  user: GamevaultUser;
  onClose: () => void;
  /** Optional custom save handler. If omitted, a default PUT is performed. */
  onSave?: (payload: {
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    password?: string;
    birth_date: string | null;
  }) => Promise<{ ok: boolean; message?: string }>;
  onUserUpdated?: (u: GamevaultUser) => void;
  /** If true, treat this editor as editing the current logged-in user (affects endpoints) */
  self?: boolean;
}

type TabKey = "images" | "details";

interface ImageState {
  file: File | null;
  via: "none" | "file" | "url" | "paste" | "drag";
  preview: string | null;
  urlInput: string;
  original: string | null;
  loadedId?: number | null;
}

export function UserEditorModal({
  user,
  onClose,
  onSave,
  onUserUpdated,
  self = false,
}: Props) {
  const { serverUrl, authFetch, refreshCurrentUser } = useAuth() as any;
  const isTauri = isTauriApp();
  const [activeTab, setActiveTab] = useState<TabKey>("images");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const birthRaw = user.birth_date;
  let birthISO = "";
  if (birthRaw) {
    const d = new Date(birthRaw);
    if (!isNaN(d.getTime())) birthISO = d.toISOString().slice(0, 10);
  }

  const [form, setForm] = useState({
    username: user.username || "",
    email: user.email || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    password: "",
    birth_date: birthISO,
  });

  const hasChanges = useMemo(() => {
    const orig = {
      username: user.username || "",
      email: user.email || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      birth_date: birthISO,
    };
    if (form.password.trim().length > 0) return true;
    return Object.keys(orig).some((k) => (orig as any)[k] !== (form as any)[k]);
  }, [form, user, birthISO]);

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setSaveMsg(null);
  };

  const defaultSave = async (
    payload: any,
  ): Promise<{ ok: boolean; message?: string }> => {
    try {
      const base = serverUrl?.replace(/\/+$/, "");
      if (!base) return { ok: false, message: "No server URL" };
      const uid = user.id;
      const endpoint = self
        ? `${base}/api/users/me`
        : `${base}/api/users/${uid}`;
      const res = await authFetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { ok: false, message: txt || res.statusText };
      }
      const updated = await res.json();
      onUserUpdated?.(updated);
      if (self) {
        // Ensure global auth user reflects latest changes
        refreshCurrentUser?.();
      }
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message || "Failed to save" };
    }
  };

  const handleSubmit = async () => {
    if (!hasChanges || saving) return;
    setSaving(true);
    setSaveMsg(null);
    const payload = {
      username: form.username,
      email: form.email,
      first_name: form.first_name,
      last_name: form.last_name,
      birth_date: form.birth_date || null,
      password: form.password.trim() || undefined,
    };
    const res = await (onSave ? onSave(payload) : defaultSave(payload));
    if (res.ok) {
      setForm((f) => ({ ...f, password: "" }));
      setSaveMsg("Successfully saved User details");
    } else {
      setSaveMsg(res.message || "Unknown error");
    }
    setSaving(false);
  };

  // Image state & logic
  const [avatarImg, setAvatarImg] = useState<ImageState>({
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
  const dragTargetRef = useRef<"avatar" | "bg" | null>(null);
  const nativeDragHandledRef = useRef(false);
  const avatarZoneRef = useRef<HTMLDivElement | null>(null);
  const bgZoneRef = useRef<HTMLDivElement | null>(null);

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

  const avatarMediaId = user.avatar?.id;
  const backgroundMediaId = user.background?.id;

  const fetchMediaBlobUrl = useCallback(
    async (id: number): Promise<string | null> => {
      if (!serverUrl || !id) return null;
      try {
        const blob = await resolveApiMediaBlob({
          serverUrl,
          mediaId: id,
          authFetch,
        });
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
      if (avatarMediaId && avatarImg.original == null) {
        const url = await fetchMediaBlobUrl(Number(avatarMediaId));
        if (!cancelled && url)
          setAvatarImg((s) => ({
            ...s,
            preview: url,
            original: url,
            loadedId: Number(avatarMediaId),
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
    avatarMediaId,
    backgroundMediaId,
    fetchMediaBlobUrl,
    avatarImg.original,
    bgImg.original,
  ]);

  const loadFile = (
    file: File,
    target: "avatar" | "bg",
    via: ImageState["via"],
  ) => {
    if (!file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    revokeRef.current.push(url);
    const update = { file, via, preview: url };
    if (target === "avatar") setAvatarImg((prev) => ({ ...prev, ...update }));
    else setBgImg((prev) => ({ ...prev, ...update }));
  };
  const loadUrl = (url: string, target: "avatar" | "bg") => {
    if (!url.trim()) return;
    const safe = url.trim();
    const update = { file: null, via: "url" as const, preview: safe };
    if (target === "avatar")
      setAvatarImg((prev) => ({ ...prev, ...update, urlInput: safe }));
    else setBgImg((prev) => ({ ...prev, ...update, urlInput: safe }));
  };
  const handlePaste = (e: React.ClipboardEvent, target: "avatar" | "bg") => {
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
  const handleDrop = (e: React.DragEvent, target: "avatar" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = null;
    // In Tauri, external drags are handled by the native onDragDropEvent
    // listener; skip here so we don't double-load.
    if (isTauri && nativeDragHandledRef.current) return;
    const f = e.dataTransfer.files?.[0];
    if (f) {
      if (isTauri) nativeDragHandledRef.current = true;
      loadFile(f, target, "drag");
      return;
    }
    const uriList = e.dataTransfer
      .getData("text/uri-list")
      ?.split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    const text = (uriList || e.dataTransfer.getData("text/plain") || "").trim();
    if (text && isProbablyImageUrl(text)) {
      loadUrl(text, target);
    }
  };
  const handleDragOver = (e: React.DragEvent, target: "avatar" | "bg") => {
    e.preventDefault();
    dragTargetRef.current = target;
    nativeDragHandledRef.current = false;
  };
  const loadDroppedPath = async (paths: string[], target: "avatar" | "bg") => {
    await applyDroppedSources(paths, {
      onUrl: (url) => loadUrl(url, target),
      onFile: (file) => {
        if (file.type.startsWith("image/")) loadFile(file, target, "drag");
      },
    });
  };
  const resolveDropTargetByPosition = (position: {
    x: number;
    y: number;
  }): "avatar" | "bg" | null => {
    const dpr = window.devicePixelRatio || 1;
    const x = position.x / dpr;
    const y = position.y / dpr;
    for (const [ref, target] of [
      [avatarZoneRef, "avatar"],
      [bgZoneRef, "bg"],
    ] as const) {
      const el = ref.current;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
        return target;
    }
    return null;
  };
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            nativeDragHandledRef.current = false;
            return;
          }
          if (payload.type !== "drop") return;
          const target =
            dragTargetRef.current ??
            resolveDropTargetByPosition(payload.position);
          const paths = payload.paths ?? [];
          if (!target || !paths.length) return;
          nativeDragHandledRef.current = true;
          void loadDroppedPath(paths, target);
        });
      } catch (err) {
        console.error("Failed to init native drag-drop listener:", err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri]);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesDirty =
    avatarImg.preview !== avatarImg.original ||
    bgImg.preview !== bgImg.original;
  const obtainFileForState = async (
    state: ImageState,
    fallbackName: string,
  ): Promise<File | null> => {
    if (state.file) return state.file;
    if (state.via === "url" && state.preview) {
      try {
        if (isTauri) {
          const { invoke } = await import("@tauri-apps/api/core");
          const res = (await invoke("fetch_url_bytes", {
            url: state.preview,
          })) as { bytes: number[]; content_type: string };
          const bytes = new Uint8Array(res.bytes);
          const mime = res.content_type || "image/png";
          const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
          return new File([bytes], `${fallbackName}.${ext}`, { type: mime });
        }
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
      throw new Error(
        `Upload failed (${res.status}): ${txt || res.statusText}`,
      );
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
      const newAvatar = avatarImg.preview !== avatarImg.original;
      const newBg = bgImg.preview !== bgImg.original;
      let avatarId: number | undefined;
      let backgroundId: number | undefined;
      if (newAvatar) {
        const file = await obtainFileForState(avatarImg, "avatar");
        if (!file) throw new Error("Invalid avatar image");
        avatarId = await uploadImage(file);
      }
      if (newBg) {
        const file = await obtainFileForState(bgImg, "background");
        if (!file) throw new Error("Invalid background image");
        backgroundId = await uploadImage(file);
      }
      if (avatarId || backgroundId) {
        const base = serverUrl?.replace(/\/+$/, "");
        if (!base) throw new Error("Missing server URL");
        const uid = user.id;
        const endpoint = self
          ? `${base}/api/users/me`
          : `${base}/api/users/${uid}`;
        const payload: any = { ...user };
        if (avatarId) payload.avatar_id = avatarId;
        if (backgroundId) payload.background_id = backgroundId;
        delete payload.avatar;
        delete payload.background;
        const res = await authFetch(endpoint, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(
            `User update failed (${res.status}): ${txt || res.statusText}`,
          );
        }
        const updatedUser = await res.json();
        onUserUpdated?.(updatedUser);
        if (self) refreshCurrentUser?.();
      }
      setImagesMsg("Images saved successfully");
      if (newAvatar)
        setAvatarImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: avatarId ?? s.loadedId,
        }));
      if (newBg)
        setBgImg((s) => ({
          ...s,
          original: s.preview,
          via: "none",
          file: null,
          urlInput: "",
          loadedId: backgroundId ?? s.loadedId,
        }));
    } catch (e: any) {
      setImagesMsg(e?.message || "Failed to save images");
    } finally {
      setSavingImages(false);
    }
  };

  return (
    <Dialog open onClose={onClose} size="3xl" className="!h-[min(85vh,850px)] flex flex-col">
      <DialogTitle>User Settings</DialogTitle>
      <div className="px-6 mt-1 flex gap-2 border-b border-gv-line text-sm">
        <button
          onClick={() => setActiveTab("images")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (activeTab === "images"
              ? "border-gv-accent text-gv-accent"
              : "border-transparent text-gv-muted hover:text-gv-text")
          }
        >
          Images
        </button>
        <button
          onClick={() => setActiveTab("details")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (activeTab === "details"
              ? "border-gv-accent text-gv-accent"
              : "border-transparent text-gv-muted hover:text-gv-text")
          }
        >
          Details
        </button>
      </div>
      {/* Fixed panel height so switching tabs does not visually resize the dialog */}
      <DialogBody className="pt-4 overflow-y-auto space-y-8 flex-1 min-h-0">
        {activeTab === "images" && (
          <div className="grid gap-8 md:grid-cols-2">
            {/* Avatar zone */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gv-muted">
                <span>Avatar</span>
                {avatarImg.via !== "none" && (
                  <span className="rounded-full bg-gv-panel px-2 py-0.5 text-[10px] font-semibold text-gv-muted">
                    {avatarImg.via}
                  </span>
                )}
              </div>
              <div
                ref={avatarZoneRef}
                onPaste={(e) => handlePaste(e, "avatar")}
                onDrop={(e) => handleDrop(e, "avatar")}
                onDragOver={(e) => handleDragOver(e, "avatar")}
                className="relative rounded-2xl border-2 border-dashed border-gv-line bg-gv-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-gv-accent/50 hover:bg-gv-panel"
                onClick={() => avatarFileInputRef.current?.click()}
              >
                {avatarImg.preview ? (
                  <img
                    src={avatarImg.preview}
                    alt="Avatar preview"
                    className="object-contain w-full h-full"
                    draggable={false}
                  />
                ) : (
                  <div className="text-xs text-gv-muted text-center px-4">
                    {avatarMediaId ? "Loading…" : "Drag & Drop / Click / Paste"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="Paste image URL"
                  value={avatarImg.urlInput}
                  onChange={(e) =>
                    setAvatarImg((p) => ({ ...p, urlInput: e.target.value }))
                  }
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData("text");
                    if (text && isProbablyImageUrl(text)) {
                      loadUrl(text, "avatar");
                      e.preventDefault();
                    }
                  }}
                />
                {avatarImg.preview &&
                  avatarImg.preview !== avatarImg.original && (
                    <Button
                      color="rose"
                      type="button"
                      onClick={() =>
                        setAvatarImg((p) => ({
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
                ref={avatarFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) loadFile(f, "avatar", "file");
                  e.target.value = "";
                }}
              />
            </div>
            {/* Background zone */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-gv-muted">
                <span>Background</span>
                {bgImg.via !== "none" && (
                  <span className="rounded-full bg-gv-panel px-2 py-0.5 text-[10px] font-semibold text-gv-muted">
                    {bgImg.via}
                  </span>
                )}
              </div>
              <div
                ref={bgZoneRef}
                onPaste={(e) => handlePaste(e, "bg")}
                onDrop={(e) => handleDrop(e, "bg")}
                onDragOver={(e) => handleDragOver(e, "bg")}
                className="relative rounded-2xl border-2 border-dashed border-gv-line bg-gv-panel-soft h-56 flex items-center justify-center cursor-pointer overflow-hidden transition-colors hover:border-gv-accent/50 hover:bg-gv-panel"
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
                  <div className="text-xs text-gv-muted text-center px-4">
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
                  onPaste={(e) => {
                    const text = e.clipboardData?.getData("text");
                    if (text && isProbablyImageUrl(text)) {
                      loadUrl(text, "bg");
                      e.preventDefault();
                    }
                  }}
                />
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
            </div>
          </div>
        )}
        {activeTab === "details" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="grid gap-6 sm:grid-cols-2"
          >
            <Field className="sm:col-span-1">
              <Label>Username</Label>
              <Input name="username" value={form.username} onChange={onInput} />
            </Field>
            <Field className="sm:col-span-1">
              <Label>Email</Label>
              <Input
                type="email"
                name="email"
                value={form.email}
                onChange={onInput}
              />
            </Field>
            <Field className="sm:col-span-1">
              <Label>First name</Label>
              <Input
                name="first_name"
                value={form.first_name}
                onChange={onInput}
              />
            </Field>
            <Field className="sm:col-span-1">
              <Label>Last name</Label>
              <Input
                name="last_name"
                value={form.last_name}
                onChange={onInput}
              />
            </Field>
            <Field className="sm:col-span-1">
              <Label>Password</Label>
              <Input
                type="password"
                name="password"
                autoComplete="new-password"
                placeholder="new password"
                value={form.password}
                onChange={onInput}
              />
            </Field>
            <Field className="sm:col-span-1">
              <Label>Birth date</Label>
              <Input
                type="date"
                name="birth_date"
                value={form.birth_date}
                onChange={onInput}
              />
            </Field>
            <div className="sm:col-span-2 flex items-center gap-4 pt-2">
              {saveMsg && (
                <Text
                  className={
                    "text-xs " +
                    (saveMsg.startsWith("Successfully")
                      ? "text-emerald-400"
                      : "text-rose-400")
                  }
                >
                  {saveMsg}
                </Text>
              )}
              <div className="flex-1" />
              <Button
                type="submit"
                color="indigo"
                disabled={!hasChanges || saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
        {activeTab === "images" && (
          <div className="flex items-center gap-4 pt-2">
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
        )}
      </DialogBody>
      <DialogActions className="justify-end">
        <Button
          type="button"
          onClick={onClose}
          color="zinc"
          disabled={saving || savingImages}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
