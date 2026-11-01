-- CreateEnum
CREATE TYPE "OrgEventType" AS ENUM ('member.invited', 'invite.accepted', 'invite.revoked', 'member.removed', 'role.changed', 'org.renamed', 'org.created');

-- CreateTable
CREATE TABLE "org_invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "org_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_event" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "OrgEventType" NOT NULL,
    "targetEmail" TEXT,
    "targetUserId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_invite_tokenHash_key" ON "org_invite"("tokenHash");

-- CreateIndex
CREATE INDEX "org_invite_orgId_email_idx" ON "org_invite"("orgId", "email");

-- CreateIndex
CREATE INDEX "org_event_orgId_createdAt_idx" ON "org_event"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "org_invite" ADD CONSTRAINT "org_invite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_invite" ADD CONSTRAINT "org_invite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_event" ADD CONSTRAINT "org_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_event" ADD CONSTRAINT "org_event_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

