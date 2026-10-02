-- AlterEnum
ALTER TYPE "challenge_purpose" ADD VALUE 'account_deletion';

-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'deleted';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3);
