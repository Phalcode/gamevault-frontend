import { useMemo } from "react";
import type { DiskUsageData } from "@/hooks/useDiskUsage";
import { formatDecimal, formatNumber } from "@/utils/number";

const COLORS = {
  current: "#F4417F", // deep pink
  other: "#2EB8A8", // light sea green
  unmanaged: "#C86B8E", // pale violet red
  free: "#8B8B8B", // dark gray
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${formatDecimal(value, value < 10 ? 2 : value < 100 ? 1 : 0)} ${
    units[unitIndex]
  }`;
}

interface DiskUsageChartProps {
  data: DiskUsageData | null;
  loading?: boolean;
  gameTitle?: string;
  rootPath?: string;
}

export default function DiskUsageChart({
  data,
  loading = false,
  gameTitle,
  rootPath,
}: DiskUsageChartProps) {
  const segments = useMemo(() => {
    if (!data) return [];
    return [
      {
        label: `This Game${gameTitle ? ` (${gameTitle})` : ""}`,
        value: data.currentGameSize,
        color: COLORS.current,
      },
      {
        label: "Other installed GameVault Games",
        value: data.otherGamesSize,
        color: COLORS.other,
      },
      {
        label: "Unmanaged Data",
        value: data.unmanagedData,
        color: COLORS.unmanaged,
      },
      {
        label: "Free Space",
        value: data.free,
        color: COLORS.free,
      },
    ].filter((segment) => segment.value > 0);
  }, [data, gameTitle]);

  const total = data?.total ?? 0;

  if (loading) {
    return (
      <div className="rounded-xl border border-gv-line bg-gv-panel-soft p-4">
        <p className="text-sm text-gv-muted">Loading disk usage…</p>
      </div>
    );
  }

  if (!data || total <= 0) {
    return (
      <div className="rounded-xl border border-gv-line bg-gv-panel-soft p-4">
        <p className="text-sm text-gv-muted">Disk usage is not available.</p>
      </div>
    );
  }

  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  const arcs = segments.map((segment) => {
    const fraction = segment.value / total;
    const dash = fraction * circumference;
    const offset = cumulative;
    cumulative += dash;
    return (
      <circle
        key={segment.label}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={segment.color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
      />
    );
  });

  return (
    <div className="rounded-xl border border-gv-line bg-gv-panel-soft p-4">
      <div className="text-sm font-semibold text-gv-text">Disk Usage</div>
      {rootPath && (
        <div className="mt-0.5 font-mono text-xs text-gv-muted">{rootPath}</div>
      )}

      <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-40 w-40 shrink-0"
          role="img"
          aria-label="Disk usage breakdown"
        >
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>{arcs}</g>
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill="currentColor"
            className="text-gv-muted text-[11px]"
          >
            {formatBytes(total)}
          </text>
        </svg>

        <ul className="w-full space-y-2">
          {segments.map((segment) => (
            <li
              key={segment.label}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="flex-1 text-gv-text">{segment.label}</span>
              <span className="text-gv-muted">
                {formatBytes(segment.value)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
