import type { OrgCapacity } from "@/lib/org-capacity";

export function OrgCapacityNotice({ capacity }: { capacity: OrgCapacity }) {
  return (
    <aside
      aria-label="Organisation limits"
      className="bg-surface border-line rounded-card mb-5 border p-4 text-[13.5px]"
    >
      <h2 className="mb-1 font-medium">Organisation limits</h2>
      <p>
        {capacity.repos} / {capacity.repoLimit} repositories · {capacity.streams} /{" "}
        {capacity.streamLimit} streams
      </p>
      <p className="text-fg-muted mt-1">
        Ask the instance admin to raise your organisation&apos;s limits if you need more room.
      </p>
    </aside>
  );
}
