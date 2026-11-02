import type { ReactNode } from "react";

import type { PaymentBrand } from "@/lib/billing/payment-method";
import { cn } from "@/lib/utils";

// Small inline marks for the saved payment method (billing page, Settings -> Billing): a
// 38x24 card-shaped badge per brand, drawn with plain shapes and text so no logo file ships.
// Unknown brands get a monochrome card outline in the theme's colours.

const W = 38;
const H = 24;

function Frame({ fill, stroke, children }: { fill: string; stroke?: string; children: ReactNode }) {
  return (
    <>
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={H - 1}
        rx="4"
        fill={fill}
        stroke={stroke ?? "none"}
      />
      {children}
    </>
  );
}

const WORD = {
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontWeight: 700,
} as const;

function Mark({ brand }: { brand: PaymentBrand }) {
  switch (brand) {
    case "visa":
      return (
        <Frame fill="#ffffff" stroke="#d6dce1">
          <text
            x="19"
            y="16"
            textAnchor="middle"
            fontSize="10.5"
            fontStyle="italic"
            fill="#1a1f71"
            {...WORD}
          >
            VISA
          </text>
        </Frame>
      );
    case "mastercard":
      return (
        <Frame fill="#ffffff" stroke="#d6dce1">
          <circle cx="15.5" cy="12" r="6.5" fill="#eb001b" />
          <circle cx="22.5" cy="12" r="6.5" fill="#f79e1b" />
          <path d="M19 6.5a6.5 6.5 0 0 1 0 11a6.5 6.5 0 0 1 0-11z" fill="#ff5f00" />
        </Frame>
      );
    case "american_express":
      return (
        <Frame fill="#016fd0">
          <text x="19" y="15.5" textAnchor="middle" fontSize="8.5" fill="#ffffff" {...WORD}>
            AMEX
          </text>
        </Frame>
      );
    case "paypal":
      return (
        <Frame fill="#ffffff" stroke="#d6dce1">
          <text x="19" y="15.5" textAnchor="middle" fontSize="8.5" {...WORD}>
            <tspan fill="#003087">Pay</tspan>
            <tspan fill="#009cde">Pal</tspan>
          </text>
        </Frame>
      );
    case "apple_pay":
      return (
        <Frame fill="#000000">
          <path
            d="M10.6 9.1c.5-.6.8-1.4.7-2.1-.7 0-1.5.5-2 1-.4.5-.8 1.3-.7 2.1.8.1 1.5-.4 2-1zm.7 1.1c-1.1-.1-2 .6-2.5.6s-1.3-.6-2.1-.6c-1.1 0-2.1.6-2.7 1.6-1.1 2-.3 4.9.8 6.5.5.8 1.2 1.6 2 1.6.8 0 1.1-.5 2.1-.5s1.2.5 2.1.5c.9 0 1.4-.8 1.9-1.6.6-.9.9-1.8.9-1.8s-1.7-.7-1.7-2.6c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.2-1.3z"
            fill="#ffffff"
            transform="translate(2 -1.2) scale(0.95)"
          />
          <text x="25.5" y="16" textAnchor="middle" fontSize="9" fill="#ffffff" {...WORD}>
            Pay
          </text>
        </Frame>
      );
    case "google_pay":
      return (
        <Frame fill="#ffffff" stroke="#d6dce1">
          <text x="12" y="16" textAnchor="middle" fontSize="10" {...WORD}>
            <tspan fill="#4285f4">G</tspan>
          </text>
          <text x="24.5" y="16" textAnchor="middle" fontSize="9" fill="#3c4043" {...WORD}>
            Pay
          </text>
        </Frame>
      );
    default:
      return (
        <g className="text-fg-muted">
          <rect
            x="0.5"
            y="0.5"
            width={W - 1}
            height={H - 1}
            rx="4"
            fill="none"
            stroke="currentColor"
          />
          <rect x="1" y="6" width={W - 2} height="3.5" fill="currentColor" opacity="0.6" />
          <rect x="5" y="15" width="10" height="2" rx="1" fill="currentColor" opacity="0.6" />
        </g>
      );
  }
}

const LABEL: Record<PaymentBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  american_express: "American Express",
  paypal: "PayPal",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  other: "Payment card",
};

export function PaymentBrandMark({
  brand,
  className,
}: {
  brand: PaymentBrand;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={LABEL[brand]}
      className={cn("shrink-0", className)}
    >
      <Mark brand={brand} />
    </svg>
  );
}
