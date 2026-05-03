// src/middleware/validateRequest.ts

import { Request, Response, NextFunction } from "express";
import Joi from "joi";
import crypto from "crypto";

const validationSchema = Joi.object({
  certificateUrl: Joi.string()
    .uri({ scheme: ["http", "https"] })
    .max(2048)
    .required()
    .messages({
      "string.uri": "certificateUrl must be a valid HTTP/HTTPS URL",
      "any.required": "certificateUrl is required",
    }),
  claimedName: Joi.string()
    .min(2)
    .max(200)
    .pattern(/^[\p{L}\s.'\-,]+$/u)
    .required()
    .messages({
      "string.min": "claimedName must be at least 2 characters",
      "string.max": "claimedName must be at most 200 characters",
      "string.pattern.base": "claimedName must contain only letters, spaces, and common punctuation",
      "any.required": "claimedName is required",
    }),
  options: Joi.object({
    strictMatch: Joi.boolean().optional(),
  }).optional(),
});

export function validateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { error, value } = validationSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    res.status(400).json({
      error: "VALIDATION_ERROR",
      message: error.details.map((d) => d.message).join("; "),
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  req.body = value;
  next();
}
