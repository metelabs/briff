"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Plug, X } from "lucide-react";
import { createContext, useCallback, useContext, useReducer, useRef, type ReactNode } from "react";

import { connectDataAction } from "@/app/onboarding/actions";
import { ConnectRepos, useScanStatus } from "@/app/onboarding/connect";
import type { ConnectData } from "@/app/onboarding/scan-status";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

import { connectSheetReducer, INITIAL_CONNECT_SHEET } from "./connect-sheet-state";

// Connect repos as a side sheet (Base UI dialog), reachable from the top bar and from
// Settings → Scan tokens once onboarding is over. Its data loads when it opens.

const ConnectSheetContext = createContext<(() => void) | null>(null);

const backdropClass =
  "bg-scrim fixed inset-0 z-70 transition-opacity duration-[180ms] ease-out data-ending-style:opacity-0 data-ending-style:duration-[120ms] data-starting-style:opacity-0";
const sheetClass =
  "bg-bg border-line shadow-raised fixed inset-y-0 right-0 z-70 flex w-full max-w-[620px] flex-col border-l outline-none transition-[opacity,translate] duration-[220ms] ease-out data-ending-style:translate-x-6 data-ending-style:opacity-0 data-ending-style:duration-[140ms] data-starting-style:translate-x-6 data-starting-style:opacity-0 min-[620px]:rounded-l-[16px]";

export function ConnectSheetProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(connectSheetReducer, INITIAL_CONNECT_SHEET);
  const nextRound = useRef(0);

  const show = useCallback(() => {
    nextRound.current += 1;
    const round = nextRound.current;
    dispatch({ type: "open" });
    connectDataAction().then(
      (data) => dispatch({ type: "loaded", round, data }),
      () => dispatch({ type: "failed", round })
    );
  }, []);
  const { open, round, data, failed } = state;
  return (
    <ConnectSheetContext.Provider value={show}>
      {children}
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) dispatch({ type: "close" });
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={backdropClass} />
          <Dialog.Popup className={sheetClass}>
            <div className="border-line flex items-start gap-3 border-b px-5 pt-5 pb-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="type-h2 mb-1">Connect repos</Dialog.Title>
                <Dialog.Description className="text-fg-muted text-[13.5px]">
                  The scanner sends package names, versions and runtimes; never your code.
                </Dialog.Description>
              </div>
              <Dialog.Close
                render={
                  <Button variant="ghost" size="icon" aria-label="Close">
                    <X aria-hidden className="size-4" />
                  </Button>
                }
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-8">
              {data ? (
                <SheetBody key={round} data={data} onNavigate={() => dispatch({ type: "close" })} />
              ) : failed ? (
                <p role="status" className="text-upgrade text-[13.5px]">
                  Could not load the connect steps. Close the sheet and try again.
                </p>
              ) : (
                <div aria-hidden className="bg-surface-2 rounded-card h-[420px]" />
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </ConnectSheetContext.Provider>
  );
}

function SheetBody({ data, onNavigate }: { data: ConnectData; onNavigate: () => void }) {
  const status = useScanStatus(data.status);
  return (
    <ConnectRepos
      stream={data.stream}
      apiUrl={data.apiUrl}
      status={status}
      initialTokens={data.tokens}
      github={data.github}
      onNavigate={onNavigate}
    />
  );
}

export function useConnectSheet(): () => void {
  const open = useContext(ConnectSheetContext);
  if (!open) throw new Error("useConnectSheet outside ConnectSheetProvider");
  return open;
}

/** Top bar trigger: a labelled button on wide screens, an icon button below 1100px. */
export function ConnectReposBarButton() {
  const open = useConnectSheet();
  return (
    <>
      <Button
        variant="secondary"
        onClick={open}
        className="hidden rounded-full min-[1100px]:inline-flex"
      >
        <Plug aria-hidden className="size-4" />
        Connect repos
      </Button>
      <Tooltip content="Connect repos" describe={false}>
        <Button
          variant="secondary"
          size="icon"
          onClick={open}
          aria-label="Connect repos"
          className="rounded-full min-[1100px]:hidden"
        >
          <Plug aria-hidden className="size-4" />
        </Button>
      </Tooltip>
    </>
  );
}

/** Opens the sheet from a page (Settings → Scan tokens, empty states). */
export function ConnectReposButton({
  variant = "primary",
  className,
  children = "Connect repos",
}: {
  variant?: "primary" | "secondary" | "link";
  className?: string;
  children?: ReactNode;
}) {
  const open = useConnectSheet();
  return (
    <Button variant={variant} onClick={open} className={className}>
      {children}
    </Button>
  );
}
