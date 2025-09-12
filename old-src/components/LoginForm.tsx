import { useState, FormEvent } from "react";
import { useAuth } from "../context/AuthContext";

export function LoginForm() {
  const { loading, error, loginBasic, auth, user } = useAuth();
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (auth) {
    return (
      <div className="mt-4 text-[0.9rem] text-text-dim tracking-wide">
        Logged in{user?.username ? ` as ${user.username}` : ""}.
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await loginBasic({ server, username, password });
    } catch {
      /* handled */
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex justify-center w-full px-2 sm:px-4"
    >
      <div
        className="relative w-full max-w-[1480px] overflow-hidden rounded-[18px] border border-[#2c2b38] hover:border-accent/50 transition-colors
        bg-[linear-gradient(148deg,rgba(27,26,39,0.9),rgba(34,33,48,0.92))] p-10 xl:p-16
        shadow-[0_10px_40px_-12px_rgba(0,0,0,0.6),0_6px_26px_-10px_rgba(0,0,0,0.55)] backdrop-blur-md
        before:content-[''] before:absolute before:w-[560px] before:h-[560px] before:rounded-full before:opacity-40 before:blur-xl before:top-[-260px] before:right-[-220px] before:pointer-events-none before:bg-[radial-gradient(circle_at_center,rgba(100,89,223,0.25),transparent_70%)]
        after:content-[''] after:absolute after:w-[640px] after:h-[640px] after:rounded-full after:opacity-30 after:blur-2xl after:bottom-[-300px] after:left-[-260px] after:pointer-events-none after:bg-[radial-gradient(circle_at_center,rgba(100,89,223,0.2),transparent_75%)]"
      >
        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h2 className="m-0 mb-3 text-[2.1rem] leading-none font-semibold tracking-wide flex items-center gap-3">
              <span className="inline-block w-2 h-2 rounded-full bg-accent shadow-[0_0_0_4px_rgba(100,89,223,0.4)]" />
              Sign In
            </h2>
            <p className="uppercase text-[0.7rem] md:text-[0.75rem] tracking-[.35em] text-text-dim mb-4 md:mb-0">
              Enter your credentials to continue
            </p>
          </div>
        </div>

        <div className="relative z-10 mt-8 grid gap-7 md:gap-8 xl:gap-10 mb-8 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          <div className="flex flex-col gap-2.5">
            <label
              htmlFor="server"
              className="text-[0.65rem] font-semibold tracking-wider uppercase text-text-dim pl-0.5"
            >
              Server URL
            </label>
            <input
              id="server"
              type="text"
              placeholder="https://example.com"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              required
              inputMode="url"
              className="peer appearance-none bg-[linear-gradient(145deg,#1f1e2c,#1b1a25)] border border-[#2f2e3d] hover:border-[#3d3c4e] focus:border-accent focus:shadow-[0_0_0_3px_rgba(100,89,223,0.35)] rounded-[14px] px-5 py-4 text-[1.05rem] leading-snug tracking-wide text-text placeholder:text-[#6d6c80] placeholder:tracking-wide transition outline-none"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <label
              htmlFor="username"
              className="text-[0.65rem] font-semibold tracking-wider uppercase text-text-dim pl-0.5"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              placeholder="your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="peer appearance-none bg-[linear-gradient(145deg,#1f1e2c,#1b1a25)] border border-[#2f2e3d] hover:border-[#3d3c4e] focus:border-accent focus:shadow-[0_0_0_3px_rgba(100,89,223,0.35)] rounded-[14px] px-5 py-4 text-[1.05rem] leading-snug tracking-wide text-text placeholder:text-[#6d6c80] placeholder:tracking-wide transition outline-none"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <label
              htmlFor="password"
              className="text-[0.65rem] font-semibold tracking-wider uppercase text-text-dim pl-0.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="peer appearance-none bg-[linear-gradient(145deg,#1f1e2c,#1b1a25)] border border-[#2f2e3d] hover:border-[#3d3c4e] focus:border-accent focus:shadow-[0_0_0_3px_rgba(100,89,223,0.35)] rounded-[14px] px-5 py-4 text-[1.05rem] leading-snug tracking-wide text-text placeholder:text-[#6d6c80] placeholder:tracking-wide transition outline-none"
            />
          </div>
        </div>

        {error && (
          <div
            className="relative z-10 mt-1 mb-5 p-4 rounded-[14px] text-[0.8rem] leading-snug tracking-wide bg-[linear-gradient(140deg,#3f1e25,#331a20)] border border-[#5d2c36] text-[#ffb5c4] shadow-[inset_0_0_0_1px_#402027,0_4px_18px_-10px_rgba(255,107,150,0.25)] animate-fade-in-scale"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="relative z-10 mt-2">
          <button
            type="submit"
            disabled={loading || !server || !username || !password}
            className="group relative inline-flex w-full justify-center items-center gap-2 rounded-[16px] px-10 py-5 text-[1.05rem] font-semibold tracking-wide text-white
            bg-[linear-gradient(92deg,#5c53d8,#7269ff)] border border-[#6d63f0]
            shadow-[0_14px_42px_-14px_rgba(0,0,0,0.6),0_8px_26px_-10px_rgba(0,0,0,0.55)]
            hover:translate-y-[-3px] hover:shadow-[0_18px_54px_-18px_rgba(100,89,223,0.6),0_10px_30px_-12px_rgba(0,0,0,0.55)]
            active:translate-y-0 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(100,89,223,0.4),0_12px_40px_-18px_rgba(100,89,223,0.6)]
            disabled:opacity-55 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-[0_6px_20px_-14px_rgba(0,0,0,0.55)] transition"
          >
            <span className="pointer-events-none absolute inset-0 rounded-[16px] opacity-45 mix-blend-overlay bg-[linear-gradient(120deg,rgba(255,255,255,0.2),rgba(255,255,255,0))] group-hover:opacity-55 transition" />
            <span className="relative font-semibold tracking-wide">
              {loading ? "Authenticating…" : "Login"}
            </span>
          </button>
        </div>
      </div>
    </form>
  );
}
