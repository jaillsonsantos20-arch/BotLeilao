-- Confirmação de publicação do card do item no WhatsApp (idempotência do envio).
ALTER TABLE "Auction" ADD COLUMN "cardSentAt" TIMESTAMP(3);

-- Leilões de lista já existentes foram publicados quando a lista foi aberta.
UPDATE "Auction"
SET "cardSentAt" = "startedAt"
WHERE "auctionEventId" IS NOT NULL AND "itemId" IS NOT NULL;
