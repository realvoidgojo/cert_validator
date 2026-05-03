import axios from 'axios';
import { ExtractedCertificateData } from '../types';
import { logger } from '../utils/logger';
import { groq } from '../utils/groqClient';

/**
 * Tier 2: Check if the URL itself is an image
 */
export async function fetchAsImage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    const contentType = String(response.headers['content-type'] || '');
    if (contentType.startsWith('image/')) {
      return Buffer.from(response.data).toString('base64');
    }
    return null;
  } catch (err) {
    logger.warn(`Tier 2 check failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Tier 3: Screenshot via Browserless (External Chrome-as-a-service) with retries
 */
export async function screenshotViaBrowserless(url: string, attempt: number = 1, maxRetries: number = 2): Promise<string | null> {
  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) {
    logger.error('BROWSERLESS_API_KEY is missing. Cannot take screenshot.');
    return null;
  }

  try {
    logger.info(`Taking screenshot via Browserless (attempt ${attempt}/${maxRetries})`);
    const endpoint = `https://chrome.browserless.io/screenshot?token=${token}`;
    const response = await axios.post(
      endpoint,
      {
        url,
        options: {
          type: 'png',
          fullPage: false,
          omitBackground: false,
          clip: {
            x: 0,
            y: 0,
            width: 1280,
            height: 1600
          }
        },
        gotoOptions: {
          waitUntil: "networkidle2",
          timeout: 25000
        },
        viewport: {
          width: 1280,
          height: 1600,
          deviceScaleFactor: 1 // Reduced from 2 to fit within Groq's pixel limit
        }
      },
      { responseType: 'arraybuffer', timeout: 30000 }
    );

    return Buffer.from(response.data).toString('base64');
  } catch (err: any) {
    const message = err.message || String(err);
    const statusCode = err.response?.status;
    logger.error(`Tier 3 screenshot failed (attempt ${attempt}): ${message} (status: ${statusCode})`);
    
    // Retry on transient errors
    if (attempt < maxRetries && (statusCode === 408 || statusCode === 429 || statusCode === 503 || message.includes('timeout'))) {
      logger.warn(`Transient error, retrying screenshot...`);
      const backoffMs = Math.pow(2, attempt - 1) * 2000; // 2s, 4s
      await sleep(backoffMs);
      return screenshotViaBrowserless(url, attempt + 1, maxRetries);
    }
    
    return null;
  }
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract data from image using Groq Llama 3.2 Vision with automatic retries
 */
export async function extractFromImageWithGroq(
  imageBase64: string,
  claimedName: string,
  attempt: number = 1,
  maxRetries: number = 3
): Promise<ExtractedCertificateData> {
  const prompt = `Extract certificate details into strict JSON: {"recipientName": string|null, "courseTitle": string|null, "issueDate": string|null, "issuingOrganization": string|null, "credentialId": string|null, "expiryDate": string|null, "skills": string[]}. Return ONLY JSON, no markdown.`.trim();

  try {
    logger.info(`Sending image to Groq Vision for extraction (attempt ${attempt}/${maxRetries})`);

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 512,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${imageBase64}` },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    logger.debug(`Groq Vision raw response: ${raw.substring(0, 200)}`);

    const cleanJson = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    // Sanitize and trim all string fields
    const trim = (val: any) => (typeof val === 'string' ? val.trim() : val);

    const result = {
      recipientName: trim(parsed.recipientName) || null,
      courseTitle: trim(parsed.courseTitle) || null,
      issueDate: trim(parsed.issueDate) || null,
      issuingOrganization: trim(parsed.issuingOrganization) || null,
      credentialId: trim(parsed.credentialId) || null,
      expiryDate: trim(parsed.expiryDate) || null,
      skills: Array.isArray(parsed.skills) 
        ? parsed.skills.filter((s: any) => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim())
        : [],
      rawText: '[Extracted via Vision]',
    };

    // If critical field (recipientName) is missing, retry
    if (!result.recipientName && attempt < maxRetries) {
      logger.warn(`Attempt ${attempt}: recipientName is null, retrying...`);
      const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      await sleep(backoffMs);
      return extractFromImageWithGroq(imageBase64, claimedName, attempt + 1, maxRetries);
    }

    return result;
  } catch (err) {
    logger.error(`Groq Vision extraction failed (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);
    
    // Retry on transient errors (timeouts, rate limits)
    if (attempt < maxRetries) {
      const isTransient = err instanceof Error && 
        (err.message.includes('timeout') || 
         err.message.includes('429') || 
         err.message.includes('503') ||
         err.message.includes('connection'));
      
      if (isTransient) {
        logger.warn(`Transient error detected, retrying (${attempt}/${maxRetries})...`);
        const backoffMs = Math.pow(2, attempt - 1) * 1500; // 1.5s, 3s, 6s
        await sleep(backoffMs);
        return extractFromImageWithGroq(imageBase64, claimedName, attempt + 1, maxRetries);
      }
    }
    
    throw err;
  }
}
