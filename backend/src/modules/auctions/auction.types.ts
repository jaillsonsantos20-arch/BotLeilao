import { Role } from '@prisma/client';

export interface StartAuctionInput {
  groupId: string;
  productName: string;
  initialValue: number;
  durationSeconds: number;
  itemId?: string;
  auctionEventId?: string;
  /** Incremento mínimo por lance (ex.: R$ 1,00). Null = qualquer lance maior. */
  minBidStep?: number | null;
  startedBy?: string;
  /** Papel do ator. undefined = chamada do bot/engine (limite é aplicado). */
  actorRole?: Role;
}

export interface PlaceBidInput {
  auctionId: string;
  amount: number;
  participantPhone: string;
  participantName?: string;
}

export interface AuctionStatusResult {
  auction: unknown;
  leader: unknown;
  bidCount: number;
  timeRemainingSeconds: number;
}
