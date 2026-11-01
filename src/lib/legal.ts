// Facts the legal pages (/terms, /privacy, /refunds, /dpa) state about the operator of the
// hosted service. Bracketed values are placeholders the founder fills in once; while any is
// left, `legal-placeholders.test.ts` fails unless LEGAL_PLACEHOLDERS_ALLOWED is set.

/** The operator's registered name (sole proprietorship in Türkiye). */
export const LEGAL_NAME = "Fikret Yunus Yıldız";
/** Registered business address, one line. */
export const ADDRESS = "Nilüfer, Bursa, Türkiye";
/** Tax or trade registry number. */
export const REGISTRATION_NO = "9610613060";
/** How long encrypted database backups exist before rotation removes them, e.g. "30 days". */
export const BACKUP_RETENTION = "6 months";
/** How long server logs are kept, e.g. "14 days". */
export const LOG_RETENTION = "30 days";

export const BRAND = "Metelabs";
export const SERVICE_HOST = "app.briff.dev";
export const SUPPORT_EMAIL = "support@briff.dev";
export const SECURITY_EMAIL = "security@briff.dev";

/** Shown on every legal page; change it with every material edit. */
export const LEGAL_LAST_UPDATED = "2026-11-01";

export const PADDLE_BUYER_TERMS_URL = "https://www.paddle.com/legal/checkout-buyer-terms";
export const PADDLE_HELP_URL = "https://paddle.net";
export const KVKK_AUTHORITY_URL = "https://www.kvkk.gov.tr";
export const EDPB_MEMBERS_URL = "https://www.edpb.europa.eu/about-edpb/about-edpb/members_en";

/** Placeholders like `[LEGAL_NAME]` in rendered text. */
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\]|\[[A-Z]{4,}\]/g;

export function placeholdersIn(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_PATTERN) ?? [])].sort();
}
