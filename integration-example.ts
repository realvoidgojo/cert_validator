/**
 * integration-example.ts
 * 
 * Drop-in client for your college certificate validation system.
 * Works with TypeScript or plain JavaScript (rename to .js and remove types).
 * 
 * Usage:
 *   import { CertValidatorClient } from './integration-example';
 *   const client = new CertValidatorClient('https://your-api.college.edu', 'your-api-key');
 *   const result = await client.validate(url, studentName);
 */

interface ValidationOptions {
  strictMatch?: boolean;
}

interface MatchResult {
  isMatch: boolean;
  confidence: number;
  method: string;
  normalizedExtracted: string;
  normalizedClaimed: string;
}

interface CertificateData {
  recipientName: string | null;
  courseTitle: string | null;
  issueDate: string | null;
  credentialId: string | null;
  issuingOrganization: string | null;
  expiryDate: string | null;
  skills: string[];
}

interface ValidationResult {
  requestId: string;
  timestamp: string;
  platform: string;
  certificateUrl: string;
  claimedName: string;
  isValid: boolean;
  ownershipConfidence: number;
  match: MatchResult;
  certificateData: CertificateData;
  screenshotBase64?: string;
  cacheHit: boolean;
  processingTimeMs: number;
  errorMessage?: string;
}

interface BatchResult {
  batchId: string;
  timestamp: string;
  total: number;
  results: Array<{
    index: number;
    status: "fulfilled" | "rejected";
    result: ValidationResult | null;
    error: string | null;
  }>;
}

export class CertValidatorClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
  }

  /**
   * Validate a single certificate
   */
  async validate(
    certificateUrl: string,
    claimedName: string,
    options: ValidationOptions = {}
  ): Promise<ValidationResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/validate`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ certificateUrl, claimedName, options }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`API error ${res.status}: ${err.message}`);
    }

    return res.json() as Promise<ValidationResult>;
  }

  /**
   * Validate multiple certificates in one request (max 10)
   */
  async validateBatch(
    entries: Array<{ certificateUrl: string; claimedName: string; options?: ValidationOptions }>
  ): Promise<BatchResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/validate/batch`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ requests: entries }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(`Batch API error ${res.status}: ${err.message}`);
    }

    return res.json() as Promise<BatchResult>;
  }

  /**
   * Get supported capabilities
   */
  async getCapabilities(): Promise<{ engine: string; supports: string[]; universal: boolean; timestamp: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/capabilities`, {
      headers: this.headers(),
    });
    return (await res.json()) as { engine: string; supports: string[]; universal: boolean; timestamp: string };
  }

  /**
   * Convenience: returns a simple pass/fail with human-readable reason
   */
  async check(
    certificateUrl: string,
    claimedName: string
  ): Promise<{ passed: boolean; reason: string; confidence: number }> {
    const result = await this.validate(certificateUrl, claimedName);

    if (result.errorMessage) {
      return { passed: false, reason: result.errorMessage, confidence: 0 };
    }

    if (!result.isValid) {
      return {
        passed: false,
        reason: `Name mismatch. Certificate belongs to "${result.certificateData.recipientName ?? "unknown"}", not "${claimedName}". Confidence: ${(result.ownershipConfidence * 100).toFixed(1)}%`,
        confidence: result.ownershipConfidence,
      };
    }

    return {
      passed: true,
      reason: `Certificate verified. "${result.certificateData.courseTitle}" issued to "${result.certificateData.recipientName}" on ${result.certificateData.issueDate ?? "unknown date"}. Confidence: ${(result.ownershipConfidence * 100).toFixed(1)}%`,
      confidence: result.ownershipConfidence,
    };
  }
}

// ─── Example usage ────────────────────────────────────────────────────────────

async function example() {
  const client = new CertValidatorClient(
    "http://localhost:3000",
    "your-api-key-here"
  );

  // Single validation
  const result = await client.check(
    "https://www.udemy.com/certificate/UC-XXXXXXXXXX/",
    "Ravi Kumar S"
  );
  console.log("Verification result:", result);

  // Batch — e.g. processing multiple student submissions
  const batch = await client.validateBatch([
    { certificateUrl: "https://www.credly.com/badges/abc-123", claimedName: "Priya Nair" },
    { certificateUrl: "https://nptel.ac.in/certificate?id=xyz", claimedName: "Arun Prasad" },
  ]);
  console.log("Batch results:", JSON.stringify(batch, null, 2));
}
