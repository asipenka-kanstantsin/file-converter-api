-- CreateIndex
CREATE INDEX "users_created_at_id_idx" ON "users"("created_at", "id");

-- Hand-written (Prisma cannot express expression or operator-class indexes): the admin list's
-- prefix search on e-mail and display name, and its last-login sort (decision L1).
CREATE INDEX "users_email_pattern_idx" ON "users" ("email" text_pattern_ops);
CREATE INDEX "users_display_name_lower_pattern_idx" ON "users" (lower("display_name") text_pattern_ops);
CREATE INDEX "users_last_login_sort_idx" ON "users" ((COALESCE("last_login_at", '-infinity'::timestamptz)), "id");
