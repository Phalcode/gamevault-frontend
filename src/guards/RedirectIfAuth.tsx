import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";

export default function RedirectIfAuth({
  children,
  guarded,
}: {
  children: React.ReactElement;
  guarded: boolean;
}) {
  const { auth, bootstrapping } = useAuth();

  if (!guarded) {
    return children;
  }

  if (bootstrapping) return <div className="p-6 text-center">Loading…</div>;
  if (auth) return <Navigate to="/admin" replace />;
  return children;
}
