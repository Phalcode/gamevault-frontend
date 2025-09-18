import { Dialog, DialogBody, DialogTitle } from "@/components/tailwind/dialog";
import { Label } from "@headlessui/react";
import { Button } from "@tw/button";
import { useRef, useState } from "react";
import { useAlertDialog } from "../../context/AlertDialogContext";
import { useAuth } from "../../context/AuthContext";
import { Field } from "../tailwind/fieldset";
import { Input } from "../tailwind/input";

interface BackupRestoreDialogProps {
  onClose: () => void;
}

type TabKey = "backup" | "restore";

const Backup = () => {
  const { serverUrl, authFetch } = useAuth();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlertDialog();

  const startBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password)
      return showAlert({
        title: "No password entered",
        description: "Please enter the database password.",
        affirmativeText: "OK",
      });

    setLoading(true);
    try {
      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const response = await authFetch(`${base}/api/admin/database/backup`, {
        method: "GET",
        headers: {
          "X-Database-Password": password,
        },
      });

      if (!response.ok) {
        throw (
          new Error(((await response.json()) as any).message) ||
          "Backup failed for unknown reason."
        );
      }

      // Get filename from Content-Disposition header or default
      const disposition = response.headers.get("Content-Disposition");
      let filename = "backup.db";
      if (disposition) {
        const match = disposition.match(/filename="?(.+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blob = await response.blob();

      // Trigger file download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      showAlert({
        title: "Backup failed",
        description: error.message,
        affirmativeText: "OK",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={startBackup}>
      <p>
        Create and download a Database Backup. This process will generate an
        unencrypted file containing all the data currently stored in the
        database, which can be restored at a later time.
      </p>
      <Field>
        <Label>Database Password</Label>
        <Input
          type="password"
          name="Database Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={loading || !password.length}>
        {loading ? "Backing Up..." : "Start Backup"}
      </Button>
    </form>
  );
};

const Restore = () => {
  const { serverUrl, authFetch } = useAuth();
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const { showAlert } = useAlertDialog();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRestore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file)
      return showAlert({
        title: "No file selected",
        description: "Please select a backup file.",
        affirmativeText: "OK",
      });
    if (!password)
      return showAlert({
        title: "No password entered",
        description: "Please enter the database password.",
        affirmativeText: "OK",
      });

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);

      if (!serverUrl) return null;
      const base = serverUrl.replace(/\/+$/, "");
      const response = await authFetch(`${base}/api/admin/database/restore`, {
        method: "POST",
        headers: {
          "X-Database-Password": password,
        },
        body: formData,
      });

      if (!response.ok) {
        throw (
          new Error(((await response.json()) as any).message) ||
          "Restore failed for unknown reason."
        );
      }

      return showAlert({
        title: "Database restored successfully",
        affirmativeText: "OK",
      });
    } catch (error: any) {
      showAlert({
        title: "Restore failed",
        description: error.message,
        affirmativeText: "OK",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={startRestore}>
      <p>
        Restoring your database from a file will completely replace your
        existing database. It is strongly discouraged to restore a database from
        another version and it is not possible to restore databases from
        different database systems.
      </p>
      <Field>
        <Label>Backup File</Label>
        <Input
          type="file"
          name="Backup File"
          required
          onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)}
          ref={fileInputRef}
        />
      </Field>
      <Field>
        <Label>Database Password</Label>
        <Input
          type="password"
          name="Database Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={loading || !password.length}>
        {loading ? "Restoring..." : "Start Restore"}
      </Button>
    </form>
  );
};

export function BackupRestoreDialog({ onClose }: BackupRestoreDialogProps) {
  const [tab, setTab] = useState<TabKey>("backup");

  return (
    <Dialog open onClose={onClose} size="3xl">
      <DialogTitle className="flex items-center justify-between gap-4 pb-1">
        <span>Backup & Restore Database</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300/40 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
          aria-label="Close"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            stroke="currentColor"
            fill="none"
          >
            <path strokeWidth="2" strokeLinecap="round" d="M6 6 18 18" />
            <path strokeWidth="2" strokeLinecap="round" d="M18 6 6 18" />
          </svg>
        </button>
      </DialogTitle>
      <div className="px-6 mt-1 flex gap-2 border-b border-zinc-200 dark:border-zinc-700 text-sm">
        <button
          onClick={() => setTab("backup")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (tab === "backup"
              ? "border-indigo-500 text-indigo-500"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200")
          }
        >
          Backup
        </button>
        <button
          onClick={() => setTab("restore")}
          className={
            "px-3 py-2 border-b-2 transition-colors " +
            (tab === "restore"
              ? "border-indigo-500 text-indigo-500"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200")
          }
        >
          Restore
        </button>
      </div>
      <DialogBody className="pt-4 max-h-[70vh] overflow-y-auto min-h-[200px]">
        {tab === "backup" ? <Backup /> : <Restore />}
      </DialogBody>
    </Dialog>
  );
}

export default BackupRestoreDialog;
