import { create } from "zustand";
import { isCanvasView, type CanvasView } from "./views";

export type Profile = {
  id: string;
  name: string;
  route: string;
  pinned: CanvasView[];
  note: string;
  selectedDocument: string;
  drafts: Record<string, string>;
};
const initialProfiles: Profile[] = ["Global", "Study", "Health", "Code", "Design", "Finance"].map(
  (name) => ({
    id: name.toLowerCase(),
    name,
    route: "/",
    pinned: [],
    note: "",
    selectedDocument: "",
    drafts: {},
  }),
);
type State = {
  profiles: Profile[];
  currentId: string;
  select: (id: string) => void;
  createProfile: (name: string) => string | null;
  renameProfile: (id: string, name: string) => void;
  removeProfile: (id: string) => void;
  setRoute: (path: string) => void;
  togglePin: (view: CanvasView) => void;
  setNote: (text: string) => void;
  setMonacoPath: (path: string) => void;
  setDraft: (path: string, content: string | null) => void;
};
// The C01 profile authority is mounted and hydrated by ProfilePersistenceGate.
// This in-memory Zustand projection is NEVER a second localStorage writer.
export const useProfiles = create<State>()((set, get) => ({
      profiles: initialProfiles,
      currentId: "global",
      select: (id) => {
        if (get().profiles.some((profile) => profile.id === id)) set({ currentId: id });
      },
      createProfile: (value) => {
        const name = value.trim().slice(0, 48);
        if (!name || get().profiles.length >= 50) return null;
        const id = crypto.randomUUID();
        set((state) => ({
          profiles: [
            ...state.profiles,
            { id, name, route: "/", pinned: [], note: "", selectedDocument: "", drafts: {} },
          ],
          currentId: id,
        }));
        return id;
      },
      renameProfile: (id, value) => {
        const name = value.trim().slice(0, 48);
        if (name)
          set((state) => ({
            profiles: state.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
          }));
      },
      removeProfile: (id) => {
        if (!get().profiles.some((p) => p.id === id) || get().profiles.length <= 1) return;
        set((state) => {
          const profiles = state.profiles.filter((p) => p.id !== id);
          return { profiles, currentId: state.currentId === id ? profiles[0].id : state.currentId };
        });
        // Historical v2 layout bytes are migration evidence, not disposable
        // cache. CAN-C01 retains them unchanged after the verified IDB cutover;
        // deleting a profile cannot destroy its original recovery material.
      },
      setRoute: (route) =>
        set((state) => ({
          profiles: state.profiles.map((p) => (p.id === state.currentId ? { ...p, route } : p)),
        })),
      togglePin: (view) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id !== state.currentId
              ? p
              : {
                  ...p,
                  pinned: p.pinned.includes(view)
                    ? p.pinned.filter((x) => x !== view)
                    : [...p.pinned, view],
                },
          ),
        })),
      setMonacoPath: (selectedDocument) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === state.currentId ? { ...p, selectedDocument } : p,
          ),
        })),
      setDraft: (path, content) => {
        if (!path || path.length > 300) return;
        set((state) => ({
          profiles: state.profiles.map((p) => {
            if (p.id !== state.currentId) return p;
            const drafts = { ...p.drafts };
            if (content === null) delete drafts[path];
            else drafts[path] = content;
            return { ...p, drafts };
          }),
        }));
      },
      setNote: (note) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === state.currentId ? { ...p, note: note.slice(0, 100000) } : p,
          ),
        })),
}));
