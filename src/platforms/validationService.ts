import crypto from "crypto";
import {
  ValidationRequest,
  ValidationResult,
} from "../types";
import { scrapeCertificate } from "./scraper";
import { matchNamesLLM } from "../utils/nameMatcher";
import { buildCacheKey, getCached, setCache } from "../utils/cache";
import { logger } from "../utils/logger";

export async function validateCertificate(
  req: ValidationRequest
): Promise<ValidationResult> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info(`[${requestId}] Validating: ${req.certificateUrl} for "${req.claimedName}"`);

  // Cache lookup
  const cacheKey = buildCacheKey(req.certificateUrl, req.claimedName);
  const cached = getCached(cacheKey);
  if (cached) {
    logger.info(`[${requestId}] Cache HIT`);
    return {
      ...cached,
      requestId,
      timestamp,
      cacheHit: true,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Build base result skeleton
  const base: Omit<ValidationResult, "isValid" | "ownershipConfidence" | "match" | "certificateData" | "processingTimeMs"> = {
    requestId,
    timestamp,
    platform: "unknown", // Pure vision engine treats all as unknown/universal
    certificateUrl: req.certificateUrl,
    claimedName: req.claimedName,
    cacheHit: false,
  };

  try {
    const { data, screenshotBase64 } = await scrapeCertificate(
      req.certificateUrl,
      req.claimedName
    );

    const finalRecipientName = data.recipientName;
    logger.info(`[${requestId}] Final name for matching: "${finalRecipientName}"`);

    const match = await matchNamesLLM(finalRecipientName, req.claimedName);
    const strictMode = req.options?.strictMatch ?? false;
    const threshold = strictMode ? 0.85 : 0.75;
    const isValid = match.confidence >= threshold;

    const result: ValidationResult = {
      ...base,
      isValid,
      ownershipConfidence: match.confidence,
      match,
      certificateData: data,
      screenshotBase64,
      processingTimeMs: Date.now() - startTime,
    };

    // Cache only successful extractions
    if (data.recipientName) {
      setCache(cacheKey, result);
    }

    logger.info(
      `[${requestId}] Done — valid: ${isValid}, confidence: ${match.confidence}, time: ${result.processingTimeMs}ms`
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isNetworkError = message.includes('timeout') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND');
    const isAPIError = message.includes('400') || message.includes('401') || message.includes('403');
    
    let errorDetails = message;
    if (isNetworkError) {
      errorDetails = `Network error (connection/timeout) - ${message}`;
    } else if (isAPIError) {
      errorDetails = `API error - ${message}`;
    }
    
    logger.error(`[${requestId}] Validation failed: ${errorDetails}`);

    return {
      ...base,
      isValid: false,
      ownershipConfidence: 0,
      match: {
        isMatch: false,
        confidence: 0,
        method: "none",
        normalizedExtracted: "",
        normalizedClaimed: req.claimedName,
      },
      certificateData: {
        recipientName: null,
        courseTitle: null,
        issueDate: null,
        credentialId: null,
        issuingOrganization: null,
        expiryDate: null,
        skills: [],
        rawText: "",
      },
      processingTimeMs: Date.now() - startTime,
      errorMessage: `Validation failed: ${errorDetails}`,
    };
  }
}
