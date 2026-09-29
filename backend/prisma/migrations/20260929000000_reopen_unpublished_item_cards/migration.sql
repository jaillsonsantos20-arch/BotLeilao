-- A migração 20260928120000 marcou TODOS os leilões de lista existentes como
-- "card já publicado" (cardSentAt = startedAt), mas na prática só a lista
-- textual era enviada: os cards com foto, número, descrição e valor inicial
-- nunca chegaram ao grupo.
--
-- Desfaz esse backfill para que os cards pendentes sejam publicados no próximo
-- "Iniciar lista" / "Atualizar Lista". Envios reais gravam cardSentAt em
-- momento distinto de startedAt (só o backfill copia o mesmo timestamp), então
-- cards efetivamente publicados continuam protegidos contra reenvio.
UPDATE "Auction"
SET "cardSentAt" = NULL
WHERE "cardSentAt" = "startedAt"
  AND "auctionEventId" IS NOT NULL
  AND "itemId" IS NOT NULL;
