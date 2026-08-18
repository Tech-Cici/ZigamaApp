-- CreateEnum
CREATE TYPE "MovementDirection" AS ENUM ('DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "MovementChannel" AS ENUM ('BRANCH_CASH', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'REVERSAL_CREDIT';
ALTER TYPE "TransactionType" ADD VALUE 'REVERSAL_DEBIT';

-- CreateTable
CREATE TABLE "MoneyRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "channel" "MovementChannel" NOT NULL,
    "status" "MovementStatus" NOT NULL DEFAULT 'PENDING',
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "accountId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "slipReference" TEXT,
    "branchName" TEXT,
    "depositedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "transactionId" TEXT,
    "reversalTransactionId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRequest_reference_key" ON "MoneyRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRequest_slipReference_key" ON "MoneyRequest"("slipReference");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRequest_transactionId_key" ON "MoneyRequest"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRequest_reversalTransactionId_key" ON "MoneyRequest"("reversalTransactionId");

-- CreateIndex
CREATE INDEX "MoneyRequest_status_createdAt_idx" ON "MoneyRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyRequest_accountId_createdAt_idx" ON "MoneyRequest"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyRequest_requestedById_idx" ON "MoneyRequest"("requestedById");

-- AddForeignKey
ALTER TABLE "MoneyRequest" ADD CONSTRAINT "MoneyRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRequest" ADD CONSTRAINT "MoneyRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRequest" ADD CONSTRAINT "MoneyRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRequest" ADD CONSTRAINT "MoneyRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRequest" ADD CONSTRAINT "MoneyRequest_reversalTransactionId_fkey" FOREIGN KEY ("reversalTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
