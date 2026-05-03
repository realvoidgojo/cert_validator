import { ExtractedCertificateData } from "../types";
import { logger } from "../utils/logger";
import { fetchAsImage, extractFromHtmlFallback, captureCertificateScreenshots, extractFromImageWithGroq } from './imageHandler';

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
    const data = await extractFromImageWithGroq(imageBase64, claimedName);
    if (!data.recipientName) {
      logger.warn(`Extraction from ${source} returned no recipient name`);
      return null;
    }
    return data;
  } catch (err) {
    logger.error(`Extraction from ${source} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function buildUdemyCertificateImageUrl(url: string): string | null {
  const match = url.match(/udemy\.com\/certificate\/(UC-[A-Za-z0-9-]+)\/?/i);
  if (!match) {
    return null;
  }

  return `https://udemy-certificate.s3.amazonaws.com/image/${match[1]}.jpg`;
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

  // ── Tier 1.25: Udemy certificate image from certificate ID ─────────────────
  const udemyImageUrl = buildUdemyCertificateImageUrl(url);
  if (udemyImageUrl) {
    logger.info(`Tier 1.25: Udemy certificate image fallback for ${url}`);
    const udemyCertificateBase64 = await fetchAsImage(udemyImageUrl);
    if (udemyCertificateBase64) {
      const data = await attemptExtraction(udemyCertificateBase64, claimedName, 'Tier 1.25 (Udemy certificate image)');
      if (data?.recipientName) {
        logger.info('Tier 1.25 Success: Extracted recipient from Udemy certificate image.');
        return { data, screenshotBase64: udemyCertificateBase64 };
      }
      logger.warn('Tier 1.25 extraction returned empty name');
    } else {
      logger.warn(`Tier 1.25 could not download certificate image from ${udemyImageUrl}`);
    }
  }

  // ── Tier 1.5: HTML text fallback ───────────────────────────────────────────
  logger.info(`Tier 1.5: HTML text fallback for ${url}`);
  const htmlFallback = await extractFromHtmlFallback(url);
  if (htmlFallback?.recipientName) {
    logger.info('Tier 1.5 Success: Extracted certificate data from HTML.');
    return {
      data: {
        recipientName: htmlFallback.recipientName ?? null,
        courseTitle: htmlFallback.courseTitle ?? null,
        issueDate: htmlFallback.issueDate ?? null,
        credentialId: htmlFallback.credentialId ?? null,
        issuingOrganization: htmlFallback.issuingOrganization ?? null,
        expiryDate: htmlFallback.expiryDate ?? null,
        skills: htmlFallback.skills ?? [],
        rawText: htmlFallback.rawText ?? '[Extracted from HTML]',
      },
    };
  }

  if (htmlFallback?.imageUrl) {
    logger.info(`Tier 1.5b: Extracting from certificate image metadata for ${url}`);
    const certificateImageBase64 = await fetchAsImage(htmlFallback.imageUrl);
    if (certificateImageBase64) {
      const data = await attemptExtraction(certificateImageBase64, claimedName, 'Tier 1.5b (og:image)');
      if (data?.recipientName) {
        logger.info('Tier 1.5b Success: Extracted recipient from certificate image metadata.');
        return { data, screenshotBase64: certificateImageBase64 };
      }
      logger.warn('Tier 1.5b extraction returned empty name');
    } else {
      logger.warn('Tier 1.5b could not download certificate image metadata');
    }
  }

  // ── Tier 2: Screenshot via Browserless → Groq Vision ───────────────────────
  logger.info(`Tier 2: Browserless screenshot for ${url}`);
  const screenshotResults = await captureCertificateScreenshots(url);
  for (const screenshotResult of screenshotResults) {
    logger.info(`Tier 2 Success: Screenshot captured using ${screenshotResult.strategy}. Processing with Groq Vision.`);
    const data = await attemptExtraction(
      screenshotResult.base64,
      claimedName,
      `Tier 2 (${screenshotResult.strategy})`
    );
    if (data?.recipientName) {
      return { data, screenshotBase64: screenshotResult.base64 };
    }
    logger.warn(`Tier 2 extraction returned empty name for strategy ${screenshotResult.strategy}`);
  }

  throw new Error("Vision extraction failed. Could not process certificate.");
}


