import {
  ADDRESS,
  BACKUP_RETENTION,
  BRAND,
  LEGAL_NAME,
  REGISTRATION_NO,
  SUPPORT_EMAIL,
} from "@/lib/legal";

import { A, LegalTable, type LegalDoc } from "./legal-page";
import { SUBPROCESSORS } from "./subprocessors";

const mail = <A href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</A>;

export const DPA: LegalDoc = {
  path: "/dpa",
  title: "Data Processing Summary",
  lead: (
    <p>
      When your organisation puts data about its people into Briff (members&apos; names and email
      addresses, repo names), you are the controller and we process it for you. This page summarises
      the terms of that processing. For a signed data processing agreement, email {mail}.
    </p>
  ),
  sections: [
    {
      id: "parties",
      title: "Parties and roles",
      body: (
        <p>
          Processor: {LEGAL_NAME} (trading as {BRAND}), registration {REGISTRATION_NO}, {ADDRESS}.
          Controller: the customer whose organisation holds the data. For account data we use for
          our own purposes (billing, security), we are a controller under the{" "}
          <A href="/privacy">privacy policy</A>.
        </p>
      ),
    },
    {
      id: "scope",
      title: "What is processed",
      body: (
        <ul>
          <li>
            <b>Data subjects:</b> the organisation&apos;s members and anyone named in repo names.
          </li>
          <li>
            <b>Data:</b> names, email addresses, repo names, dependency and runtime metadata,
            feedback and the interest profile text. No special categories of data.
          </li>
          <li>
            <b>Purpose:</b> providing Briff: scans, matching, bulletins, security alerts and the
            emails about them, only on your instructions as expressed by using the service.
          </li>
          <li>
            <b>Duration:</b> as long as the organisation exists.
          </li>
        </ul>
      ),
    },
    {
      id: "security",
      title: "Security measures",
      body: (
        <ul>
          <li>Traffic to the service is encrypted with TLS.</li>
          <li>
            Every query for organisation data goes through one tenant layer that pins the query to
            the signed-in organisation and refuses one that names another.
          </li>
          <li>Passwords are stored as hashes; scan tokens as SHA-256 hashes.</li>
          <li>
            Repo names, organisation names and personal data are kept out of language model requests
            (repo names are replaced by aliases).
          </li>
          <li>Backups are encrypted before they leave the server.</li>
          <li>Access to production systems is limited to the founder.</li>
        </ul>
      ),
    },
    {
      id: "subprocessors",
      title: "Sub-processors",
      body: (
        <>
          <p>
            You authorise the sub-processors below. We tell you by email at least 30 days before we
            add or replace one, so you can object.
          </p>
          <LegalTable
            head={["Company", "Purpose", "Location"]}
            rows={SUBPROCESSORS.map((s) => [s.name, s.purpose, s.location])}
          />
        </>
      ),
    },
    {
      id: "breach",
      title: "Breaches, help and audits",
      body: (
        <ul>
          <li>
            We notify you without undue delay, and within 72 hours, after we become aware of a
            breach affecting your data.
          </li>
          <li>
            We help you answer data subject requests; export and deletion are self-service in
            Settings → Your data.
          </li>
          <li>We answer reasonable questions about our measures and share evidence on request.</li>
        </ul>
      ),
    },
    {
      id: "end",
      title: "End of processing",
      body: (
        <p>
          Deleting the organisation removes its data from the database at once; encrypted backups
          rotate out within {BACKUP_RETENTION}. Export your data first if you want to keep a copy.
        </p>
      ),
    },
  ],
};
