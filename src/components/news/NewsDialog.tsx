import { GamevaultUserRoleEnum } from "@/api/models/GamevaultUser";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Textarea } from "@/components/tailwind/textarea";
import { useAuth } from "@/context/AuthContext";
import MarkdownContent from "@/components/MarkdownContent";
import { Button } from "@tw/button";
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
    <Dialog open onClose={onClose} size="3xl">
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>News</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300/40 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
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
      <div className="px-6 mt-1 flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-700 text-sm">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("gv")}
            className={
              "px-3 py-2 border-b-2 transition-colors " +
              (tab === "gv"
                ? "border-indigo-500 text-indigo-500"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200")
            }
          >
            GameVault News
          </button>
          <button
            onClick={() => setTab("server")}
            className={
              "px-3 py-2 border-b-2 transition-colors " +
              (tab === "server"
                ? "border-indigo-500 text-indigo-500"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200")
            }
          >
            Server News
          </button>
        </div>
      </div>
      <DialogBody className="pt-4 max-h-[70vh] overflow-y-auto min-h-[420px]">
        {!showEditor && hasErr && (
          <div className="mb-4 text-sm text-rose-500">{hasErr}</div>
        )}

        {showEditor ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
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
          <MarkdownContent content={content} />
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
