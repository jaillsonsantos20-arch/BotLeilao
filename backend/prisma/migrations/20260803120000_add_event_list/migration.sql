-- Lista de itens simultânea (leilão multi-item no grupo)

-- Permite mais de um leilão aberto por grupo (itens simultâneos).
DROP INDEX IF EXISTS "Auction_one_open_per_group";

-- Ordem/número do item dentro do evento (usado no lance "NN - VALOR").
ALTER TABLE "Item" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Evento passa a opcionalmente apontar para o grupo (lista aberta no grupo)
-- e guarda o intervalo (min) do status periódico enviado pelo bot.
ALTER TABLE "AuctionEvent" ADD COLUMN "groupId" TEXT;
ALTER TABLE "AuctionEvent" ADD COLUMN "periodicStatusMinutes" INTEGER;

CREATE INDEX "AuctionEvent_groupId_idx" ON "AuctionEvent"("groupId");

-- FK AuctionEvent -> Group (SET NULL para preservar o histórico).
ALTER TABLE "AuctionEvent"
  ADD CONSTRAINT "AuctionEvent_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "Group"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;