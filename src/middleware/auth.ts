// src/middleware/auth.ts

import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey =
    req.headers["x-api-key"] ||
    req.headers.authorization?.replace("Bearer ", "");

  const validKeys = (process.env.API_KEYS ?? "dev-key-change-me")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (!apiKey || !validKeys.includes(apiKey as string)) {
    res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Valid API key required. Pass via x-api-key header.",
      requestId: uuidv4(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}
