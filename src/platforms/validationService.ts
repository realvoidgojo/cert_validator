import { v4 as uuidv4 } from "uuid";
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
  const requestId = uuidv4();
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

    console.log(
      `[${requestId}] Done — valid: ${isValid}, confidence: ${match.confidence}, time: ${result.processingTimeMs}ms`
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[${requestId}] Scrape failed: ${message}`);

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
      errorMessage: `Scraping failed: ${message}`,
    };
  }
}
