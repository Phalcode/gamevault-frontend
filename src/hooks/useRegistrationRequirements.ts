import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

interface ServerInfo {
  status?: string;
  version?: string;
  registration_enabled?: boolean;
  required_registration_fields?: string[];
  available_authentication_methods?: string[];
}

interface RegistrationRequirements {
  loading: boolean;
  error: string | null;
  required: Set<string>;
  registrationEnabled: boolean | null; // null while unknown
  isMandatory: (field: string) => boolean;
}

export function useRegistrationRequirements(serverOverride?: string): RegistrationRequirements {
  const { serverUrl } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [registrationEnabled, setRegistrationEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const chosen = (serverOverride ?? serverUrl) || "";
      if (!chosen.trim()) { // nothing to fetch yet
        setLoading(false);
        setError(null);
        setRequired(new Set());
        setRegistrationEnabled(null);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        // Ensure protocol; default to https if missing.
        let base = chosen.trim();
        if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
        base = base.replace(/\/+$/, '');
        const res = await fetch(`${base}/api/status`, { method: 'GET' });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const info: ServerInfo = await res.json();
        if (!cancelled) setRegistrationEnabled(info.registration_enabled ?? true);
        const fields = new Set(info.required_registration_fields || info.required_registration_fields || []);
        fields.add('username');
        fields.add('password');
        if (!cancelled) setRequired(fields);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load server status');
        if (!cancelled) setRegistrationEnabled(true); // optimistic default
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [serverUrl, serverOverride]);

  const isMandatory = (field: string) => required.has(field);

  return { loading, error, required, registrationEnabled, isMandatory };
}
