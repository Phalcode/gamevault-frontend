// Role label helper (non-generated)
// Maps backend numeric roles to human-readable labels.
export const ROLE_LABELS: Record<number, string> = {
  0: "Guest",
  1: "User",
  2: "Editor",
  3: "Admin",
};

export function getRoleLabel(role: number | null | undefined): string {
  if (role === null || role === undefined) return "";
  return ROLE_LABELS[Number(role)] ?? String(role);
}
