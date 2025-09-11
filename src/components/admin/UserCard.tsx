import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { PermissionRole, PermissionRoleLabel, User } from "../../types/api";
import { UserAvatarMini } from "./UserAvatarMini";
import { MaterialSymbolsRefreshRounded } from "./MaterialSymbolsRefreshRounded";

interface Props {
  user: User;
  serverUrl?: string;
  busy: boolean;
  editing: boolean;
  onEdit: (u: User) => void;
  onToggleActive: (u: User) => void;
  onDelete: (u: User) => void;
  onRecover: (u: User) => void;
  onChangeRole: (u: User, role: PermissionRole) => void;
}

const ROLE_OPTIONS: PermissionRole[] = [
  PermissionRole.GUEST,
  PermissionRole.USER,
  PermissionRole.EDITOR,
  PermissionRole.ADMIN,
];

interface RoleDropdownProps {
  role: PermissionRole;
  disabled: boolean;
  onChange: (r: PermissionRole) => void;
}

interface PanelCoords {
  left: number;
  top: number;
  width: number;
  placement: "bottom" | "top";
}

function RoleDropdown({ role, disabled, onChange }: RoleDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(
    Math.max(
      0,
      ROLE_OPTIONS.findIndex((r) => r === role),
    ),
  );
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLUListElement | null>(null);
  const [coords, setCoords] = useState<PanelCoords | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const calcPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estimatedHeight =
      panelRef.current?.offsetHeight ?? ROLE_OPTIONS.length * 34 + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlip =
      spaceBelow < estimatedHeight + 8 && spaceAbove > estimatedHeight + 8;
    const top = shouldFlip ? rect.top - estimatedHeight - 6 : rect.bottom + 6;
    setCoords({
      left: rect.left,
      top,
      width: rect.width,
      placement: shouldFlip ? "top" : "bottom",
    });
  }, []);

  const openPanel = useCallback(() => {
    if (disabled) return;
    setActiveIndex(
      Math.max(
        0,
        ROLE_OPTIONS.findIndex((r) => r === role),
      ),
    );
    setOpen(true);
  }, [disabled, role]);

  // Recalculate position when open
  useLayoutEffect(() => {
    if (!open) return;
    calcPosition();
  }, [open, calcPosition]);

  // Scroll/resize reposition
  useEffect(() => {
    if (!open) return;
    const handler = () => calcPosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open, calcPosition]);

  // Outside click + escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Focus panel when opening
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        panelRef.current?.focus();
      });
    }
  }, [open]);

  const commit = (idx: number) => {
    const val = ROLE_OPTIONS[idx];
    if (val !== role) onChange(val);
    close();
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openPanel();
      else if (e.key !== "ArrowDown") commit(activeIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openPanel();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % ROLE_OPTIONS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(
        (i) => (i - 1 + ROLE_OPTIONS.length) % ROLE_OPTIONS.length,
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(ROLE_OPTIONS.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(activeIndex);
    }
  };

  const btnBase =
    "w-full inline-flex items-center justify-between gap-2.5 rounded-[10px] px-3 py-2 text-[0.65rem] font-semibold tracking-wide transition disabled:opacity-45 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
  const btnColors =
    "bg-[linear-gradient(140deg,#252436,#1f1e2d)] text-[#ececf6] hover:bg-[linear-gradient(140deg,#2b2a3d,#242335)]";
  const btnOpen =
    "bg-[linear-gradient(140deg,#302f46,#27263a)] shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)]";
  return (
    <div className="relative text-[0.65rem] w-[148px]">
      <button
        ref={triggerRef}
        type="button"
        className={[
          btnBase,
          btnColors,
          open && !disabled ? btnOpen : "",
          disabled ? "cursor-default" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="role-dropdown-panel"
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKey}
      >
        <span className="flex-1 truncate text-left">
          {PermissionRoleLabel[role]}
        </span>
        <span
          className="flex items-center justify-center w-[18px] h-[18px] text-[#b2b4c7] transition-transform duration-300 ease-[cubic-bezier(.55,.1,.3,1)]"
          style={
            open
              ? {
                  transform: "rotate(180deg)",
                  color: "var(--color-accent,#6459DF)",
                }
              : undefined
          }
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {open &&
        coords &&
        createPortal(
          <ul
            id="role-dropdown-panel"
            role="listbox"
            aria-activedescendant={`role-opt-${ROLE_OPTIONS[activeIndex]}`}
            ref={panelRef}
            tabIndex={-1}
            data-placement={coords.placement}
            style={{
              position: "fixed",
              left: coords.left,
              top: coords.top,
              width: coords.width,
            }}
            onKeyDown={onListKey}
            className="m-0 p-1.5 list-none box-border max-h-60 overflow-y-auto bg-[linear-gradient(155deg,rgba(38,37,55,0.92),rgba(24,23,36,0.92))] backdrop-blur-xl backdrop-saturate-150 rounded-xl shadow-[0_28px_60px_-20px_rgba(0,0,0,0.75),0_10px_26px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] animate-[dropdown-fade_.22s_cubic-bezier(.4,.2,.2,1)] focus:outline-none z-[9999]"
          >
            {ROLE_OPTIONS.map((r, idx) => {
              const selected = r === role;
              const active = idx === activeIndex;
              const base =
                "relative flex items-center gap-2 px-2.5 py-2 text-[0.65rem] font-semibold tracking-wide rounded-lg cursor-pointer select-none transition-colors";
              const hover =
                "hover:bg-[linear-gradient(145deg,#2c2b3e,#262536)] hover:text-white";
              const sel =
                "bg-[linear-gradient(145deg,#443d72,#352f5a)] text-white shadow-[0_0_0_1px_rgba(100,89,223,0.55),0_6px_20px_-10px_rgba(100,89,223,0.45)]";
              const act =
                "bg-[linear-gradient(145deg,#34324c,#2a293d)] text-white";
              return (
                <li
                  id={`role-opt-${r}`}
                  key={r}
                  role="option"
                  aria-selected={selected}
                  data-index={idx}
                  className={[
                    base,
                    hover,
                    selected && sel,
                    !selected && active && act,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commit(idx)}
                >
                  <span
                    className="w-4 h-4 flex items-center justify-center text-transparent transition-colors"
                    aria-hidden="true"
                    style={
                      selected
                        ? { color: "var(--color-accent,#6459DF)" }
                        : undefined
                    }
                  >
                    {selected && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span>{PermissionRoleLabel[r]}</span>
                  <span
                    className="pointer-events-none absolute inset-0 opacity-0 rounded-lg transition-opacity"
                    style={{
                      background:
                        "radial-gradient(circle at 20% 15%,rgba(100,89,223,0.25),transparent 70%),linear-gradient(160deg,rgba(100,89,223,0.22),rgba(100,89,223,0))",
                      mixBlendMode: "overlay",
                      opacity: selected ? 0.55 : undefined,
                    }}
                    aria-hidden="true"
                  />
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

export function UserCard({
  user,
  serverUrl,
  busy,
  editing,
  onEdit,
  onToggleActive,
  onDelete,
  onRecover,
  onChangeRole,
}: Props) {
  const uid = user.id ?? (user as any).ID;
  const del = user.deleted_at ?? (user as any).DeletedAt;
  const isDeleted = del != null;
  const activeRaw = user.activated ?? (user as any).Activated;
  const isActive =
    activeRaw === true || activeRaw === 1 || activeRaw === "activated";
  const role = (
    typeof user.role === "number" ? user.role : PermissionRole.GUEST
  ) as PermissionRole;

  return (
    <li
      className={[
        "relative group flex items-center gap-3 p-3 rounded-[14px] min-h-[110px] backdrop-blur-sm shadow-[0_2px_6px_-2px_rgba(0,0,0,0.5)] border transition-colors",
        "bg-[rgba(32,31,45,0.55)]",
        isDeleted
          ? "opacity-55 border-[#3a2d2d]"
          : "border-[#2c2b38] hover:border-accent/50",
      ].join(" ")}
      title={isDeleted ? `Deleted at: ${del}` : ""}
    >
      <UserAvatarMini media={user.avatar} serverUrl={serverUrl} />
      <div style={{ ...styles.meta, flex: 1 }}>
        <span style={styles.username}>
          {user.username || (user as any).Username || "(no username)"}
        </span>
        <span style={styles.id}>ID: {uid}</span>
        {isDeleted && <span style={styles.deletedBadge}>DELETED</span>}
        <div style={styles.activationRow}>
          <label style={styles.inlineToggleWrap} title="Toggle activation">
            <input
              type="checkbox"
              checked={isActive}
              disabled={busy || editing || isDeleted}
              onChange={() => onToggleActive(user)}
              style={{
                position: "absolute",
                opacity: 0,
                pointerEvents: "none",
              }}
              aria-label="Activated"
            />
            <span
              style={{
                ...styles.inlineToggle,
                background: isActive
                  ? "linear-gradient(120deg,#46a868,#389958)"
                  : "#3a3948",
              }}
            >
              <span
                style={{
                  ...styles.inlineKnob,
                  transform: isActive ? "translateX(17px)" : "translateX(2px)",
                }}
              />
            </span>
            <span style={styles.inlineToggleLabel}>
              {isActive ? "Activated" : "Deactivated"}
            </span>
          </label>

          <div className="flex flex-col gap-1 text-[0.55rem] pt-1">
            <span className="uppercase font-semibold tracking-wide text-[#cfcfe0] opacity-65 pl-0.5">
              Role
            </span>
            <RoleDropdown
              role={role}
              disabled={busy || editing || isDeleted}
              onChange={(r) => onChangeRole(user, r)}
            />
          </div>
        </div>
      </div>

      <div style={styles.actionCol}>
        <button
          type="button"
          onClick={() => onEdit(user)}
          style={styles.pencilBtn}
          aria-label="Edit user"
          disabled={editing || busy}
          title="Edit user"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20h9"
            />
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
            />
          </svg>
        </button>
        {!isDeleted && (
          <button
            type="button"
            onClick={() => onDelete(user)}
            style={deleteButtonStyle(busy)}
            aria-label="Delete user"
            disabled={busy || editing}
            title="Delete user"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 7h16M10 11v6M14 11v6M6 7l1 12c.1 1.1.9 2 2 2h6c1.1 0 1.9-.9 2-2l1-12M9 7V5c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2"
              />
            </svg>
          </button>
        )}
        {isDeleted && (
          <button
            type="button"
            onClick={() => onRecover(user)}
            style={recoverButtonStyle(busy)}
            aria-label="Recover user"
            disabled={busy || editing}
            title="Recover user"
          >
            <MaterialSymbolsRefreshRounded style={{ width: 16, height: 16 }} />
          </button>
        )}
        {busy && <div style={styles.busySpinner} aria-label="Working�" />}
      </div>
    </li>
  );
}

const styles: Record<string, React.CSSProperties> = {
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    background: "rgba(32,31,45,0.55)",
    border: "1px solid #2c2b38",
    borderRadius: 14,
    minHeight: 110,
    boxShadow: "0 2px 6px -2px rgba(0,0,0,.5)",
    backdropFilter: "blur(4px)",
  },
  meta: { display: "flex", flexDirection: "column", minWidth: 0 },
  username: {
    fontWeight: 600,
    fontSize: ".9rem",
    color: "#e5e5ef",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 140,
  },
  id: {
    fontSize: ".65rem",
    opacity: 0.55,
    marginTop: 2,
    letterSpacing: ".5px",
  },
  deletedBadge: {
    marginTop: 4,
    fontSize: ".55rem",
    fontWeight: 700,
    letterSpacing: ".7px",
    background: "linear-gradient(120deg,#5b2525,#7d3434)",
    color: "#ffe4e4",
    padding: "3px 8px 3px",
    borderRadius: 6,
    border: "1px solid #8a4747",
    display: "inline-flex",
    alignItems: "center",
    lineHeight: 1,
    whiteSpace: "nowrap",
    alignSelf: "flex-start",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.25), 0 2px 4px -2px rgba(0,0,0,0.5)",
  },
  activationRow: {
    marginTop: 8,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  inlineToggleWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    fontSize: ".55rem",
    userSelect: "none",
    background: "rgba(255,255,255,0.05)",
    padding: "4px 8px 4px 6px",
    borderRadius: 10,
    border: "1px solid #343348",
    position: "relative",
  },
  inlineToggle: {
    position: "relative",
    width: 32,
    height: 16,
    borderRadius: 20,
    display: "inline-block",
    transition: "background .25s ease",
  },
  inlineKnob: {
    position: "absolute",
    top: 2,
    width: 12,
    height: 12,
    background: "#fff",
    borderRadius: "50%",
    boxShadow: "0 2px 4px rgba(0,0,0,.4)",
    transition: "transform .25s cubic-bezier(.4,.2,.2,1)",
  },
  inlineToggleLabel: {
    fontWeight: 600,
    letterSpacing: ".6px",
    opacity: 0.8,
    textTransform: "uppercase",
  },
  actionCol: {
    position: "absolute",
    top: 6,
    right: 6,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
  pencilBtn: {
    width: 32,
    height: 32,
    borderRadius: 12,
    background: "rgba(255,255,255,0.07)",
    border: "1px solid #3a3948",
    color: "#d9d9e8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
  },
  busySpinner: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,.25)",
    borderTopColor: "#fff",
    animation: "spin .8s linear infinite",
    boxSizing: "border-box",
  },
};

const deleteButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 12,
  background: disabled
    ? "rgba(120,53,53,0.35)"
    : "linear-gradient(120deg,#643434,#7b3f3f)",
  border: "1px solid " + (disabled ? "#4c2b2b" : "#8d4a4a"),
  color: "#ffe4e4",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "default" : "pointer",
  padding: 0,
  fontSize: 0,
});

const recoverButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 12,
  background: disabled
    ? "rgba(53,81,53,0.35)"
    : "linear-gradient(120deg,#2f6d3d,#3c8a4e)",
  border: "1px solid " + (disabled ? "#2d4932" : "#4f9b60"),
  color: "#dbffe7",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: disabled ? "default" : "pointer",
  padding: 0,
  fontSize: 0,
});
