-- Vinculo "mensagem do WhatsApp -> item" (suporte ao "Responder").
-- Guarda o message id de cards e de lances aceitos para que uma resposta
-- (swipe/Responder) encontre o item certo mesmo apos restart do backend.

-- CreateTable
CREATE TABLE "WhatsAppReplyBinding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "itemId" TEXT,
    "itemName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppReplyBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppReplyBinding_messageId_key" ON "WhatsAppReplyBinding"("messageId");

-- CreateIndex
CREATE INDEX "WhatsAppReplyBinding_auctionId_idx" ON "WhatsAppReplyBinding"("auctionId");

-- CreateIndex
CREATE INDEX "WhatsAppReplyBinding_tenantId_groupId_idx" ON "WhatsAppReplyBinding"("tenantId", "groupId");

-- CreateIndex
CREATE INDEX "WhatsAppReplyBinding_createdAt_idx" ON "WhatsAppReplyBinding"("createdAt");

-- AddForeignKey
ALTER TABLE "WhatsAppReplyBinding" ADD CONSTRAINT "WhatsAppReplyBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppReplyBinding" ADD CONSTRAINT "WhatsAppReplyBinding_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
