-- One-off data migration, no schema change. Email verification starts with this release
-- and bulletins and alerts stop for accounts unverified for more than 7 days
-- (src/lib/email/delivery-rule.ts). Accounts created before it were never sent a
-- verification email, so they count as verified instead of losing delivery.
UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false;
