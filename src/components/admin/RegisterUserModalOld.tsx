import { useAuth } from "@/context/AuthContext";
import { User } from "@/types/api";
import { useState } from "react";
import { useRegistrationRequirements } from "@/hooks/useRegistrationRequirements";

interface Props {
  onClose: () => void;
  onRegistered: (u: User) => void;
  requiredFields?: Set<string>;
}

export function RegisterUserModalOld({
  onClose,
  onRegistered,
  requiredFields,
}: Props) {
  const { serverUrl, authFetch } = useAuth();
  const { loading: reqLoading, error: reqError, required } = useRegistrationRequirements();
  const [form, setForm] = useState({
    username: "",
    birth_date: "",
    email: "",
    first_name: "",
    last_name: "",
    password: "",
    repeat_password: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onInput: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    setMsg(null);
  };

  const isRequired = (field: string) => {
    if (field === "username") return true; // always mandatory
    if (field === "password" || field === "repeat_password") return true; // password repeat always required
    // Prefer explicit prop if provided; else use dynamically loaded requirements (which already include username/password)
    const source = requiredFields ?? required;
    return source.has(field);
  };

  const canSubmit = () => {
    const basic = [
      "username",
      "email",
      "first_name",
      "last_name",
      "birth_date",
    ];
    for (const f of basic) {
      if (isRequired(f) && !(form as any)[f]?.toString().trim()) return false;
    }
    if (!form.password || form.password !== form.repeat_password) return false;
    return true;
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit() || submitting) return;
    if (!serverUrl) {
      setMsg("Missing server URL");
      return;
    }
    setSubmitting(true);
    setMsg(null);
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const payload: any = {
        Username: form.username.trim(),
        Password: form.password,
        EMail: form.email.trim(),
        FirstName: form.first_name.trim(),
        LastName: form.last_name.trim(),
        BirthDate: form.birth_date || null,
        username: form.username.trim(),
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        birth_date: form.birth_date || null,
        password: form.password,
      };
      const res = await authFetch(`${base}/api/auth/basic/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(
          `Register failed (${res.status}): ${txt || res.statusText}`,
        );
      }
      const created: User = await res.json();
      const activatedRaw: any =
        (created as any).activated ?? (created as any).Activated;
      const activated =
        activatedRaw === true ||
        activatedRaw === "activated" ||
        activatedRaw === 1;
      onRegistered({ ...created, activated });
      setMsg("User registered successfully");
      setTimeout(() => onClose(), 800);
    } catch (e: any) {
      setMsg(e?.message || "Registration error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div
        style={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-user-title"
      >
        <div style={styles.header}>
          <h3
            id="register-user-title"
            style={{ margin: 0, fontSize: "1.05rem", letterSpacing: ".5px" }}
          >
            Registrate new User
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={styles.closeBtn}
            disabled={submitting}
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              stroke="currentColor"
              fill="none"
            >
              <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
              <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} style={styles.formGrid}>
          {[
            { name: "username", label: "Username", type: "text" },
            { name: "birth_date", label: "Birth date", type: "date" },
            { name: "email", label: "Email", type: "email" },
            { name: "first_name", label: "First name", type: "text" },
            { name: "last_name", label: "Last name", type: "text" },
            { name: "password", label: "Password", type: "password" },
            {
              name: "repeat_password",
              label: "Repeat password",
              type: "password",
            },
          ].map((f) => (
            <div key={f.name} style={styles.fieldCell}>
              <label style={styles.label}>
                <span style={styles.labelText}>
                  {f.label}
                  {isRequired(f.name) && (
                    <span style={{ color: "#ff8181", marginLeft: 4 }}>*</span>
                  )}
                </span>
                <input
                  name={f.name}
                  type={f.type}
                  value={(form as any)[f.name]}
                  onChange={onInput}
                  style={styles.input}
                  autoComplete={
                    f.name.includes("password") ? "new-password" : "off"
                  }
                />
              </label>
            </div>
          ))}
          <div style={styles.formFooterRow}>
            <div style={{ flex: 1 }}>
              {reqLoading && (
                <div style={{ fontSize: ".6rem", color: "#c7c6d8" }}>
                  Loading requirements…
                </div>
              )}
              {reqError && !reqLoading && (
                <div style={{ fontSize: ".6rem", color: "#ffb3b3" }}>
                  Failed to load requirements, using defaults.
                </div>
              )}
              {msg && (
                <div
                  style={{
                    fontSize: ".65rem",
                    color: msg.startsWith("User registered")
                      ? "#6fe39e"
                      : "#ffb3b3",
                  }}
                >
                  {msg}
                </div>
              )}
              {form.password &&
                form.repeat_password &&
                form.password !== form.repeat_password && (
                  <div
                    style={{
                      fontSize: ".6rem",
                      color: "#ffb3b3",
                      marginTop: 4,
                    }}
                  >
                    Passwords do not match
                  </div>
                )}
              {!msg && !canSubmit() && (
                <div
                  style={{ fontSize: ".58rem", color: "#c7c6d8", marginTop: 6 }}
                >
                  Fill required fields ( * ) and matching passwords.
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!canSubmit() || submitting || reqLoading}
              style={saveButtonStyle(!canSubmit() || submitting)}
            >
              {submitting ? "Registering…" : "Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10,10,18,0.65)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "4vh 3vw",
    zIndex: 410,
  },
  modal: {
    width: "760px",
    maxWidth: "96vw",
    background: "linear-gradient(155deg,#2b2a3c,#1c1b28)",
    border: "1px solid #38384a",
    borderRadius: 24,
    boxShadow:
      "0 10px 48px -12px rgba(0,0,0,.75), 0 2px 6px -2px rgba(0,0,0,.6)",
    padding: "28px 34px 32px",
    position: "relative",
    color: "#e8e8f4",
    display: "flex",
    flexDirection: "column",
    maxHeight: "88vh",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  closeBtn: {
    background: "linear-gradient(140deg,#3a3950,#343348)",
    border: "1px solid #4a4960",
    color: "#d8d8e6",
    width: 40,
    height: 40,
    borderRadius: 14,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
    gap: "26px 42px",
    alignItems: "start",
  },
  fieldCell: { display: "flex", flexDirection: "column" },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    fontSize: ".62rem",
    letterSpacing: ".55px",
    fontWeight: 600,
    color: "#bfbfd3",
  },
  labelText: { paddingLeft: 2, textTransform: "uppercase", opacity: 0.9 },
  input: {
    background: "linear-gradient(120deg,#1f1e2a,#232231)",
    border: "1px solid #3f4054",
    borderRadius: 14,
    padding: "12px 14px",
    color: "#ececf6",
    fontSize: ".78rem",
    outline: "none",
    width: "100%",
    lineHeight: 1.25,
    boxSizing: "border-box",
  },
  formFooterRow: {
    gridColumn: "1 / -1",
    marginTop: 4,
    display: "flex",
    alignItems: "center",
    gap: 16,
    paddingTop: 6,
  },
};

const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({
  background: disabled
    ? "linear-gradient(120deg,#404058,#3a3a50)"
    : "linear-gradient(120deg,#5c53d8,#786fff)",
  border: "1px solid " + (disabled ? "#4a4a62" : "#7a72ff"),
  color: disabled ? "#9b9ab0" : "#fff",
  fontSize: ".74rem",
  letterSpacing: ".85px",
  fontWeight: 600,
  padding: "13px 30px",
  borderRadius: 16,
  cursor: disabled ? "default" : "pointer",
  minWidth: 140,
});
