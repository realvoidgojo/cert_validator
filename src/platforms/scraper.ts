import { ExtractedCertificateData } from "../types";
import { logger } from "../utils/logger";
import { fetchAsImage, screenshotViaBrowserless, extractFromImageWithGroq } from './imageHandler';

export interface ScrapeResult {
  data: ExtractedCertificateData;
  screenshotBase64?: string;
}

/**
 * Attempt to extract certificate data from image, with fallback strategies
 */
async function attemptExtraction(
  imageBase64: string,
  claimedName: string,
  source: string
): Promise<ExtractedCertificateData | null> {
  try {
    return await extractFromImageWithGroq(imageBase64, claimedName);
  } catch (err) {
    logger.error(`Extraction from ${source} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function scrapeCertificate(
  url: string,
  claimedName: string
): Promise<ScrapeResult> {
  // ── Tier 1: URL is a direct image ──────────────────────────────────────────
  logger.info(`Tier 1: Direct image check for ${url}`);
  const directImageBase64 = await fetchAsImage(url);
  if (directImageBase64) {
    logger.info('Tier 1 Success: URL is a direct image. Processing with Groq Vision.');
    const data = await attemptExtraction(directImageBase64, claimedName, 'Tier 1 (direct image)');
    if (data?.recipientName) {
      return { data, screenshotBase64: directImageBase64 };
    } else {
      logger.warn('Tier 1 extraction failed or returned empty name');
    }
  }

  // ── Tier 2: Screenshot via Browserless → Groq Vision ───────────────────────
  logger.info(`Tier 2: Browserless screenshot for ${url}`);
  const screenshotBase64 = await screenshotViaBrowserless(url);
  if (screenshotBase64) {
    logger.info('Tier 2 Success: Screenshot captured. Processing with Groq Vision.');
    const data = await attemptExtraction(screenshotBase64, claimedName, 'Tier 2 (screenshot)');
    if (data?.recipientName) {
      return { data, screenshotBase64 };
    } else {
      logger.warn('Tier 2 extraction returned empty name, will throw');
    }
  }

  throw new Error("Vision extraction failed. Could not process certificate.");
}


