import { MinusIcon, PlusIcon } from "@heroicons/react/16/solid";
import { Button } from "@/components/tailwind/button";

interface RowCountControlProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export function RowCountControl({
  value,
  onChange,
  min = 1,
  max = 5,
}: RowCountControlProps) {
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-xs text-gv-muted mr-1">Rows</span>
      <Button
        plain
        className="!p-1 min-h-0"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease rows"
      >
        <MinusIcon className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs font-medium text-gv-text w-4 text-center tabular-nums">
        {value}
      </span>
      <Button
        plain
        className="!p-1 min-h-0"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase rows"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
