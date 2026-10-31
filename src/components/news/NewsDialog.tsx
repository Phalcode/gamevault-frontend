import { GamevaultUserRoleEnum } from "@/api/models/GamevaultUser";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Textarea } from "@/components/tailwind/textarea";
import { useAuth } from "@/context/AuthContext";
import { useInterfaceTranslationLanguage } from "@/hooks/useInterfaceTranslationLanguage";
import { translateTextOnDemand } from "@/utils/domTranslation";
import MarkdownContent from "@/components/MarkdownContent";
import { Button } from "@tw/button";
import { LanguageIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { useNews } from "../../hooks/useNews";

interface NewsDialogProps {
  onClose: () => void;
}

type TabKey = "gv" | "server";

export function NewsDialog({ onClose }: NewsDialogProps) {
  const [tab, setTab] = useState<TabKey>("gv");
  const [isEditingServerNews, setIsEditingServerNews] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { user, serverUrl } = useAuth();
  const { gvNews, serverNews, markNewsAsRead, updateServerNews } = useNews();
  const hasErr = tab === "gv" ? gvNews?.error : serverNews?.error;
  const content =
    tab === "gv"
      ? (gvNews?.content ?? "*Loading GameVault News...*")
      : (serverNews?.content ?? "*Loading Server News...*");
  const isAdmin = Number(user?.role) >= Number(GamevaultUserRoleEnum._3);
  const canEditServerNews = Boolean(serverUrl) && isAdmin && tab === "server";
  const showEditor = canEditServerNews && isEditingServerNews;

  // News is user-written content, like a game description: the interface
  // translator leaves it alone and the user asks for a translation here.
  // Only offered while the desktop app is translating its interface.
  const interfaceTranslationLanguage = useInterfaceTranslationLanguage();
  const [translatedNews, setTranslatedNews] = useState<
    Partial<Record<TabKey, string>>
  >({});
  const [translatingTab, setTranslatingTab] = useState<TabKey | null>(null);
  const newsContent = tab === "gv" ? gvNews?.content : serverNews?.content;
  const translatedNewsContent = translatedNews[tab];
  const canTranslateNews =
    !showEditor &&
    Boolean(interfaceTranslationLanguage) &&
    Boolean(newsContent && newsContent.trim().length > 0);

  useEffect(() => {
    // A saved edit or a refreshed feed invalidates what was translated.
    setTranslatedNews({});
    setTranslatingTab(null);
  }, [gvNews?.content, serverNews?.content]);

  const handleTranslateNews = async () => {
    if (!interfaceTranslationLanguage || !newsContent) return;
    if (translatedNewsContent) {
      setTranslatedNews((prev) => {
        const next = { ...prev };
        delete next[tab];
        return next;
      });
      return;
    }
    const targetTab = tab;
    setTranslatingTab(targetTab);
    try {
      const translated = await translateTextOnDemand(
        newsContent,
        interfaceTranslationLanguage,
      );
      setTranslatedNews((prev) => ({ ...prev, [targetTab]: translated }));
    } catch {
      // Leave the original text in place when the engine is unavailable.
    } finally {
      setTranslatingTab((current) => (current === targetTab ? null : current));
    }
  };

  useEffect(() => {
    markNewsAsRead();
  }, [markNewsAsRead]);

  useEffect(() => {
    if (!showEditor) {
      setDraftContent(serverNews?.content ?? "");
    }
  }, [serverNews?.content, showEditor]);

  useEffect(() => {
    if (tab !== "server" && isEditingServerNews) {
      setIsEditingServerNews(false);
      setSaveError(null);
    }
  }, [tab, isEditingServerNews]);

  const handleStartEditing = () => {
    setDraftContent(serverNews?.content ?? "");
    setSaveError(null);
    setIsEditingServerNews(true);
  };

  const handleCancelEditing = () => {
    setDraftContent(serverNews?.content ?? "");
    setSaveError(null);
    setIsEditingServerNews(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      await updateServerNews(draftContent);
      setIsEditingServerNews(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="3xl"
      className="!h-[min(85vh,850px)] flex flex-col"
    >
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>News</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gv-line text-gv-muted hover:text-gv-text hover:bg-gv-panel-soft"
          aria-label="Close"
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
      <div className="px-6 mt-1 flex items-center gap-3 border-b border-gv-line text-sm">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("gv")}
            className={
              "px-3 py-2 border-b-2 transition-colors " +
              (tab === "gv"
                ? "border-gv-accent text-gv-accent"
                : "border-transparent text-gv-muted hover:text-gv-text")
            }
          >
            GameVault News
          </button>
          <button
            onClick={() => setTab("server")}
            className={
              "px-3 py-2 border-b-2 transition-colors " +
              (tab === "server"
                ? "border-gv-accent text-gv-accent"
                : "border-transparent text-gv-muted hover:text-gv-text")
            }
          >
            Server News
          </button>
        </div>
        {canTranslateNews && (
          <button
            type="button"
            onClick={() => void handleTranslateNews()}
            disabled={translatingTab === tab}
            title={
              translatedNewsContent
                ? "Show the original text"
                : "Translate this text"
            }
            className="mb-1 ml-auto inline-flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] font-medium text-gv-muted transition hover:text-gv-text disabled:opacity-60"
          >
            <LanguageIcon className="size-3.5" />
            {translatingTab === tab
              ? "Translating…"
              : translatedNewsContent
                ? "Original"
                : "Translate"}
          </button>
        )}
      </div>
      <DialogBody className="pt-4 overflow-y-auto flex-1 min-h-0">
        {!showEditor && hasErr && (
          <div className="mb-4 text-sm text-rose-500">{hasErr}</div>
        )}

        {showEditor ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gv-line bg-gv-panel-soft px-4 py-3 text-xs text-gv-muted">
              Markdown supported. Changes save to server `news.md` file.
            </div>

            {saveError && (
              <div className="text-sm text-rose-500">{saveError}</div>
            )}

            <Textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              resizable={false}
              textareaClassName="min-h-105"
              placeholder="Write server news in markdown..."
            />
          </div>
        ) : (
          <div translate="no">
            <MarkdownContent content={translatedNewsContent ?? content} />
          </div>
        )}
      </DialogBody>
      <DialogActions>
        {showEditor ? (
          <>
            <Button
              type="button"
              onClick={handleCancelEditing}
              color="zinc"
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              color="indigo"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        ) : (
          <>
            {canEditServerNews && (
              <Button type="button" onClick={handleStartEditing} plain>
                Edit
              </Button>
            )}
            <Button type="button" onClick={onClose} color="zinc">
              Close
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default NewsDialog;
