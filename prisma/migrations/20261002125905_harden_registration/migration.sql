/*
  Warnings:

  - You are about to drop the column `payload` on the `challenges` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "challenges" DROP COLUMN "payload";

-- E-mails are stored trimmed and lower-cased by the application; the database enforces it so the
-- unique index is effectively case-insensitive (hand-written).
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
