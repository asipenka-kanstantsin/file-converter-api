-- AlterEnum
ALTER TYPE "challenge_purpose" ADD VALUE 'login';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMPTZ(3);
