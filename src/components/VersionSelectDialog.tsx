import { GameVersionEntity } from "@/api/models/GameVersionEntity";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tw/table";
import { CheckIcon } from "@heroicons/react/24/solid";
import { Button } from "@tw/button";
import { useMemo, useState } from "react";

interface VersionSelectDialogProps {
  open: boolean;
  gameTitle: string;
  versions: GameVersionEntity[];
  onSelect: (version: GameVersionEntity) => void;
  onClose: () => void;
}

type SortKey = "version" | "indexed_at" | "type" | "early_access" | "size";

export function VersionSelectDialog({
  open,
  gameTitle,
  versions,
  onSelect,
  onClose,
}: VersionSelectDialogProps) {
  const [sortBy, setSortBy] = useState<SortKey>("indexed_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const toSizeNumber = (size: string) => {
    const parsed = Number(size);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const formatSize = (rawSize: string) => {
    const bytes = toSizeNumber(rawSize);
    if (bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB", "PB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    const precision = value < 10 ? 2 : value < 100 ? 1 : 0;
    return `${value.toFixed(precision)} ${units[unitIndex]}`;
  };

  const formatGameType = (type: string) =>
    type
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const formatIndexedAt = (value: Date) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  };

  const sortedVersions = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...versions].sort((left, right) => {
      let compareValue = 0;

      if (sortBy === "version") {
        compareValue = (left.version || "").localeCompare(right.version || "", undefined, {
          sensitivity: "base",
          numeric: true,
        });
      } else if (sortBy === "indexed_at") {
        compareValue =
          new Date(left.indexed_at).getTime() - new Date(right.indexed_at).getTime();
      } else if (sortBy === "type") {
        compareValue = left.type.localeCompare(right.type, undefined, {
          sensitivity: "base",
        });
      } else if (sortBy === "early_access") {
        compareValue = Number(left.early_access) - Number(right.early_access);
      } else if (sortBy === "size") {
        compareValue = toSizeNumber(left.size) - toSizeNumber(right.size);
      }

      return compareValue * multiplier;
    });
  }, [versions, sortBy, sortDirection]);

  const handleSort = (nextSortBy: SortKey) => {
    if (sortBy === nextSortBy) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(nextSortBy);
    setSortDirection("asc");
  };

  const sortIndicator = (key: SortKey) => {
    if (sortBy !== key) return "↕";
    return sortDirection === "asc" ? "↑" : "↓";
  };

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} size="5xl">
      <DialogTitle>Select Version</DialogTitle>
      <DialogDescription>
        Choose which version of {gameTitle} you want to download.
      </DialogDescription>
      <DialogBody className="pt-3">
        <Table className="[--gutter:--spacing(3)] max-h-[55vh] overflow-y-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-thumb]:rounded-full dark:[&::-webkit-scrollbar-thumb]:bg-zinc-600 [scrollbar-color:#a1a1aa_transparent] dark:[scrollbar-color:#52525b_transparent]">
          <TableHead>
            <TableRow>
              <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => handleSort("version")}
                  className="inline-flex items-center gap-1"
                >
                  Version {sortIndicator("version")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => handleSort("indexed_at")}
                  className="inline-flex items-center gap-1"
                >
                  Date Added {sortIndicator("indexed_at")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => handleSort("type")}
                  className="inline-flex items-center gap-1"
                >
                  Game Type {sortIndicator("type")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900 text-center">
                <button
                  type="button"
                  onClick={() => handleSort("early_access")}
                  className="inline-flex items-center gap-1"
                >
                  Early Access {sortIndicator("early_access")}
                </button>
              </TableHeader>
              <TableHeader className="sticky top-0 z-10 bg-white dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => handleSort("size")}
                  className="inline-flex items-center gap-1"
                >
                  Size {sortIndicator("size")}
                </button>
              </TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedVersions.map((version) => (
              <TableRow
                key={version.id}
                className="cursor-pointer hover:bg-zinc-100/80 dark:hover:bg-zinc-800/70"
                onClick={() => onSelect(version)}
              >
                <TableCell>
                  <span
                    className="block max-w-[25rem] overflow-hidden text-ellipsis whitespace-nowrap"
                    title={`(${version.id}) ${version.version || "Unknown Version"}`}
                  >
                    {version.version || "Unknown Version"}
                  </span>
                </TableCell>
                <TableCell>{formatIndexedAt(version.indexed_at)}</TableCell>
                <TableCell>{formatGameType(version.type)}</TableCell>
                <TableCell className="text-center">
                  {version.early_access ? (
                    <span className="inline-flex items-center justify-center" title="Early Access">
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{formatSize(version.size)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default VersionSelectDialog;
