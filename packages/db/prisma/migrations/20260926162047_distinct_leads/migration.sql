-- AlterTable
ALTER TABLE "TestResult" ADD COLUMN     "contactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "problem" TEXT;
