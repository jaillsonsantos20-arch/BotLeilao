-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('AVAILABLE', 'ON_AUCTION', 'SOLD');

-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "itemId" TEXT;

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "initialValue" DECIMAL(12,2) NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 120,
    "status" "ItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Item_tenantId_idx" ON "Item"("tenantId");

-- CreateIndex
CREATE INDEX "Item_tenantId_status_idx" ON "Item"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Auction_itemId_idx" ON "Auction"("itemId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
