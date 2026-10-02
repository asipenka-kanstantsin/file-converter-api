-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM ('avatar', 'transformation_result');

-- AlterEnum
ALTER TYPE "challenge_purpose" ADD VALUE 'email_change';

-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'blocked';

-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "new_email" VARCHAR(254);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "photo_file_id" UUID;

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "purpose" "file_purpose" NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "original_name" VARCHAR(255),
    "mime" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_key_key" ON "files"("key");

-- CreateIndex
CREATE INDEX "files_owner_id_idx" ON "files"("owner_id");

-- CreateIndex
CREATE INDEX "files_expires_at_idx" ON "files"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_photo_file_id_key" ON "users"("photo_file_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_photo_file_id_fkey" FOREIGN KEY ("photo_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
