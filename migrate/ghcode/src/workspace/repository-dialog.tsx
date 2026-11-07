import { useEffect, useRef, useState } from "react";
import { LogIn, X } from "lucide-react";
import {
  beginGithubSignIn,
  getGithubAuthConfiguration,
  getGithubAuthResult,
  type GithubAuthResult,
} from "@/github/auth";
import { useWorkspace } from "./context";
import {
  exportOwnedWorkspaceSnapshot,
  importOwnedWorkspaceSnapshot,
  quarantineUnattributedLegacyRecords,
  type AuthorizedWorkspaceExport,
} from "./storage";
import { downloadText } from "./export";
import { documentService } from "./document-service";

export function RepositoryDialog() {
  const workspace = useWorkspace();
  const [input, setInput] = useState("");
  const [quarantineStatus, setQuarantineStatus] = useState<string | null>(null);
  const [quarantineBusy, setQuarantineBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<GithubAuthResult>(() => getGithubAuthResult());
  const authConfig = getGithubAuthConfiguration();

  useEffect(() => {
    if (!workspace.dialogOpen) {
      setInput("");
      setLocalError(null);
      setQuarantineStatus(null);
      return;
    }
    setAuthResult(getGithubAuthResult());
    const handleAuth = (event: Event) => {
      const detail = (event as CustomEvent<GithubAuthResult>).detail;
      setAuthResult(detail ?? getGithubAuthResult());
    };
    window.addEventListener("workbench-github-auth", handleAuth);
    return () => window.removeEventListener("workbench-github-auth", handleAuth);
  }, [workspace.dialogOpen]);

  if (!workspace.dialogOpen) return null;

  const open = async (value: string) => {
    setLocalError(null);
    try {
      await workspace.openRepository(value);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const signIn = async () => {
    setLocalError(null);
    try {
      await beginGithubSignIn();
      setAuthResult(getGithubAuthResult());
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const preserveLegacy = async () => {
    if (quarantineBusy) return;
    setQuarantineBusy(true);
    setQuarantineStatus(null);
    setLocalError(null);
    try {
      const result = await quarantineUnattributedLegacyRecords();
      setQuarantineStatus(
        `Preserved ${result.preservedRecords} unattributed records locally; ${result.existingBackups} previous backups unchanged. Originals were not removed or assigned to this account.`,
      );
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setQuarantineBusy(false);
    }
  };

  const exportOwnedBackup = async () => {
    const selected = workspace.workspace;
    if (!selected || backupBusy) return;
    setBackupBusy(true);
    setLocalError(null);
    try {
      documentService.assertSafeToNavigate();
      const data = await exportOwnedWorkspaceSnapshot(selected.id);
      if (data.workspace.repository.id !== selected.repository.id ||
          data.workspace.baseSha !== selected.baseSha ||
          data.workspace.ref !== selected.ref)
        throw new Error("Repository changed during local backup export.");
      downloadText(
        JSON.stringify({ schema: 1, data }, null, 2),
        `${selected.repository.name}-owned-local-workspace.json`,
        "application/json;charset=utf-8",
      );
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBackupBusy(false);
    }
  };

  const importOwnedBackup = async (file: File) => {
    if (backupBusy) return;
    setBackupBusy(true);
    setLocalError(null);
    try {
      if (!workspace.workspace) throw new Error("Open the original authorized repository before import.");
      if (file.size > 32_000_000) throw new Error("Local backup is too large.");
      documentService.assertSafeToNavigate();
      const candidate = JSON.parse(await file.text()) as {
        schema?: unknown;
        data?: AuthorizedWorkspaceExport;
      };
      if (candidate?.schema !== 1 || !candidate.data ||
          candidate.data.workspace?.id !== workspace.workspace.id)
        throw new Error("Backup must match the currently verified repository session.");
      await importOwnedWorkspaceSnapshot(candidate.data);
      // Recreate all React cache state from committed IDB. The same repository
      // is re-authorized on reload, and no other principal's data is imported.
      window.location.reload();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="workspace-dialog-backdrop" role="presentation">
      <section
        className="workspace-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Open GitHub repository"
      >
        <header>
          <div>
            <strong>Open GitHub Repository</strong>
            <span>Open a repository into a browser-local workspace.</span>
          </div>
          <button
            type="button"
            className="workbench-icon-button"
            onClick={() => workspace.setDialogOpen(false)}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>
        <form
          className="workspace-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void open(input);
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="owner/repository or https://github.com/owner/repository"
            aria-label="Repository"
          />
          <button type="submit" disabled={!input.trim() || workspace.loading}>
            Open
          </button>
        </form>
        {(localError || workspace.error) && (
          <div className="workspace-dialog-error">{localError || workspace.error}</div>
        )}
        <div className="workspace-auth-status status-warning" role="status">
          Historical unattributed v2 workspaces cannot be assigned to the currently signed-in
          account. The original browser data remains intact. Preserve an additional local
          transactional copy before any future manual recovery.
        </div>
        <button
          type="button"
          disabled={quarantineBusy}
          onClick={() => void preserveLegacy()}
        >
          {quarantineBusy ? "Preserving legacy data…" : "Preserve legacy browser data"}
        </button>
        {quarantineStatus && <div className="workspace-auth-status" role="status">{quarantineStatus}</div>}
        {workspace.workspace && (
          <section aria-label="Owned workspace backup">
            <p className="workspace-help">
              Export or restore this verified repository's local edits, staged changes and commits.
              Import never overwrites existing local work and cannot adopt another account's data.
            </p>
            <button type="button" disabled={backupBusy} onClick={() => void exportOwnedBackup()}>
              Export owned local backup
            </button>
            <button
              type="button"
              disabled={backupBusy}
              onClick={() => backupInput.current?.click()}
            >
              Import owned local backup
            </button>
            <input
              ref={backupInput}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Owned local workspace backup file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importOwnedBackup(file);
              }}
            />
          </section>
        )}
        {(workspace.authPhase === "failed" || workspace.authPhase === "invalidated") && (
          <button type="button" onClick={workspace.signOut}>
            Continue anonymously
          </button>
        )}
        <div className="workspace-dialog-sections">
          <section>
            <div className="workspace-dialog-section-title">Account</div>
            {workspace.user ? (
              <div className="workspace-account-row">
                <img src={workspace.user.avatar_url} alt="" />
                <span>{workspace.user.login}</span>
                <button type="button" onClick={workspace.signOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <div className="workspace-github-auth">
                <button
                  type="button"
                  className="workspace-github-auth-button"
                  disabled={workspace.loading || !authConfig.configured}
                  onClick={() => void signIn()}
                >
                  <LogIn size={15} />
                  <span>Sign in with GitHub</span>
                </button>
                <p className="workspace-help">
                  Continue on GitHub to authorize this workbench. The returned credential is kept
                  only in this browser session and is cleared on sign-out.
                </p>
                {!authConfig.configured && (
                  <div className="workspace-auth-status status-warning">
                    GitHub sign-in is not configured for this deployment. Public repositories remain
                    available anonymously.
                  </div>
                )}
                {authResult.phase !== "signed-out" && authResult.message && (
                  <div className={`workspace-auth-status status-${authResult.phase}`} role="status">
                    {authResult.message}
                  </div>
                )}
              </div>
            )}
          </section>
          {workspace.recent.length > 0 && (
            <section>
              <div className="workspace-dialog-section-title">Recent Workspaces</div>
              <div className="workspace-list">
                {workspace.recent.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      void workspace.openRepository(item.repository.fullName, item.ref)
                    }
                  >
                    <span>{item.repository.fullName}</span>
                    <small>{item.ref}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
          {workspace.repositories.length > 0 && (
            <section>
              <div className="workspace-dialog-section-title">Accessible Repositories</div>
              <div className="workspace-list">
                {workspace.repositories.slice(0, 100).map((repository) => (
                  <button
                    key={repository.id}
                    type="button"
                    onClick={() => void open(repository.full_name)}
                  >
                    <span>{repository.full_name}</span>
                    <small>{repository.private ? "Private" : "Public"}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
