import { PaymentBrandMark } from "@/components/ui/payment-brands";
import { Tag } from "@/components/ui/tag";
import {
  expiryLabel,
  isExpired,
  methodLabel,
  type PaymentMethodState,
} from "@/lib/billing/payment-method";

import { UpdatePaymentMethodButton } from "./_client";

/**
 * The saved payment method: brand mark, masked number, expiry and Update. Without
 * `payment_method.read` on the API key it says the method is managed in Paddle's portal.
 */
export function PaymentMethodRow({
  state,
  now,
  canUpdate,
}: {
  state: PaymentMethodState;
  now: Date;
  canUpdate: boolean;
}) {
  if (state.kind !== "known") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <PaymentBrandMark brand="other" />
          <p className="text-fg-muted text-[13.5px]">
            {state.kind === "unavailable"
              ? "Managed in the Paddle portal."
              : "No saved payment method yet."}
          </p>
        </div>
        {canUpdate && state.kind === "unavailable" && (
          <UpdatePaymentMethodButton label="Open portal" />
        )}
      </div>
    );
  }
  const m = state.method;
  const expiry = expiryLabel(m);
  const expired = isExpired(m, now);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <PaymentBrandMark brand={m.brand} />
        <div className="min-w-0">
          <p className="text-[14px] font-medium tabular-nums">{methodLabel(m)}</p>
          {(expiry || m.email) && (
            <p className="text-fg-muted flex flex-wrap items-center gap-2 text-[12.5px] tabular-nums">
              {expiry ?? m.email}
              {expired && <Tag kind="upgrade">Expired</Tag>}
            </p>
          )}
        </div>
      </div>
      {canUpdate && <UpdatePaymentMethodButton />}
    </div>
  );
}
