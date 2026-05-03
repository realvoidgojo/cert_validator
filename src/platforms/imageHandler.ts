import 'dotenv/config';
import axios from 'axios';
import Groq from 'groq-sdk';
import { ExtractedCertificateData } from '../types';
import { logger } from '../utils/logger';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
 * Tier 3: Screenshot via Browserless (External Chrome-as-a-service)
 */
export async function screenshotViaBrowserless(url: string): Promise<string | null> {
  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) {
    logger.error('BROWSERLESS_API_KEY is missing. Cannot take screenshot.');
    return null;
  }

  try {
    const endpoint = `https://chrome.browserless.io/screenshot?token=${token}`;
    const response = await axios.post(
      endpoint,
      {
        url,
        options: {
          type: 'png',
          fullPage: true,
          omitBackground: false
        },
        gotoOptions: {
          waitUntil: "networkidle2",
          timeout: 25000
        },
        viewport: {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 2 // High resolution for better OCR
        },
        waitFor: 500 // Short delay for animations to settle
      },
      { responseType: 'arraybuffer', timeout: 30000 }
    );

    return Buffer.from(response.data).toString('base64');
  } catch (err) {
    logger.error(`Tier 3 screenshot failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Extract data from image using Groq Llama 3.2 Vision
 */
export async function extractFromImageWithGroq(
  imageBase64: string,
  claimedName: string
): Promise<ExtractedCertificateData> {
  logger.info(`Sending image to Groq Vision for extraction (Claimed Name: ${claimedName})`);

  const prompt = `
You are analyzing a digital certificate image.
Extract ONLY the following fields and return strict JSON — no markdown, no explanation:
{
  "recipientName": "full name on certificate or null",
  "courseTitle": "course/certification name or null",
  "issueDate": "date issued or null",
  "issuingOrganization": "issuing body or null",
  "credentialId": "certificate ID/number or null",
  "expiryDate": "expiry date or null",
  "skills": ["skill1", "skill2"]
}

The claimed owner is "${claimedName}". 
If you cannot find a field, set it to null.
Return ONLY the JSON object.
  `.trim();

  try {
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
    logger.debug(`Groq Vision raw response: ${raw}`);

    const cleanJson = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    // Sanitize and trim all string fields
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
    logger.error(`Groq Vision extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
