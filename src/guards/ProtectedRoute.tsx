import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { GamevaultUserRoleEnum } from "../api";

export default function ProtectedRoute({
  children,
  guarded,
  requiredRole,
}: {
  children: React.ReactElement;
  guarded: boolean;
  requiredRole?: GamevaultUserRoleEnum;
}) {
  const { auth, bootstrapping, user } = useAuth();

  if (!guarded) {
    // If guarding is disabled, just render children directly
    return children;
  }

  if (bootstrapping) return <div className="p-6 text-center">Loading…</div>;
  if (!auth) return <Navigate to="/" replace />;

  if (requiredRole !== undefined) {
    const roleVal = user.role;
    if (roleVal == null || roleVal < requiredRole) {
      return <Navigate to="/library" replace />;
    }
  }
  return children;
}
