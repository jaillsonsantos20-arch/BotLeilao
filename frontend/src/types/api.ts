/**
 * Tipos de domínio da API (espelham as respostas do backend).
 */

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: PaginationMeta;
  timestamp: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  isActive: boolean;
}

export interface DashboardSummary {
  activeAuctions: number;
  closedAuctions: number;
  cancelledAuctions: number;
  revenue: string;
  highestBid: string | null;
  totalProducts: number;
  totalParticipants: number;
  totalBids: number;
  totalGroups: number;
  totalUsers: number;
  totalClients: number;
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export interface TopProduct {
  productName: string;
  total: string;
  count: number;
}

export interface Group {
  id: string;
  tenantId: string;
  whatsappGroupId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  openAuctionCount: number;
  openAuction: {
    id: string;
    productName: string;
    endsAt: string;
    initialValue: string;
  } | null;
}

export type AuctionStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export type ItemStatus = 'AVAILABLE' | 'ON_AUCTION' | 'SOLD';

export type AuctionEventStatus = 'OPEN' | 'CLOSED';

export interface AuctionEvent {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: AuctionEventStatus;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  auctionCount: number;
}

export interface Item {
  id: string;
  tenantId: string;
  auctionEventId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  initialValue: string;
  durationSeconds: number;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  auctionCount: number;
}

export interface Auction {
  id: string;
  tenantId: string;
  groupId: string;
  itemId: string | null;
  auctionEventId: string | null;
  productName: string;
  initialValue: string;
  durationSeconds: number;
  status: AuctionStatus;
  paymentStatus: 'PENDING' | 'PAID';
  startedAt: string;
  endsAt: string | null;
  closedAt: string | null;
  winnerBidId: string | null;
  group?: { id: string; name: string };
  auctionEvent?: { id: string; name: string } | null;
  winnerBid?: {
    amount: string;
    participantName: string | null;
    participantPhone: string;
  } | null;
  _count?: { bids: number };
}

export interface WhatsAppStatus {
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR';
  qr: string | null;
}
