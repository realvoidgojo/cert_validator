// src/utils/nameMatcher.ts

import Fuse from "fuse.js";
import axios from "axios";
import { MatchResult } from "../types";
import { logger } from "./logger";

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
 * Fuse.js fuzzy match score (0–1)
 */
function fuseScore(target: string, query: string): number {
  if (!target || !query) return 0;
  const fuse = new Fuse([target], {
    includeScore: true,
    threshold: 1.0,  // include all results
    ignoreLocation: true,
  });
  const results = fuse.search(query);
  if (!results.length) return 0;
  // Fuse score 0 = perfect, 1 = no match → invert
  return 1 - (results[0].score ?? 1);
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

  // 3. Fuzzy match — combine Levenshtein + Fuse.js
  const levScore = levenshteinSimilarity(normalizedExtracted, normalizedClaimed);
  const levSortedScore = levenshteinSimilarity(sortedExtracted, sortedClaimed);
  const fuseDirectScore = fuseScore(normalizedExtracted, normalizedClaimed);
  const fuseSortedScore = fuseScore(sortedExtracted, sortedClaimed);

  // Weighted composite: sorted variants get more weight
  const confidence = Math.max(
    levScore * 0.4 + fuseDirectScore * 0.6,
    levSortedScore * 0.4 + fuseSortedScore * 0.6
  );

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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !extracted) return baseMatch;

  logger.info(`Performing LLM name match: "${extracted}" vs "${claimed}"`);

  try {
    const prompt = `
    You are a name matching expert. Compare the following two names and decide if they refer to the same person.
    Extracted Name from Certificate: "${extracted}"
    Claimed Name by User: "${claimed}"

    Rules:
    - Handle initials (e.g., "Tarun S S" vs "Tarun Senthil").
    - Handle reordering (e.g., "S. S. Tarun" vs "Tarun S S" or "Senthil Tarun" vs "Tarun Senthil").
    - Handle middle name expansion and contractions.
    - Handle cultural naming conventions (e.g., surname first, family name initials).
    - Allow for minor spelling variations or phonetic similarities (e.g., "Vikas" vs "Vikaas").
    - IMPORTANT: If one of the strings is clearly a course title or certificate type (e.g. "Problem Solving Certificate") and NOT a person's name, return "isMatch": false.
    - Be robust but strict about major differences (e.g., "Rahul Kumar" vs "Rohan Kumar" should be false).

    Respond ONLY with a JSON object:
    {
      "isMatch": boolean,
      "confidence": number (0.0 to 1.0),
      "reason": "short explanation"
    }
    `;

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    const result = JSON.parse(response.data.choices[0].message.content);
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

