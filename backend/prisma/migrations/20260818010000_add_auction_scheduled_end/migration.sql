-- Prazo fixo de encerramento de um item da lista, definido pelo painel após o início.

ALTER TABLE "Auction" ADD COLUMN "scheduledEndAt" TIMESTAMP(3);