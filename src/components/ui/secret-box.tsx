"use client";

import { CopyButton } from "./command-box";

/** A just-created secret, shown whole (it wraps) with Copy, and the warning that it is shown once. */
export function SecretBox({
  secret,
  note = "Copy it now. Briff keeps only a hash of it, so it will not be shown again.",
}: {
  secret: string;
  note?: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="bg-code border-line flex min-w-0 items-center gap-2 rounded-[9px] border py-1.5 pr-1.5 pl-3">
        <code className="min-w-0 flex-1 font-mono text-[13px] break-all">{secret}</code>
        <CopyButton text={secret} />
      </div>
      <p role="note" className="bg-upgrade-soft text-upgrade rounded-[10px] px-3 py-2 text-[13px]">
        {note}
      </p>
    </div>
  );
}
