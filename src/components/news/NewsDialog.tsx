import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogTitle, DialogBody, DialogActions } from "@/components/tailwind/dialog";
import { Button } from "@tw/button";
import { useCallback, useEffect, useState } from "react";

interface NewsDialogProps { onClose: () => void; }

type TabKey = 'gv' | 'server';

// Very small markdown to HTML converter (supports headings, bold, italic, links, code blocks, inline code, lists, paragraphs)
function basicMarkdown(md: string): string {
  let out = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  out = out.replace(/```([\s\S]*?)```/g, (_,code)=>`<pre class="rounded-md bg-zinc-900/90 text-[11px] p-3 overflow-x-auto"><code>${code.replace(/`/g,'&#96;')}</code></pre>`);
  out = out.replace(/^###### (.*)$/gm,'<h6 class="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">$1</h6>')
           .replace(/^##### (.*)$/gm,'<h5 class="mt-6 mb-2 text-sm font-semibold">$1</h5>')
           .replace(/^#### (.*)$/gm,'<h4 class="mt-6 mb-2 text-base font-semibold">$1</h4>')
           .replace(/^### (.*)$/gm,'<h3 class="mt-6 mb-2 text-lg font-semibold">$1</h3>')
           .replace(/^## (.*)$/gm,'<h2 class="mt-8 mb-3 text-xl font-bold">$1</h2>')
           .replace(/^# (.*)$/gm,'<h1 class="mt-8 mb-4 text-2xl font-bold">$1</h1>');
  out = out.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
           .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g,'<em>$1</em>')
           .replace(/`([^`]+)`/g,'<code class="px-1 py-0.5 rounded bg-zinc-800/80 text-[11px]">$1</code>')
           .replace(/\[(.+?)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" class="text-indigo-500 hover:underline">$1</a>');
  // unordered lists
  out = out.replace(/(^|\n)(?:- |\* )(.*(?:\n(?:- |\* ).+)*)/g,(_,lead,body)=>{
    const items: string[] = body.split(/\n(?:- |\* )/).map((s: string)=>s.trim()).filter(Boolean);
    return `${lead}<ul class="list-disc pl-5 my-3 space-y-1">${items.map((i: string)=>`<li>${i}</li>`).join('')}</ul>`;
  });
  // paragraphs (wrap lines not already block-level)
  out = out.split(/\n{2,}/).map(block => {
    if (/^\s*<(h\d|ul|pre)/.test(block)) return block; // already block element
    return `<p class="my-3 leading-relaxed">${block.replace(/\n+/g,'<br/>')}</p>`;
  }).join('\n');
  return out;
}

export function NewsDialog({ onClose }: NewsDialogProps) {
  const { authFetch, serverUrl } = useAuth();
  const [tab, setTab] = useState<TabKey>('gv');
  const [gvMd, setGvMd] = useState<string>('*Loading GameVault News...*');
  const [serverMd, setServerMd] = useState<string>('*Loading Server News...*');
  const [errorGv, setErrorGv] = useState<string | null>(null);
  const [errorServer, setErrorServer] = useState<string | null>(null);

  const fetchGv = useCallback(async () => {
    try {
      setErrorGv(null);
      const res = await fetch('https://gamevau.lt/news.md?_=' + Date.now());
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      setGvMd(await res.text());
    } catch (e:any) { setErrorGv(e.message || 'Failed to load GameVault news'); }
  }, []);

  const fetchServer = useCallback(async () => {
    if (!serverUrl) { setServerMd('No server connected.'); return; }
    try {
      setErrorServer(null);
      const base = serverUrl.replace(/\/$/, '');
      const res = await authFetch(base + '/api/config/news?_=' + Date.now());
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      setServerMd(await res.text());
    } catch (e:any) { setErrorServer(e.message || 'Failed to load Server news'); }
  }, [serverUrl]);

  useEffect(()=>{ fetchGv(); fetchServer(); }, [fetchGv, fetchServer]);

  const rendered = basicMarkdown(tab==='gv' ? gvMd : serverMd);
  const hasErr = tab==='gv' ? errorGv : errorServer;

  return (
    <Dialog open onClose={onClose} size="3xl">
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>News</span>
        <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300/40 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" fill="none"><path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" /><path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" /></svg>
        </button>
      </DialogTitle>
      <div className="px-6 mt-1 flex gap-2 border-b border-zinc-200 dark:border-zinc-700 text-sm">
        <button onClick={()=>setTab('gv')} className={"px-3 py-2 border-b-2 transition-colors "+(tab==='gv'? 'border-indigo-500 text-indigo-500':'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')}>GameVault News</button>
        <button onClick={()=>setTab('server')} className={"px-3 py-2 border-b-2 transition-colors "+(tab==='server'? 'border-indigo-500 text-indigo-500':'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')}>Server News</button>
      </div>
      <DialogBody className="pt-4 max-h-[70vh] overflow-y-auto min-h-[420px]">
        {hasErr && <div className="mb-4 text-sm text-rose-500">{hasErr}</div>}
        <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: rendered }} />
      </DialogBody>
      <DialogActions className="justify-end">
        <div className="flex-1 flex gap-2 items-center text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="ml-1">Content fetched live · <button onClick={()=>{tab==='gv'?fetchGv():fetchServer();}} className="underline hover:text-indigo-500">Reload</button></span>
        </div>
        <Button type="button" onClick={onClose} color="zinc">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
export default NewsDialog;
