import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/AuthContext";
import {
  loadArchivePasswords,
  normalizeArchivePasswords,
  saveArchivePasswords,
  type ArchivePasswordScope,
} from "@/utils/archivePasswords";

interface ArchivePasswordsContextValue {
  /** Saved passwords, in the order they should be tried. */
  passwords: string[];
  /** True while the list for the current server/account is being loaded. */
  loading: boolean;
  addPassword: (password: string) => Promise<void>;
  removePassword: (password: string) => Promise<void>;
  setPasswords: (passwords: string[]) => Promise<void>;
}

const ArchivePasswordsContext =
  createContext<ArchivePasswordsContextValue | null>(null);

export function ArchivePasswordsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { serverUrl, user } = useAuth();
  const scope: ArchivePasswordScope = useMemo(
    () => ({ serverUrl, userId: user?.id ?? null }),
    [serverUrl, user?.id],
  );
  const scopeKey = `${serverUrl}\u0000${user?.id ?? ""}`;
  const [passwords, setPasswordState] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // Writes must always target the scope that is current *at call time*; the
  // callbacks below are stable so the extraction flow does not re-render on
  // every user/server change.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const passwordsRef = useRef(passwords);
  passwordsRef.current = passwords;

  useEffect(() => {
    let cancelled = false;
    setPasswordState([]);
    if (!scopeKey || !scope.serverUrl || scope.userId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadArchivePasswords(scope)
      .then((stored) => {
        if (!cancelled) setPasswordState(stored);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const persist = useCallback(async (next: readonly string[]) => {
    const normalized = normalizeArchivePasswords(next);
    setPasswordState(normalized);
    try {
      await saveArchivePasswords(scopeRef.current, normalized);
    } catch (error) {
      console.error("[archivePasswords] failed to save:", error);
    }
  }, []);

  const addPassword = useCallback(
    async (password: string) => {
      const trimmed = password.trim();
      if (!trimmed) return;
      if (passwordsRef.current.includes(trimmed)) return;
      await persist([...passwordsRef.current, trimmed]);
    },
    [persist],
  );

  const removePassword = useCallback(
    async (password: string) => {
      await persist(passwordsRef.current.filter((entry) => entry !== password));
    },
    [persist],
  );

  const setPasswords = useCallback(
    async (next: string[]) => {
      await persist(next);
    },
    [persist],
  );

  return (
    <ArchivePasswordsContext.Provider
      value={{ passwords, loading, addPassword, removePassword, setPasswords }}
    >
      {children}
    </ArchivePasswordsContext.Provider>
  );
}

export function useArchivePasswords() {
  const ctx = useContext(ArchivePasswordsContext);
  if (!ctx) {
    throw new Error(
      "useArchivePasswords must be used within ArchivePasswordsProvider",
    );
  }
  return ctx;
}
