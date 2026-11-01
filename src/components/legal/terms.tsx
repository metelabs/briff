import { SOURCE_URL } from "@/components/landing/links";
import {
  ADDRESS,
  BRAND,
  LEGAL_NAME,
  PADDLE_BUYER_TERMS_URL,
  REGISTRATION_NO,
  SERVICE_HOST,
  SUPPORT_EMAIL,
} from "@/lib/legal";

import { A, type LegalDoc } from "./legal-page";

export const TERMS: LegalDoc = {
  path: "/terms",
  title: "Terms of Service",
  lead: (
    <p>
      These terms are the agreement between you and {BRAND} for the hosted Briff service at{" "}
      {SERVICE_HOST}. They are short on purpose. If something is unclear, write to{" "}
      <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.
    </p>
  ),
  sections: [
    {
      id: "who",
      title: "Who we are",
      body: (
        <p>
          Briff is run by {LEGAL_NAME} (trading as {BRAND}), a sole proprietorship registered in
          Türkiye under {REGISTRATION_NO}, {ADDRESS}. &ldquo;We&rdquo; and &ldquo;us&rdquo; mean{" "}
          {BRAND}; &ldquo;you&rdquo; means the person who creates the account.
        </p>
      ),
    },
    {
      id: "service",
      title: "The service",
      body: (
        <>
          <p>
            Briff reads the dependency and runtime versions of the repositories you connect (through
            the GitHub App or the briff-scan command line tool), and sends you a weekly bulletin of
            what changed in them plus a same-day email when a security fix lands for something you
            run. It reads lockfiles, manifests and version files only, never your source code.
          </p>
          <p>
            Briff is a tool to help you notice changes. It does not guarantee that it finds every
            advisory or release, and its suggestions (fix commands, upgrade targets) are for you to
            check before you apply them.
          </p>
        </>
      ),
    },
    {
      id: "accounts",
      title: "Accounts",
      body: (
        <ul>
          <li>An account is for one person. Do not share sign-in details.</li>
          <li>
            Teams work through an organisation: its owners invite the other people, and each of them
            signs in with their own account.
          </li>
          <li>
            You are responsible for what happens under your account and for keeping your password
            and scan tokens secret. Tell us at once if you think someone else has access.
          </li>
          <li>You must be at least 16 years old and able to agree to these terms.</li>
        </ul>
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: (
        <>
          <p>Do not:</p>
          <ul>
            <li>connect repositories you have no right to read;</li>
            <li>
              try to reach another organisation&apos;s data, probe the service for vulnerabilities
              outside the <A href={`${SOURCE_URL}/blob/main/SECURITY.md`}>security policy</A>, or
              bypass limits;
            </li>
            <li>
              send uploads or requests at a volume that degrades the service for others, or automate
              sign-ups;
            </li>
            <li>use Briff to break the law or anyone&apos;s rights.</li>
          </ul>
          <p>We may limit or suspend an account that does, and tell you why.</p>
        </>
      ),
    },
    {
      id: "billing",
      title: "Plans and billing",
      body: (
        <>
          <p>
            Briff has a Free plan and paid plans (Pro and Team); the current prices and limits are
            on the <A href="/pricing">pricing page</A>. During the beta every account is on the Free
            plan; paid plans start when billing opens, and your plan stays Free until you choose to
            upgrade.
          </p>
          <p>
            Paid plans are sold by our reseller Paddle.com, which is the merchant of record: Paddle
            takes the payment, charges VAT or sales tax where it applies and issues the invoice,
            under its <A href={PADDLE_BUYER_TERMS_URL}>buyer terms</A>. Subscriptions are billed
            monthly or yearly in advance and renew automatically until cancelled.
          </p>
          <p>
            You can cancel at any time. The plan stays active until the end of the period you paid
            for, then the organisation moves to the Free plan. Downgrading deletes nothing: your
            repos, streams and bulletins stay. While you are over a Free limit you cannot add more
            until you remove some or upgrade again.
          </p>
          <p>
            We may change prices for future periods. We tell you by email at least 30 days before a
            new price applies to your subscription, and you can cancel before it does.
          </p>
        </>
      ),
    },
    {
      id: "refunds",
      title: "Refunds",
      body: (
        <p>
          If you are not happy with a first subscription payment, ask for a refund within 14 days of
          it and you get the full amount back. Other refunds follow Paddle&apos;s buyer terms. The
          details and how to ask are on the <A href="/refunds">refund policy</A> page.
        </p>
      ),
    },
    {
      id: "availability",
      title: "Availability and support",
      body: (
        <>
          <p>
            We run Briff with care but without a service-level agreement on the Free and Pro plans:
            it is offered on a best-effort basis and may be interrupted for maintenance or by
            failures. Team plans get priority support.
          </p>
          <p>
            Support is by email at <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>; we aim
            to answer within two business days. The current state of the service is at{" "}
            <A href="/api/health">/api/health</A>.
          </p>
        </>
      ),
    },
    {
      id: "data",
      title: "Your data",
      body: (
        <>
          <p>
            What you upload stays yours. You give us the right to store and process it only to run
            Briff for you. The <A href="/privacy">privacy policy</A> says what we collect, who
            processes it and for how long; the <A href="/dpa">data processing summary</A> covers
            data about your team that you put into Briff.
          </p>
          <p>
            You can export your organisation&apos;s data as JSON, and delete it, at any time from
            Settings → Your data.
          </p>
        </>
      ),
    },
    {
      id: "self-host",
      title: "Self-hosting",
      body: (
        <p>
          Briff&apos;s source code is published under the GNU Affero General Public License v3 (the
          briff-scan tool under the MIT licence). If you run your own instance, that licence applies
          instead of these terms: the software comes without warranty, and we are not involved in
          running it or in the data it holds.
        </p>
      ),
    },
    {
      id: "termination",
      title: "Ending the agreement",
      body: (
        <>
          <p>
            You can stop at any time by deleting your organisation in Settings → Your data, which
            also deletes your account when you belong to no other organisation.
          </p>
          <p>
            We may end or suspend your access if you seriously or repeatedly break these terms, or
            if the law requires it. Unless the reason is abuse or a legal order, we give you 30 days
            of notice by email so you can export your data. If we stop offering Briff altogether, we
            give at least 30 days of notice and refund any prepaid period you could not use.
          </p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Liability",
      body: (
        <>
          <p>
            Briff is provided &ldquo;as is&rdquo;. To the extent the law allows, we are not liable
            for indirect or consequential losses (lost profits, lost data you did not export,
            business interruption), or for harm from an advisory or release Briff missed or reported
            late.
          </p>
          <p>
            Our total liability for any claim is limited to the fees you paid us in the 12 months
            before it arose (zero on the Free plan). Nothing here limits liability that cannot be
            limited by law, such as for intent or gross negligence, or your rights as a consumer.
          </p>
        </>
      ),
    },
    {
      id: "law",
      title: "Governing law",
      body: (
        <p>
          These terms are governed by the laws of the Republic of Türkiye. Courts in Türkiye have
          jurisdiction, unless consumer law gives you the right to go to the courts where you live.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: (
        <p>
          If we change these terms in a way that matters to you, we email account owners at least 30
          days before the change takes effect and update the date at the top. Using Briff after that
          date means you accept the new terms; if you do not, you can delete your organisation
          before then.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          {LEGAL_NAME}, {ADDRESS}. Email <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>.
        </p>
      ),
    },
  ],
};
