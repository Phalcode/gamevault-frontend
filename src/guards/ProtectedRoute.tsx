import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({
  children,
  guarded,
}: {
  children: React.ReactElement;
  guarded: boolean;
}) {
  const { auth, bootstrapping } = useAuth();

  if (!guarded) {
    // If guarding is disabled, just render children directly
    return children;
  }

  if (bootstrapping) return <div className="p-6 text-center">Loading…</div>;
  if (!auth) return <Navigate to="/" replace />;
  return children;
}
