// src/utils/nameMatcher.ts

import { MatchResult } from "../types";
import { logger } from "./logger";
import { groq } from "./groqClient";

/**
 * Normalize a name string:
 * - lowercase
 * - strip punctuation/extra spaces
 * - remove common suffixes/prefixes (Mr, Ms, Dr, etc.)
 */
export function normalizeName(name: string): string {
  const honorifics = /\b(mr|mrs|ms|miss|dr|prof|sir|shri|smt|kumari|er|b\.?tech|m\.?tech|phd|llb|md|be|me|v\.?i\.?p)\b\.?/gi;

  return name
    .toLowerCase()
    .replace(honorifics, "")
    .replace(/['’]/g, "")       // remove apostrophes (O'Brien -> OBrien)
    .replace(/[^a-z0-9\s]/g, " ") // replace other symbols with spaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize and sort name parts for order-independent matching
 * e.g. "Ravi Kumar S" vs "S Ravi Kumar"
 */
function sortedTokens(name: string): string {
  return normalizeName(name).split(" ").sort().join(" ");
}

/**
 * Levenshtein distance between two strings
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Normalized similarity score (0–1) from Levenshtein
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}



/**
 * Main entry point: compare extracted name vs claimed name
 * Returns MatchResult with confidence and method
 */
export function matchNames(
  extracted: string | null,
  claimed: string
): MatchResult {
  const normalizedClaimed = normalizeName(claimed);

  if (!extracted) {
    return {
      isMatch: false,
      confidence: 0,
      method: "none",
      normalizedExtracted: "",
      normalizedClaimed,
    };
  }

  const normalizedExtracted = normalizeName(extracted);

  // 1. Exact match after normalization
  if (normalizedExtracted === normalizedClaimed) {
    return {
      isMatch: true,
      confidence: 1.0,
      method: "exact",
      normalizedExtracted,
      normalizedClaimed,
    };
  }

  // 2. Token-sorted match (handles reordered name parts)
  const sortedExtracted = sortedTokens(extracted);
  const sortedClaimed = sortedTokens(claimed);
  if (sortedExtracted === sortedClaimed) {
    return {
      isMatch: true,
      confidence: 0.97,
      method: "normalized",
      normalizedExtracted,
      normalizedClaimed,
    };
  }

  // 3. Fuzzy match — combine Levenshtein
  const levScore = levenshteinSimilarity(normalizedExtracted, normalizedClaimed);
  const levSortedScore = levenshteinSimilarity(sortedExtracted, sortedClaimed);

  // Weighted composite: sorted variants get more weight
  const confidence = Math.max(levScore, levSortedScore);

  const MATCH_THRESHOLD = 0.75;
  return {
    isMatch: confidence >= MATCH_THRESHOLD,
    confidence: parseFloat(confidence.toFixed(4)),
    method: "fuzzy",
    normalizedExtracted,
    normalizedClaimed,
  };
}

/**
 * LLM-powered name matching for high robustness
 */
export async function matchNamesLLM(
  extracted: string | null,
  claimed: string
): Promise<MatchResult> {
  // Try standard matching first
  const baseMatch = matchNames(extracted, claimed);
  if (baseMatch.isMatch && baseMatch.confidence > 0.9) return baseMatch;

  if (!extracted) return baseMatch;

  logger.info(`Performing LLM name match: "${extracted}" vs "${claimed}"`);

  try {
    const prompt = `Compare extracted "${extracted}" and claimed "${claimed}". Are they the same person? Handle initials, reordering, phonetic shifts, and middle names. Reject course titles immediately. Return ONLY JSON: {"isMatch": boolean, "confidence": number, "reason": "short explanation"}`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const content = response.choices[0].message?.content || "{}";
    const cleanJson = content.replace(/```json|```/g, "").trim();
    const result = JSON.parse(cleanJson);
    logger.info(`LLM Decision: ${result.isMatch} (Conf: ${result.confidence}) - ${result.reason}`);

    return {
      isMatch: result.isMatch,
      confidence: result.confidence,
      method: "fuzzy", // conceptually it's fuzzy
      normalizedExtracted: extracted,
      normalizedClaimed: claimed,
    };
  } catch (err) {
    logger.error(`LLM match failed: ${err instanceof Error ? err.message : String(err)}`);
    return baseMatch;
  }
}

