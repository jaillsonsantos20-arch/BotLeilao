export interface StartAuctionInput {
  groupId: string;
  productName: string;
  initialValue: number;
  durationSeconds: number;
  itemId?: string;
  auctionEventId?: string;
  startedBy?: string;
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
