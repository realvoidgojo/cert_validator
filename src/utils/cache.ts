// src/utils/cache.ts

import NodeCache from "node-cache";
import crypto from "crypto";
import { ValidationResult, CacheEntry } from "../types";

const DEFAULT_TTL_SECONDS = 60 * 60 * 6; // 6 hours

const cache = new NodeCache({
  stdTTL: DEFAULT_TTL_SECONDS,
  checkperiod: 60 * 10,
  useClones: true,
});

/**
 * Deterministic cache key from URL + name
 */
export function buildCacheKey(url: string, claimedName: string): string {
  const raw = `${url.toLowerCase().trim()}|${claimedName.toLowerCase().trim()}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function getCached(key: string): ValidationResult | null {
  const entry = cache.get<CacheEntry>(key);
  if (!entry) return null;
  return entry.result;
}

export function setCache(
  key: string,
  result: ValidationResult,
  ttlSeconds = DEFAULT_TTL_SECONDS
): void {
  const entry: CacheEntry = {
    result,
  };
  cache.set(key, entry, ttlSeconds);
}

export function deleteCache(key: string): void {
  cache.del(key);
}

export function getCacheStats() {
  return cache.getStats();
}
