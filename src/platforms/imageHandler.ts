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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function cleanValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseCertificateText(text: string): Partial<ExtractedCertificateData> | null {
  const verificationMatch = text.match(
    /This certificate above verifies that\s+(.+?)\s+successfully completed the course\s+(.+?)\s+on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})/i
  );

  if (verificationMatch) {
    return {
      recipientName: cleanValue(verificationMatch[1]),
      courseTitle: cleanValue(verificationMatch[2]),
      issueDate: verificationMatch[3],
      issuingOrganization: 'Udemy',
      rawText: '[Extracted from HTML]',
    };
  }

  const recipientBlockMatch = text.match(/Certificate Recipient:\s*(.+?)\s*About the Course:/i);
  const courseBlockMatch = text.match(/About the Course:\s*(.+?)(?:Instructor:|$)/i);

  if (recipientBlockMatch) {
    const recipientText = cleanValue(recipientBlockMatch[1]);
    const recipientName = recipientText.split(' ').slice(0, 6).join(' ').trim();
    return {
      recipientName: recipientName || null,
      courseTitle: courseBlockMatch ? cleanValue(courseBlockMatch[1]).split(' Instructor:')[0].trim() : null,
      issuingOrganization: 'Udemy',
      rawText: '[Extracted from HTML]',
    };
  }

  return null;
}

function extractOgImageUrl(html: string): string | null {
  const match = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * HTML fallback for certificate pages that expose the recipient in the page source.
 */
export interface HtmlFallbackResult extends Partial<ExtractedCertificateData> {
  imageUrl?: string;
}

export async function extractFromHtmlFallback(url: string): Promise<HtmlFallbackResult | null> {
  try {
    try {
      const response = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      const html = String(response.data || '');
      const parsed = parseCertificateText(stripHtml(html));
      const imageUrl = extractOgImageUrl(html);
      if (parsed || imageUrl) {
        return {
          ...parsed,
          imageUrl: imageUrl || undefined,
        };
      }
    } catch (directErr) {
      logger.warn(`Direct HTML fetch failed for ${url}: ${directErr instanceof Error ? directErr.message : String(directErr)}`);
    }

    const token = process.env.BROWSERLESS_API_KEY;
    if (!token) {
      return null;
    }

    const unblockResponse = await axios.post(
      `https://chrome.browserless.io/unblock?token=${token}`,
      {
        url,
        content: true,
        cookies: false,
        screenshot: false,
        browserWSEndpoint: false,
      },
      {
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        responseType: 'json',
      }
    );

    const browserlessHtml = String(unblockResponse.data?.content || '');
    const parsed = parseCertificateText(stripHtml(browserlessHtml));
    const imageUrl = extractOgImageUrl(browserlessHtml);
    if (parsed || imageUrl) {
      return {
        ...parsed,
        imageUrl: imageUrl || undefined,
      };
    }
    return null;
  } catch (err) {
    logger.warn(`HTML fallback failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

interface ScreenshotCaptureOptions {
  fullPage: boolean;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const SCREENSHOT_STRATEGIES: Array<{ name: string; options: ScreenshotCaptureOptions }> = [
  {
    name: 'top-crop',
    options: {
      fullPage: false,
      viewport: {
        width: 1280,
        height: 1600,
        deviceScaleFactor: 1,
      },
      clip: {
        x: 0,
        y: 0,
        width: 1280,
        height: 1600,
      },
    },
  },
  {
    name: 'full-page-medium',
    options: {
      fullPage: true,
      viewport: {
        width: 1024,
        height: 1400,
        deviceScaleFactor: 1,
      },
    },
  },
  {
    name: 'full-page-small',
    options: {
      fullPage: true,
      viewport: {
        width: 900,
        height: 1200,
        deviceScaleFactor: 1,
      },
    },
  },
];

/**
 * Tier 3: Screenshot via Browserless (External Chrome-as-a-service)
 */
async function takeBrowserlessScreenshot(
  url: string,
  options: ScreenshotCaptureOptions,
  attempt: number = 1,
  maxRetries: number = 2
): Promise<string | null> {
  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) {
    logger.error('BROWSERLESS_API_KEY is missing. Cannot take screenshot.');
    return null;
  }

  try {
    logger.info(`Taking screenshot via Browserless (attempt ${attempt}/${maxRetries})`);
    const endpoint = `https://chrome.browserless.io/unblock?token=${token}`;
    const response = await axios.post(
      endpoint,
      {
        url,
        screenshot: true,
        content: false,
        cookies: false,
        browserWSEndpoint: false,
      },
      { responseType: 'json', timeout: 60000 }
    );

    const screenshot = String(response.data?.screenshot || '');
    return screenshot || null;
  } catch (err: any) {
    const message = err.message || String(err);
    const statusCode = err.response?.status;
    logger.error(`Tier 3 screenshot failed (attempt ${attempt}): ${message} (status: ${statusCode})`);

    if (attempt < maxRetries && (statusCode === 408 || statusCode === 429 || statusCode === 503 || message.includes('timeout'))) {
      logger.warn('Transient error, retrying screenshot...');
      const backoffMs = Math.pow(2, attempt - 1) * 2000;
      await sleep(backoffMs);
      return takeBrowserlessScreenshot(url, options, attempt + 1, maxRetries);
    }

    return null;
  }
}

/**
 * Try multiple screenshot layouts and return every successful capture.
 */
export async function captureCertificateScreenshots(url: string): Promise<Array<{ base64: string; strategy: string }>> {
  const screenshots: Array<{ base64: string; strategy: string }> = [];

  for (const strategy of SCREENSHOT_STRATEGIES) {
    logger.info(`Trying screenshot strategy: ${strategy.name}`);
    const base64 = await takeBrowserlessScreenshot(url, strategy.options);
    if (base64) {
      screenshots.push({ base64, strategy: strategy.name });
    }
  }

  return screenshots;
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
  const prompt = [
    'Read the certificate image carefully and extract ONLY the certificate text, not the surrounding browser UI or page chrome.',
    'The recipient name is usually the large bold name printed on the certificate itself.',
    'Return strict JSON exactly in this shape:',
    '{"recipientName": string|null, "courseTitle": string|null, "issueDate": string|null, "issuingOrganization": string|null, "credentialId": string|null, "expiryDate": string|null, "skills": string[]}',
    'If you can read a recipient name from the certificate, always return it.',
    'Return ONLY JSON, no markdown, no explanation.',
  ].join(' ');

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

    const trim = (val: any) => (typeof val === 'string' ? val.trim() : val);

    return {
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
  } catch (err) {
    logger.error(`Groq Vision extraction failed (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`);

    if (attempt < maxRetries) {
      const isTransient = err instanceof Error &&
        (err.message.includes('timeout') ||
         err.message.includes('429') ||
         err.message.includes('503') ||
         err.message.includes('connection'));

      if (isTransient) {
        logger.warn(`Transient error detected, retrying (${attempt}/${maxRetries})...`);
        const backoffMs = Math.pow(2, attempt - 1) * 1500;
        await sleep(backoffMs);
        return extractFromImageWithGroq(imageBase64, claimedName, attempt + 1, maxRetries);
      }
    }

    throw err;
  }
}