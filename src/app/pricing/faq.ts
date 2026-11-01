import { PLANS } from "@/lib/plans";

// Ordered by what a visitor asks first; the first one opens by default.
export const FAQ: { id: string; q: string; a: string }[] = [
  {
    id: "free",
    q: "Is it free? What does the beta mean?",
    a: `${PLANS.free.name} is free for good: ${PLANS.free.repos} repos, ${PLANS.free.streams} streams and the whole product. Briff is in beta and billing has not opened yet, so nobody is charged. When it opens, Pro and Team start; your plan stays ${PLANS.free.name} until you choose to upgrade.`,
  },
  {
    id: "limits",
    q: "What happens when I reach a limit?",
    a: "Nothing is deleted and nothing stops working. New repos past the limit are refused: briff-scan reports the limit, the GitHub App leaves them unlinked and Repos says so. A new stream past the limit is refused the same way. Move to a larger plan or remove a repo, then rescan.",
  },
  {
    id: "repo",
    q: "What counts as a repo?",
    a: "Every repository your organisation has in Briff: one a GitHub App installation scans, or one a scanner (briff-scan, the GitHub Action) uploads. A monorepo uploaded as one repo is one. A repo counts whether or not it is in a stream; removing it on Repos frees its slot.",
  },
  {
    id: "cancel",
    q: "Can I cancel anytime?",
    a: "Yes. A cancelled plan runs to the end of the period you paid for, then the organisation moves to Free. Your repos, streams and bulletins stay.",
  },
  {
    id: "self-hosting",
    q: "Is self-hosting free?",
    a: "Yes, and unlimited. A self-hosted instance has no plans and no limits: one Docker image and Postgres, every feature, as many repos, streams and people as you like.",
  },
  {
    id: "invoices",
    q: "Who sends the invoices?",
    a: "Paddle, our payment partner. Paddle is the merchant of record: it takes the payment and sends the invoice and receipts.",
  },
  {
    id: "tax",
    q: "What about VAT and sales tax?",
    a: "Paddle handles them: it adds the VAT or sales tax that applies where you are, and lets a business enter its VAT number at checkout.",
  },
];
