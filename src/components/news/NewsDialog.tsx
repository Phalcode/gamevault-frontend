import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Button } from "@tw/button";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { useNews } from "../../hooks/useNews";

interface NewsDialogProps {
  onClose: () => void;
}

type TabKey = "gv" | "server";

export function NewsDialog({ onClose }: NewsDialogProps) {
  const [tab, setTab] = useState<TabKey>("gv");
  const { gvNews, serverNews, markNewsAsRead } = useNews();
  const hasErr = tab === "gv" ? gvNews?.error : serverNews?.error;
  const content =
    tab === "gv"
      ? (gvNews?.content ?? "*Loading GameVault News...*")
      : (serverNews?.content ?? "*Loading Server News...*");

  useEffect(() => {
    markNewsAsRead();
  }, [markNewsAsRead]);

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
      <div className="px-6 mt-1 flex gap-2 border-b border-zinc-200 dark:border-zinc-700 text-sm">
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
      <DialogBody className="pt-4 max-h-[70vh] overflow-y-auto min-h-[420px]">
        {hasErr && <div className="mb-4 text-sm text-rose-500">{hasErr}</div>}
        <Markdown>{content}</Markdown>
      </DialogBody>
      <DialogActions>
        <Button type="button" onClick={onClose} color="zinc">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default NewsDialog;
