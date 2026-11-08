import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { liveProfileDirectory, type ProfileDirectory } from "./persistence/live-profiles";
import { useProfiles } from "./profiles";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/**
 * The single canonical authority for Canvas profiles, notes and scratch
 * drafts. React is not mounted against default profiles until C01 has checked
 * the original raw backup and restored the latest durable directory.
 *
 * Zustand is an in-memory editing projection only, never another writer.
 * Edits are synchronous for Monaco but remain unacknowledged until the C01
 * transaction completes. Closing the browser while dirty asks for approval.
 */
export default function ProfilePersistenceGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const latestOperation = useRef(0);
  const unacknowledged = useRef(false);
  const mounted = useRef(false);

  const persist = useCallback((next: ProfileDirectory) => {
    const operation = ++latestOperation.current;
    unacknowledged.current = true;
    if (mounted.current) {
      setSaving(true);
      setSaveError(null);
    }
    void Promise.resolve()
      .then(() => liveProfileDirectory.save(next))
      .then(() => {
        if (!mounted.current || latestOperation.current !== operation) return;
        unacknowledged.current = false;
        setSaving(false);
        setSaveError(null);
      })
      .catch((cause: unknown) => {
        if (!mounted.current || latestOperation.current !== operation) return;
        // Keep the latest in-memory snapshot and fail closed. Retry must
        // acknowledge its real IndexedDB write before clearing the warning.
        unacknowledged.current = true;
        setSaving(false);
        setSaveError(message(cause));
      });
  }, []);

  useEffect(() => {
    // A recovery retry deliberately re-runs the verified C01 hydration.
    void retryEpoch;
    mounted.current = true;
    let disposed = false;
    let detach = () => {};
    setReady(false);
    setLoadError(null);
    void liveProfileDirectory
      .load()
      .then((directory) => {
        if (disposed) return;
        if (directory)
          useProfiles.setState({ profiles: directory.profiles, currentId: directory.currentId });
        // Subscribe only after the entire verified durable snapshot was
        // hydrated. Default startup state must never race with migration.
        detach = useProfiles.subscribe((next) => {
          persist({ profiles: next.profiles, currentId: next.currentId });
        });
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (!disposed) setLoadError(message(cause));
      });
    return () => {
      disposed = true;
      mounted.current = false;
      detach();
    };
  }, [persist, retryEpoch]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!unacknowledged.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, []);

  if (!ready) {
    return (
      <div className="profiles-storage-gate" role={loadError ? "alert" : "status"}>
        <strong>
          {loadError
            ? "Saved profiles could not be recovered"
            : "Loading saved workspace profiles…"}
        </strong>
        {loadError && (
          <>
            <p>{loadError}</p>
            <p>
              Original local data is preserved. The workspace will not load defaults over an
              unverified profile directory.
            </p>
            <button type="button" onClick={() => setRetryEpoch((value) => value + 1)}>
              Retry recovery
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {children}
      {saveError && (
        <div className="profiles-storage-error" role="alert">
          <strong>Profile or scratch changes were not saved</strong>
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => {
              const current = useProfiles.getState();
              persist({ profiles: current.profiles, currentId: current.currentId });
            }}
          >
            Retry durable save
          </button>
        </div>
      )}
      {saving && !saveError && (
        <span className="profiles-storage-saving" role="status">
          Saving local changes…
        </span>
      )}
    </>
  );
}
