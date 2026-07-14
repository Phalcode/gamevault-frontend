import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { GamevaultUserRoleEnum } from "../api";
import { Spinner } from "@/components/Spinner";

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

  if (bootstrapping) return <Spinner label="Loading…" />;
  if (!auth) return <Navigate to="/" replace />;

  if (requiredRole !== undefined) {
    const roleVal = Number(user?.role);
    if (Number.isNaN(roleVal) || roleVal < Number(requiredRole)) {
      return <Navigate to="/library" replace />;
    }
  }
  return children;
}
