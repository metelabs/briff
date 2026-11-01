import { PRIVACY_URL } from "@/components/landing/links";
import {
  ADDRESS,
  BACKUP_RETENTION,
  BRAND,
  EDPB_MEMBERS_URL,
  KVKK_AUTHORITY_URL,
  LEGAL_NAME,
  LOG_RETENTION,
  REGISTRATION_NO,
  SERVICE_HOST,
  SUPPORT_EMAIL,
} from "@/lib/legal";

import { A, LegalTable, type LegalDoc } from "./legal-page";
import { PUBLIC_SOURCES, SUBPROCESSORS } from "./subprocessors";

const mail = <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>;

export const PRIVACY: LegalDoc = {
  path: "/privacy",
  title: "Privacy Policy",
  lead: (
    <p>
      What the hosted Briff service at {SERVICE_HOST} collects, why, who else processes it and how
      to get it exported or deleted. Written for the EU General Data Protection Regulation (GDPR)
      and Türkiye&apos;s Personal Data Protection Law No. 6698 (KVKK).
    </p>
  ),
  sections: [
    {
      id: "controller",
      title: "Who is responsible",
      body: (
        <>
          <p>
            The data controller is {LEGAL_NAME} (trading as {BRAND}), a sole proprietorship in
            Türkiye, registration {REGISTRATION_NO}, {ADDRESS}. Contact for anything in this policy:{" "}
            {mail}.
          </p>
          <p>
            A self-hosted Briff instance is run by its operator, who is the controller for it; it
            sends us nothing.
          </p>
        </>
      ),
    },
    {
      id: "collect",
      title: "What we collect",
      body: (
        <ul>
          <li>
            <b>Account:</b> your name, email address, an optional separate delivery address and a
            password hash (never the password itself).
          </li>
          <li>
            <b>Organisation:</b> its name, members and roles, streams, the interest profile text and
            your feedback on bulletin items.
          </li>
          <li>
            <b>Repository metadata:</b> repo names and, per repo, the packages and versions from
            lockfiles and manifests, runtime versions from version files, Dockerfiles and compose
            files, and GitHub Actions references. No source code and no file contents are stored.
          </li>
          <li>
            <b>GitHub App, if you connect it:</b> the installation id and the GitHub account login
            and type it belongs to.
          </li>
          <li>
            <b>Scan tokens:</b> a hash and an 8-character prefix; the secret is shown to you once
            and not stored.
          </li>
          <li>
            <b>Usage and technical data:</b> for each sign-in session, the IP address and browser
            user agent; server logs of requests, jobs and errors, which carry account and
            organisation ids but not passwords or tokens. Sign-in and sign-up attempts are counted
            per IP address in memory for an hour to stop abuse; that count is not stored.
          </li>
          <li>
            <b>Derived data:</b> matches between your repos and public releases or advisories,
            alerts, bulletins and the emails sent about them.
          </li>
          <li>
            <b>Payments:</b> we never see card or bank details. Once paid plans open, Paddle handles
            checkout and tells us the plan, the subscription status and its own customer id.
          </li>
        </ul>
      ),
    },
    {
      id: "why",
      title: "Why, and on what legal basis",
      body: (
        <LegalTable
          head={["Purpose", "Data", "Legal basis"]}
          rows={[
            [
              "Running Briff: scanning, matching, bulletins, alerts, account emails",
              "Account, organisation, repository metadata, GitHub App",
              "Contract (GDPR art. 6(1)(b); KVKK art. 5(2)(c))",
            ],
            [
              "Security, abuse prevention and fixing errors",
              "Sessions, server logs, attempt counts",
              "Legitimate interest in a safe service (GDPR art. 6(1)(f); KVKK art. 5(2)(f))",
            ],
            [
              "Billing records",
              "Plan and subscription status from Paddle",
              "Contract and legal obligation (GDPR art. 6(1)(b), (c); KVKK art. 5(2)(ç))",
            ],
          ]}
        />
      ),
    },
    {
      id: "llm",
      title: "Language model processing",
      body: (
        <>
          <p>
            Briff uses Anthropic&apos;s API to sort public release notes and to write the weekly
            bulletin. Those requests carry public item text (release notes, advisories), package
            names and versions, your interest profile text and repo aliases such as{" "}
            <code>repo-1</code>. Repo names are replaced by these aliases on our server before a
            request is sent and mapped back after; organisation names, emails, user names and tokens
            are never sent. Our test suite fails if any of them reaches a request.
          </p>
          <p>
            Package names and versions are sent as they are, because they are what Briff reports on.
            If that is too much for a repo, leave it out of every stream. The exact fields are
            listed in <A href={PRIVACY_URL}>docs/PRIVACY.md</A>.
          </p>
        </>
      ),
    },
    {
      id: "subprocessors",
      title: "Who processes it for us",
      body: (
        <>
          <LegalTable
            head={["Company", "Purpose", "Data", "Location"]}
            rows={SUBPROCESSORS.map((s) => [s.name, s.purpose, s.data, s.location])}
          />
          <p>
            Briff also queries {PUBLIC_SOURCES}. These requests carry public package or product
            names only, nothing about you.
          </p>
          <p>
            Transfers outside the EEA and Türkiye (Anthropic and GitHub in the United States, Paddle
            in the United Kingdom, Cloudflare) rely on the provider&apos;s standard contractual
            clauses or an adequacy decision, and are made under KVKK article 9.
          </p>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long we keep it",
      body: (
        <ul>
          <li>Account and organisation data: until you delete the organisation.</li>
          <li>
            Deleting an organisation removes it and everything that belongs to it from the database
            at once: members, repos, versions, alerts, bulletins, feedback, scan tokens and GitHub
            App links. Your account goes too when you belong to no other organisation.
          </li>
          <li>
            Encrypted database backups rotate out within {BACKUP_RETENTION}, so deleted data is gone
            from them by then.
          </li>
          <li>Server logs: {LOG_RETENTION}.</li>
          <li>
            Sessions end when you sign out or after about a week without use, and are deleted with
            your account.
          </li>
          <li>
            Shared public data (packages, releases, advisories) is not yours and stays. Invoices are
            kept by Paddle for as long as tax law requires.
          </li>
        </ul>
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      body: (
        <>
          <p>
            Under the GDPR and KVKK article 11 you can ask what we hold about you, get it corrected
            or deleted, receive a copy, object to or restrict processing, and complain. Most of it
            you can do yourself:
          </p>
          <ul>
            <li>
              <b>Export:</b> Settings → Your data → Export downloads your organisation&apos;s data
              as one JSON file (without password hashes, sessions or token secrets).
            </li>
            <li>
              <b>Correct:</b> Settings → Account changes your email address, Settings → Delivery the
              address bulletins go to; for your name, write to us.
            </li>
            <li>
              <b>Delete:</b> an owner deletes the organisation in Settings → Your data after typing
              its name. If you are not an owner, or want only your account removed, write to us.
            </li>
          </ul>
          <p>
            For anything else, email {mail}. We answer within 30 days. You can also complain to the
            Turkish Personal Data Protection Authority (<A href={KVKK_AUTHORITY_URL}>kvkk.gov.tr</A>
            ) or to the <A href={EDPB_MEMBERS_URL}>data protection authority of your EU country</A>.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies",
      body: (
        <>
          <p>
            Briff uses no analytics, advertising or third-party cookies, and no tracking pixels of
            its own. The public pages set no cookies. Signed in, there are at most three:
          </p>
          <LegalTable
            head={["Cookie", "What for", "How long"]}
            rows={[
              [
                <code key="c">__Secure-better-auth.session_token</code>,
                "Keeps you signed in",
                "About a week without use, or until you sign out",
              ],
              [<code key="c">briff-theme</code>, "The theme you picked", "One year"],
              [<code key="c">briff-stream</code>, "The stream you picked", "One year"],
            ]}
          />
          <p>All three are needed for features you use, so there is no consent banner.</p>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      body: (
        <p>
          Briff is a tool for software developers and is not meant for anyone under 16. We do not
          knowingly collect data from children; if you think we have, write to us and we delete it.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes",
      body: (
        <p>
          When this policy changes in a way that matters, we email account owners at least 30 days
          before it takes effect and update the date at the top.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          {LEGAL_NAME}, {ADDRESS}. Email {mail}.
        </p>
      ),
    },
  ],
};
