import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Button } from "@/components/tailwind/button";
import type { RootPathEntry } from "@/utils/rootPaths";
import {
  FolderIcon,
  Cog6ToothIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

interface RootPathSelectDialogProps {
  open: boolean;
  gameTitle: string;
  rootPaths: RootPathEntry[];
  onSelect: (rootPath: string) => void;
  onClose: () => void;
  onGoToSettings: () => void;
}

export function RootPathSelectDialog({
  open,
  gameTitle,
  rootPaths,
  onSelect,
  onClose,
  onGoToSettings,
}: RootPathSelectDialogProps) {
  if (!open) return null;

  const displayPath = (fullPath: string) => {
    const segments = fullPath.split(/[\\/]/);
    return segments.slice(-2).join("/");
  };

  return (
    <Dialog open onClose={onClose} size="lg">
      <div className="flex items-start justify-between">
        <div>
          <DialogTitle>Select Download Location</DialogTitle>
          <DialogDescription>
            Choose where to save <strong>{gameTitle}</strong>.
          </DialogDescription>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onGoToSettings();
          }}
          className="rounded-xl p-2 text-gv-muted hover:bg-gv-panel-soft hover:text-gv-text transition-colors cursor-pointer"
          aria-label="Go to download settings"
          title="Configure download locations"
        >
          <Cog6ToothIcon className="h-5 w-5" />
        </button>
      </div>
      <DialogBody className="pt-3">
        <div className="space-y-2">
          {rootPaths.map((root) => (
            <button
              key={root.id}
              type="button"
              onClick={() => onSelect(root.path)}
              className="flex w-full items-center gap-3 rounded-xl border border-gv-line bg-gv-panel p-4 text-left transition-colors hover:border-gv-accent hover:bg-gv-panel-soft cursor-pointer"
            >
              <FolderIcon className="h-6 w-6 shrink-0 text-gv-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-gv-text">
                  {root.label || displayPath(root.path)}
                </div>
                <div className="truncate text-xs text-gv-muted">
                  {root.path}
                </div>
              </div>
              {root.label && (
                <span className="shrink-0 rounded-full bg-gv-panel-soft px-2 py-0.5 text-xs text-gv-muted">
                  {root.label}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" color="zinc" onClick={onClose}>
            <XMarkIcon className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  );
}
