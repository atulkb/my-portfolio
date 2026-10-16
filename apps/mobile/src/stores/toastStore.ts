import { createStore, type StoreApi } from 'zustand/vanilla';

/** A toast button (e.g. Undo, Review). */
export type ToastAction = { readonly label: string; readonly onPress: () => void };

/** One toast with optional action buttons. */
export type Toast = {
  readonly id: number;
  readonly message: string;
  readonly actions: readonly ToastAction[];
  /** Auto-dismiss after this many ms (LLD §4.4: Undo stays 10 s). */
  readonly durationMs: number;
};

/** Toast queue state: only the newest toast is shown. */
export type ToastState = {
  readonly current: Toast | null;
  show(message: string, opts?: { actions?: readonly ToastAction[]; durationMs?: number }): void;
  dismiss(id?: number): void;
};

let nextId = 1;

/** Creates the toast store. */
export function createToastStore(): StoreApi<ToastState> {
  return createStore<ToastState>()((set, get) => ({
    current: null,
    show: (message, opts = {}) =>
      set({
        current: {
          id: nextId++,
          message,
          actions: opts.actions ?? [],
          durationMs: opts.durationMs ?? 4000,
        },
      }),
    dismiss: (id) => {
      if (id === undefined || get().current?.id === id) set({ current: null });
    },
  }));
}
