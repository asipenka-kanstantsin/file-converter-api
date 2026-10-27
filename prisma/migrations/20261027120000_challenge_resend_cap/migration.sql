-- AlterTable
-- Resends so far: each one clears `attempts`, so the number of resends bounds how many codes a
-- challenge can be guessed against. Pending rows start at 0 — they keep the resends they had.
ALTER TABLE "challenges" ADD COLUMN "rotations" SMALLINT NOT NULL DEFAULT 0;
