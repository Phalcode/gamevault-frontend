import { useEffect, useRef, useCallback } from "react";

export interface TabDef {
  key: string;
  label: string;
  icon?: React.ReactNode;
}

interface Props {
  tabs: TabDef[];
  activeKey: string;
  onChange: (key: string) => void;
}

export function TabNav({ tabs, activeKey, onChange }: Props) {
  const listRef = useRef<HTMLUListElement | null>(null);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const idx = tabs.findIndex((t) => t.key === activeKey);
      if (idx === -1) return;
      if (e.key === "ArrowRight") {
        const next = tabs[(idx + 1) % tabs.length];
        onChange(next.key);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
        onChange(prev.key);
        e.preventDefault();
      }
    },
    [tabs, activeKey, onChange],
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("keydown", handleKey);
    return () => el.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div
      className="fixed top-0 left-0 right-0 h-16 flex items-end justify-center px-6 pb-1 bg-[linear-gradient(140deg,rgba(17,16,30,0.9),rgba(27,26,39,0.9))] backdrop-blur-md border-b border-border/70 z-[1400]"
      role="banner"
    >
      <nav
        aria-label="Main"
        className="w-full max-w-[1000px] mx-auto flex justify-center"
      >
        <ul
          className="flex flex-wrap gap-1 m-0 p-0 list-none justify-center"
          role="tablist"
          ref={listRef}
        >
          {tabs.map((t) => {
            const selected = t.key === activeKey;
            return (
              <li key={t.key} role="presentation">
                <button
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onChange(t.key)}
                  type="button"
                  className={[
                    "cursor-pointer relative inline-flex items-center gap-2 rounded-[14px] border text-[0.72rem] font-semibold tracking-[.7px] px-5 py-[11px] transition outline-none",
                    selected
                      ? "bg-[linear-gradient(120deg,#5c53d8,#7169ff)] border-[#6d63f0] text-white shadow-[0_4px_14px_-4px_rgba(100,89,223,0.55)]"
                      : "bg-[linear-gradient(120deg,#2f2e42,#2a293a)] border-[#3f3e52] text-[#d2d2e4] hover:border-[#565578] hover:brightness-110",
                    "before:absolute before:inset-0 before:rounded-[14px] before:pointer-events-none before:opacity-0 before:transition-opacity before:bg-[radial-gradient(circle_at_30%_25%,rgba(255,255,255,0.22),transparent_70%)] hover:before:opacity-100",
                    selected && "before:opacity-100",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span aria-hidden="true">{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
