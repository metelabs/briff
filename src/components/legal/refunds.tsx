import { PADDLE_BUYER_TERMS_URL, PADDLE_HELP_URL, SUPPORT_EMAIL } from "@/lib/legal";

import { A, type LegalDoc } from "./legal-page";

export const REFUNDS: LegalDoc = {
  path: "/refunds",
  title: "Refund Policy",
  lead: (
    <p>
      Paid Briff plans are sold by Paddle.com, our merchant of record, so refunds are paid out by
      Paddle to the method you paid with.
    </p>
  ),
  sections: [
    {
      id: "first-payment",
      title: "14 days on your first payment",
      body: (
        <p>
          If Briff is not right for you, ask within 14 days of your first payment for a plan and you
          get the full amount back, no questions asked. The subscription then ends and the
          organisation returns to the Free plan; nothing is deleted.
        </p>
      ),
    },
    {
      id: "renewals",
      title: "Renewals and other payments",
      body: (
        <p>
          Renewals, upgrades and other later payments are refunded under Paddle&apos;s{" "}
          <A href={PADDLE_BUYER_TERMS_URL}>buyer terms</A>, including any right of withdrawal your
          consumer law gives you. If something went wrong on our side (a double charge, an outage
          that made Briff unusable), write to us and we sort it out.
        </p>
      ),
    },
    {
      id: "how",
      title: "How to ask",
      body: (
        <ul>
          <li>
            Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A> with the email address on
            the invoice, or
          </li>
          <li>
            find the order at <A href={PADDLE_HELP_URL}>paddle.net</A> with the receipt Paddle
            emailed you and ask there.
          </li>
        </ul>
      ),
    },
    {
      id: "cancel",
      title: "Cancelling",
      body: (
        <p>
          You can cancel at any time. Cancelling stops the next renewal; the plan stays active until
          the end of the period you paid for and is not refunded pro rata unless the law requires
          it.
        </p>
      ),
    },
  ],
};
