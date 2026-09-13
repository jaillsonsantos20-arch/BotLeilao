-- Agendamento do leilão (evento): início/término automáticos da lista no grupo.

ALTER TABLE "AuctionEvent" ADD COLUMN "scheduledStartAt" TIMESTAMP(3);
ALTER TABLE "AuctionEvent" ADD COLUMN "scheduledEndAt" TIMESTAMP(3);