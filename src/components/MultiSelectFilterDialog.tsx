import { useAuth } from "@/context/AuthContext";
import { Badge } from "@tw/badge";
import { Button } from "@tw/button";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "@tw/dialog";
import { Input } from "@tw/input";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useCallback, useEffect, useMemo, useState } from "react";

// Badge color type from the badge component
type BadgeColor =
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "green"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "fuchsia"
  | "pink"
  | "rose"
  | "zinc";

export interface FilterItem {
  id: number | string;
  name: string;
}

interface MultiSelectFilterDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** API endpoint to fetch items from, or undefined for static items */
  endpoint?: string;
  /** Static items to use instead of fetching from API */
  staticItems?: FilterItem[];
  selectedItems: FilterItem[];
  onSelectionChange: (items: FilterItem[]) => void;
  /** Badge color for selected items */
  badgeColor?: BadgeColor;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { totalItems: number };
  links: { next?: string | null };
}

// Map badge colors to Tailwind classes for list item highlights
const colorClasses: Record<
  BadgeColor,
  { bg: string; text: string; check: string }
> = {
  red: {
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-700 dark:text-red-300",
    check: "text-red-500",
  },
  orange: {
    bg: "bg-orange-50 dark:bg-orange-900/20",
    text: "text-orange-700 dark:text-orange-300",
    check: "text-orange-500",
  },
  amber: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    check: "text-amber-500",
  },
  yellow: {
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
    text: "text-yellow-700 dark:text-yellow-300",
    check: "text-yellow-500",
  },
  lime: {
    bg: "bg-lime-50 dark:bg-lime-900/20",
    text: "text-lime-700 dark:text-lime-300",
    check: "text-lime-500",
  },
  green: {
    bg: "bg-green-50 dark:bg-green-900/20",
    text: "text-green-700 dark:text-green-300",
    check: "text-green-500",
  },
  emerald: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-300",
    check: "text-emerald-500",
  },
  teal: {
    bg: "bg-teal-50 dark:bg-teal-900/20",
    text: "text-teal-700 dark:text-teal-300",
    check: "text-teal-500",
  },
  cyan: {
    bg: "bg-cyan-50 dark:bg-cyan-900/20",
    text: "text-cyan-700 dark:text-cyan-300",
    check: "text-cyan-500",
  },
  sky: {
    bg: "bg-sky-50 dark:bg-sky-900/20",
    text: "text-sky-700 dark:text-sky-300",
    check: "text-sky-500",
  },
  blue: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-700 dark:text-blue-300",
    check: "text-blue-500",
  },
  indigo: {
    bg: "bg-indigo-50 dark:bg-indigo-900/20",
    text: "text-indigo-700 dark:text-indigo-300",
    check: "text-indigo-500",
  },
  violet: {
    bg: "bg-violet-50 dark:bg-violet-900/20",
    text: "text-violet-700 dark:text-violet-300",
    check: "text-violet-500",
  },
  purple: {
    bg: "bg-purple-50 dark:bg-purple-900/20",
    text: "text-purple-700 dark:text-purple-300",
    check: "text-purple-500",
  },
  fuchsia: {
    bg: "bg-fuchsia-50 dark:bg-fuchsia-900/20",
    text: "text-fuchsia-700 dark:text-fuchsia-300",
    check: "text-fuchsia-500",
  },
  pink: {
    bg: "bg-pink-50 dark:bg-pink-900/20",
    text: "text-pink-700 dark:text-pink-300",
    check: "text-pink-500",
  },
  rose: {
    bg: "bg-rose-50 dark:bg-rose-900/20",
    text: "text-rose-700 dark:text-rose-300",
    check: "text-rose-500",
  },
  zinc: {
    bg: "bg-zinc-50 dark:bg-zinc-800/50",
    text: "text-zinc-700 dark:text-zinc-300",
    check: "text-zinc-500",
  },
};

export default function MultiSelectFilterDialog({
  open,
  onClose,
  title,
  endpoint,
  staticItems,
  selectedItems,
  onSelectionChange,
  badgeColor = "blue",
}: MultiSelectFilterDialogProps) {
  const { serverUrl, authFetch } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [allItems, setAllItems] = useState<FilterItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get color classes based on badgeColor
  const colors = colorClasses[badgeColor];

  // Fetch all items from the endpoint (only if endpoint is provided)
  const fetchItems = useCallback(async () => {
    if (!serverUrl || !endpoint) return;
    setLoading(true);
    setError(null);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const params = new URLSearchParams();
      params.set("limit", "1000"); // Fetch all items
      const url = `${base}${endpoint}?${params.toString()}`;
      const res = await authFetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`Failed to fetch ${title} (${res.status})`);
      const json: PaginatedResponse<FilterItem> = await res.json();
      setAllItems(json.data || []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [serverUrl, authFetch, endpoint, title]);

  useEffect(() => {
    if (open) {
      if (staticItems) {
        setAllItems(staticItems);
      } else {
        fetchItems();
      }
      setSearchQuery("");
    }
  }, [open, fetchItems, staticItems]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery) return allItems;
    const query = searchQuery.toLowerCase();
    return allItems.filter((item) => item.name.toLowerCase().includes(query));
  }, [allItems, searchQuery]);

  // Check if an item is selected
  const isSelected = useCallback(
    (item: FilterItem) => selectedItems.some((s) => s.name === item.name),
    [selectedItems],
  );

  // Toggle item selection
  const toggleItem = useCallback(
    (item: FilterItem) => {
      if (isSelected(item)) {
        onSelectionChange(selectedItems.filter((s) => s.name !== item.name));
      } else {
        onSelectionChange([...selectedItems, item]);
      }
    },
    [isSelected, selectedItems, onSelectionChange],
  );

  // Remove item from selection
  const removeItem = useCallback(
    (item: FilterItem) => {
      onSelectionChange(selectedItems.filter((s) => s.name !== item.name));
    },
    [selectedItems, onSelectionChange],
  );

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        {/* Selected items display */}
        {selectedItems.length > 0 && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-fg-muted mb-2">
              Selected ({selectedItems.length})
            </label>
            <div className="flex flex-wrap gap-2">
              {selectedItems.map((item) => (
                <Badge
                  key={item.name}
                  color={badgeColor}
                  className="cursor-pointer flex items-center gap-1"
                >
                  {item.name}
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    className="hover:text-red-400"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Search input */}
        <div className="mb-4">
          <Input
            name="search"
            value={searchQuery}
            onChange={(e: any) => setSearchQuery(e.target.value)}
            clearable
            onClear={() => setSearchQuery("")}
            placeholder={`Search ${title.toLowerCase()}...`}
          />
        </div>

        {/* Items list */}
        {loading && <div className="text-sm text-fg-muted">Loading...</div>}
        {error && <div className="text-sm text-red-500">{error}</div>}
        {!loading && !error && (
          <div className="max-h-64 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-fg-muted text-center">
                No {title.toLowerCase()} found
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleItem(item)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
                      isSelected(item)
                        ? `${colors.bg} ${colors.text}`
                        : "text-zinc-900 dark:text-zinc-100"
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      {item.name}
                      {isSelected(item) && (
                        <svg
                          className={`h-4 w-4 ${colors.check}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogBody>
      <DialogActions>
        <Button outline onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
