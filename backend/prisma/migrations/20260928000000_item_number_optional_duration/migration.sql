-- AlterTable: duração do item passa a ser opcional (NULL = sem duração)
ALTER TABLE "Item" ALTER COLUMN "durationSeconds" DROP NOT NULL;
ALTER TABLE "Item" ALTER COLUMN "durationSeconds" DROP DEFAULT;

-- AlterTable: nº exibido do item (status/lance); NULL em itens legados
ALTER TABLE "Item" ADD COLUMN "number" INTEGER;

-- Data: 0 minutos já significava "sem tempo" — normaliza para NULL
UPDATE "Item" SET "durationSeconds" = NULL WHERE "durationSeconds" = 0;

-- CreateIndex: nº único por leilão (NULLs não colidem no Postgres)
CREATE UNIQUE INDEX "Item_auctionEventId_number_key" ON "Item"("auctionEventId", "number");
