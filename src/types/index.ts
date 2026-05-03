// src/types/index.ts

export type Platform = "unknown";

export interface ValidationRequest {
  certificateUrl: string;
  claimedName: string;
  options?: {
    strictMatch?: boolean;      // require high confidence (>= 0.85)
  };
}

export interface ExtractedCertificateData {
  recipientName: string | null;
  courseTitle: string | null;
  issueDate: string | null;
  issuingOrganization: string | null;
  credentialId: string | null;
  expiryDate: string | null;
  skills: string[];
  rawText: string;
}

export interface MatchResult {
  isMatch: boolean;
  confidence: number;         // 0.0 – 1.0
  method: "exact" | "fuzzy" | "normalized" | "none";
  normalizedExtracted: string;
  normalizedClaimed: string;
}

export interface ValidationResult {
  requestId: string;
  timestamp: string;
  platform: Platform;
  certificateUrl: string;
  claimedName: string;
  isValid: boolean;
  ownershipConfidence: number;
  match: MatchResult;
  certificateData: ExtractedCertificateData;
  screenshotBase64?: string;
  cacheHit: boolean;
  processingTimeMs: number;
  errorMessage?: string;
}



export interface CacheEntry {
  result: ValidationResult;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  requestId: string;
  timestamp: string;
}
