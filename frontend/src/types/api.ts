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
  emailVerifiedAt: string | null;
  totpEnabled: boolean;
}

export interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  requiresMfa?: boolean;
  mfaToken?: string;
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
  groupId: string | null;
  periodicStatusMinutes: number | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  minBidStep: string | null;
  status: AuctionEventStatus;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  auctionCount: number;
}

export interface AuctionListItem {
  number: number;
  auctionId: string | null;
  itemId: string;
  name: string;
  initialValue: string;
  value: string;
  imageUrl: string | null;
  status: string;
  leader: { name: string; amount: string } | null;
  bidCount: number;
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
  scheduledEndAt: string | null;
  minBidStep: string | null;
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

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  maxGroups: number;
  maxAuctions: number | null;
  maxUsers: number;
  features: string[];
}

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'CANCELED' | 'EXPIRED';

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  paymentRequired: boolean;
  plan: Plan;
}

export interface PixPayment {
  internalId: string;
  externalId: string;
  status: string;
  transactionData: {
    qrCode: string;
    qrCodeBase64: string;
    ticketUrl?: string;
    expiresAt?: string;
  };
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: 'PIX' | 'CARD' | 'BOLETO' | 'MANUAL';
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paidAt: string | null;
  createdAt: string;
  plan: string | null;
}

export interface AdminSubscription {
  id: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  createdAt: string;
  tenant: { id: string; name: string; email: string };
  plan: {
    id: string;
    name: string;
    price: number;
    features: string[];
    maxGroups: number;
    maxUsers: number;
  };
  latestPayment: {
    status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
    paidAt: string | null;
    amount: number;
  } | null;
}

export interface AdminPayment {
  id: string;
  amount: number;
  method: 'PIX' | 'CARD' | 'BOLETO' | 'MANUAL';
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paidAt: string | null;
  createdAt: string;
  externalId: string | null;
}

export interface AdminSubscriptionDetail {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  tenant: { id: string; name: string; email: string; cnpj: string | null; createdAt: string };
  plan: Plan;
  payments: AdminPayment[];
}

export interface AdminSubscriptionSummary {
  totalTenants: number;
  totalSubscriptions: number;
  byStatus: Record<SubscriptionStatus, number>;
  paidRevenue: number;
  activeMrr: number;
}

export interface AdminPlan extends Plan {
  status: 'ACTIVE' | 'INACTIVE';
}
