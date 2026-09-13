-- Incremento mínimo por lance: configurado no leilão (evento) e copiado para cada leilão de item.

ALTER TABLE "AuctionEvent" ADD COLUMN "minBidStep" DECIMAL(10,2);
ALTER TABLE "Auction" ADD COLUMN "minBidStep" DECIMAL(10,2);