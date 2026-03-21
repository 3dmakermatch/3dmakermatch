export enum UserRole {
  BUYER = 'buyer',
  PRINTER = 'printer',
  ADMIN = 'admin',
}

export enum JobStatus {
  DRAFT = 'draft',
  BIDDING = 'bidding',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum BidStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export enum OrderStatus {
  PAID = 'paid',
  PRINTING = 'printing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CONFIRMED = 'confirmed',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface Printer {
  id: string;
  userId: string;
  bio: string | null;
  addressCity: string | null;
  addressState: string | null;
  latitude: number | null;
  longitude: number | null;
  trustScore: number;
  isVerified: boolean;
  capabilities: PrinterCapabilities;
  averageRating: number;
  user?: User;
}

export interface PrinterCapabilities {
  machines: Machine[];
  materials: string[];
  maxBuildVolume?: { x: number; y: number; z: number };
}

export interface Machine {
  name: string;
  type: 'FDM' | 'SLA' | 'SLS' | 'MJF' | 'OTHER';
  buildVolume: { x: number; y: number; z: number };
  materials: string[];
}

export interface PrintJob {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  materialPreferred: string | null;
  quantity: number;
  status: JobStatus;
  expiresAt: string;
  createdAt: string;
  fileMetadata?: FileMetadata;
  bidCount?: number;
  user?: User;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  dimensions: { x: number; y: number; z: number };
  volumeCm3: number;
  polygonCount: number;
  isManifold: boolean;
  printabilityScore: number;
}

export interface Bid {
  id: string;
  jobId: string;
  printerId: string;
  amountCents: number;
  shippingCostCents: number;
  estimatedDays: number;
  message: string | null;
  status: BidStatus;
  createdAt: string;
  printer?: Printer;
}

export interface Order {
  id: string;
  jobId: string;
  bidId: string;
  buyerId: string;
  printerId: string;
  stripePaymentIntentId: string | null;
  status: OrderStatus;
  trackingNumber: string | null;
  createdAt: string;
  job?: PrintJob;
  bid?: Bid;
}

export interface Review {
  id: string;
  orderId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer?: User;
}

export interface Message {
  id: string;
  jobId: string;
  senderId: string;
  receiverId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: User;
}

export interface ApiError {
  error: string;
  code: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  role: UserRole.BUYER | UserRole.PRINTER;
}
