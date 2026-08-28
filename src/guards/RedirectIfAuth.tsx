import { Navigate } from "react-router";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "@/components/Spinner";

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

  if (bootstrapping) return <Spinner label="Loading…" />;
  // If already authenticated, redirect to primary app entry (library)
  if (auth) return <Navigate to="/library" replace />;
  return children;
}
