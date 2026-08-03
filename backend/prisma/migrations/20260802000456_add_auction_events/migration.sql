-- CreateEnum
CREATE TYPE "AuctionEventStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Auction" ADD COLUMN     "auctionEventId" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "auctionEventId" TEXT;

-- CreateTable
CREATE TABLE "AuctionEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "AuctionEventStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuctionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuctionEvent_tenantId_idx" ON "AuctionEvent"("tenantId");

-- CreateIndex
CREATE INDEX "AuctionEvent_tenantId_status_idx" ON "AuctionEvent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Auction_auctionEventId_idx" ON "Auction"("auctionEventId");

-- CreateIndex
CREATE INDEX "Item_auctionEventId_idx" ON "Item"("auctionEventId");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_auctionEventId_fkey" FOREIGN KEY ("auctionEventId") REFERENCES "AuctionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_auctionEventId_fkey" FOREIGN KEY ("auctionEventId") REFERENCES "AuctionEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionEvent" ADD CONSTRAINT "AuctionEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
