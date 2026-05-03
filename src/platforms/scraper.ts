import { ExtractedCertificateData } from "../types";
import { logger } from "../utils/logger";
import { fetchAsImage, screenshotViaBrowserless, extractFromImageWithGroq } from './imageHandler';

export interface ScrapeResult {
  data: ExtractedCertificateData;
  screenshotBase64?: string;
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
    const data = await extractFromImageWithGroq(directImageBase64, claimedName);
    return { data, screenshotBase64: directImageBase64 };
  }

  // ── Tier 2: Screenshot via Browserless → Groq Vision ───────────────────────
  logger.info(`Tier 2: Browserless screenshot for ${url}`);
  const screenshotBase64 = await screenshotViaBrowserless(url);
  if (screenshotBase64) {
    logger.info('Tier 2 Success: Screenshot captured. Processing with Groq Vision.');
    const data = await extractFromImageWithGroq(screenshotBase64, claimedName);
    return { data, screenshotBase64 };
  }

  throw new Error("Vision extraction failed. Could not process certificate.");
}


