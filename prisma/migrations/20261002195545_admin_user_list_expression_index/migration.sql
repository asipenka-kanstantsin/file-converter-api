-- An operator-class index on a plain column is reported as drift by Prisma forever; as an
-- expression index (Prisma does not diff those) it is stable. E-mails are stored lowercased, so
-- the list searches `lower(email)` (decision L1).
DROP INDEX "users_email_pattern_idx";
CREATE INDEX "users_email_lower_pattern_idx" ON "users" (lower("email") text_pattern_ops);
