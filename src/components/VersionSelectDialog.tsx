import { GameVersionEntity } from "@/api/models/GameVersionEntity";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from "@/components/tailwind/dialog";
import { Button } from "@tw/button";

interface VersionSelectDialogProps {
  open: boolean;
  gameTitle: string;
  versions: GameVersionEntity[];
  onSelect: (version: GameVersionEntity) => void;
  onClose: () => void;
}

export function VersionSelectDialog({
  open,
  gameTitle,
  versions,
  onSelect,
  onClose,
}: VersionSelectDialogProps) {
  if (!open) return null;

  return (
    <Dialog open onClose={onClose} size="lg">
      <DialogTitle>Select Version</DialogTitle>
      <DialogDescription>
        Choose which version of {gameTitle} you want to download.
      </DialogDescription>
      <DialogBody className="pt-3">
        <div className="flex flex-col gap-2">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => onSelect(version)}
              className="w-full rounded-md border border-zinc-300/60 dark:border-zinc-700 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ({version.id}) {version.version || "Unknown Version"}
            </button>
          ))}
        </div>
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
