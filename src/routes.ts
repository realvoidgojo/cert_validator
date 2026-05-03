// src/routes.ts

import { Router, Request, Response } from "express";
import { validateRequest } from "./middleware/validateRequest";
import { apiKeyAuth } from "./middleware/auth";
import { validateCertificate } from "./platforms/validationService";
import { getCacheStats } from "./utils/cache";
import { ValidationRequest } from "./types";
import { logger } from "./utils/logger";
import crypto from "crypto";

const router = Router();

// ─── POST /api/v1/validate ───────────────────────────────────────────────────
router.post(
  "/validate",
  apiKeyAuth,
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const payload = req.body as ValidationRequest;
      const result = await validateCertificate(payload);

      const statusCode = result.errorMessage ? 422 : 200;
      res.status(statusCode).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      logger.error(`Unhandled route error: ${message}`);
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message,
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ─── POST /api/v1/validate/batch ─────────────────────────────────────────────
router.post(
  "/validate/batch",
  apiKeyAuth,
  async (req: Request, res: Response) => {
    const { requests } = req.body as { requests: ValidationRequest[] };

    if (!Array.isArray(requests) || requests.length === 0) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "requests must be a non-empty array",
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (requests.length > 10) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: "Batch size limit is 10 requests",
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const results = await Promise.allSettled(
        requests.map((r) => validateCertificate(r))
      );

      const response = results.map((r, i) => ({
        index: i,
        status: r.status,
        result: r.status === "fulfilled" ? r.value : null,
        error: r.status === "rejected" ? r.reason?.message : null,
      }));

      res.json({
        batchId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        total: requests.length,
        results: response,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Batch error";
      res.status(500).json({
        error: "INTERNAL_ERROR",
        message,
        requestId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      });
    }
  }
);

// ─── GET /api/v1/capabilities ───────────────────────────────────────────────
router.get("/capabilities", (_req: Request, res: Response) => {
  res.json({
    engine: "Universal Vision OCR (Llama 4 Scout)",
    supports: ["Direct Images", "Websites", "React Apps", "PDFs"],
    universal: true,
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/v1/health ──────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "2.0.0 (Vision-Only)",
    timestamp: new Date().toISOString(),
    cache: getCacheStats(),
  });
});

export default router;
