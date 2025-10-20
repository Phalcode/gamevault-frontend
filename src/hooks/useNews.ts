import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle
    .digest("SHA-256", encoder.encode(text))
    .then((hashBuffer) => {
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    });
}

interface NewsResult {
  content: string;
  error: string | null;
  isNew: boolean;
}

export function useNews() {
  const { authFetch, serverUrl } = useAuth();
  const [gvNews, setGvNews] = useState<NewsResult | null>(null);
  const [serverNews, setServerNews] = useState<NewsResult | null>(null);

  const checkNews = useCallback(
    async (
      key: string,
      newsText: string,
      setNews: (nr: NewsResult) => void,
    ) => {
      if (!newsText.trim()) {
        setNews({ content: newsText, error: null, isNew: false });
        return;
      }
      const newHash = await hashText(newsText);
      const storedHash = localStorage.getItem(key);
      const isNew = storedHash ? storedHash !== newHash : false;
      setNews({ content: newsText, error: null, isNew });
    },
    [],
  );

  const fetchGvNews = useCallback(async () => {
    try {
      const res = await fetch("https://gamevau.lt/news.md?_=" + Date.now());
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const text = await res.text();
      await checkNews("hash_gv_news", text, setGvNews);
    } catch (error: any) {
      setGvNews({
        content: "",
        error: error.message || "Failed to load GameVault news",
        isNew: false,
      });
    }
  }, [checkNews]);

  const fetchServerNews = useCallback(async () => {
    if (!serverUrl) {
      setServerNews({
        content: "No server connected.",
        error: null,
        isNew: false,
      });
      return;
    }
    try {
      const base = serverUrl.replace(/\/$/, "");
      const res = await authFetch(base + "/api/config/news?_=" + Date.now());
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const text = await res.text();
      await checkNews("hash_server_news", text, setServerNews);
    } catch (error: any) {
      setServerNews({
        content: "",
        error: error.message || "Failed to load Server news",
        isNew: false,
      });
    }
  }, [authFetch, serverUrl, checkNews]);

  const fetchAllNews = useCallback(() => {
    fetchGvNews();
    fetchServerNews();
  }, [fetchGvNews, fetchServerNews]);

  useEffect(() => {
    fetchAllNews();
  }, [fetchAllNews]);

  const hasNewNews = (gvNews?.isNew ?? false) || (serverNews?.isNew ?? false);
  const markNewsAsRead = useCallback(() => {
    if (gvNews?.content) localStorage.setItem("hash_gv_news", "");
    if (serverNews?.content) localStorage.setItem("hash_server_news", "");
    if (gvNews?.content) {
      hashText(gvNews.content).then((hash) =>
        localStorage.setItem("hash_gv_news", hash),
      );
    }
    if (serverNews?.content) {
      hashText(serverNews.content).then((hash) =>
        localStorage.setItem("hash_server_news", hash),
      );
    }
  }, [gvNews, serverNews]);

  return { gvNews, serverNews, fetchAllNews, hasNewNews, markNewsAsRead };
}
