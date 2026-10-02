-- CreateEnum
CREATE TYPE "transformation_type" AS ENUM ('file', 'image');

-- CreateEnum
CREATE TYPE "transformation_status" AS ENUM ('success', 'error');

-- CreateTable
CREATE TABLE "transformations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "transformation_type" NOT NULL,
    "source_format" VARCHAR(10),
    "target_format" VARCHAR(10) NOT NULL,
    "status" "transformation_status" NOT NULL,
    "file_size" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "error_code" VARCHAR(64),
    "result_file_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transformations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transformations_result_file_id_key" ON "transformations"("result_file_id");

-- CreateIndex
CREATE INDEX "transformations_user_id_created_at_id_idx" ON "transformations"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "transformations_user_id_type_created_at_id_idx" ON "transformations"("user_id", "type", "created_at", "id");

-- CreateIndex
CREATE INDEX "transformations_user_id_status_created_at_id_idx" ON "transformations"("user_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "transformations_expires_at_idx" ON "transformations"("expires_at");

-- AddForeignKey
ALTER TABLE "transformations" ADD CONSTRAINT "transformations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformations" ADD CONSTRAINT "transformations_result_file_id_fkey" FOREIGN KEY ("result_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
