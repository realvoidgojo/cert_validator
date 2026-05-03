# 🎓 Universal Certificate Validator API (v2.0)

A next-generation, **purely vision-based** validation engine. Unlike traditional scrapers that break when website layouts change, this API uses a state-of-the-art **Vision OCR pipeline** (Browserless.io + Groq Llama 4 Scout) to "see" and validate certificates from **any URL on the internet** (Udemy, LinkedIn, Coursera, raw PDFs, S3 buckets, etc.).

---

## 🚀 The Vision-First Architecture

We've eliminated brittle CSS selectors and platform-specific hardcoding. Everything is now universal:

```
POST /api/v1/validate
        │
        ▼
  [Cache Check]      ← SHA-256(url + name)
        │ miss
        ▼
  [Vision Pipeline] 
        ├─ Tier 1: Direct Image Detection
        └─ Tier 2: Browserless Screenshot (for JS/React/PDFs)
        │
        ▼
  [Groq Llama 4]     ← Multi-modal extraction of name, course, dates
        │
        ▼
  [Llama 3.3 Match]  ← Semantic name matching (initials, reordering)
        │
        ▼
  [JSON Response]    ← Valid/Invalid + Metadata + Screenshot Proof
```

---

## Quick Start

```bash
# 1. Configure environment
cp .env.example .env
# Set GROQ_API_KEY and BROWSERLESS_API_KEY

# 2. Run
npm install
npm run dev
```

---

## API Reference

### POST /api/v1/validate

Validate any certificate URL from any platform.

**Request Body:**
```json
{
  "certificateUrl": "https://any-platform.com/verify/123",
  "claimedName": "Dheepak Ajith",
  "options": {
    "strictMatch": false
  }
}
```

### GET /api/v1/capabilities

Returns the engine capabilities.

```json
{
  "engine": "Universal Vision OCR (Llama 4 Scout)",
  "supports": ["Direct Images", "Websites", "React Apps", "PDFs"],
  "universal": true
}
```

---

## 🛠 Features

- **Platform Agnostic**: Works on any URL without configuration.
- **PDF Support**: Automatically renders and reads PDF certificates.
- **React/SPA Support**: Captures fully rendered snapshots of dynamic pages.
- **LLM Matching**: High-accuracy name verification using Llama 3.3.
- **Fully Browserless**: Zero local Chrome dependencies; deployable on any PaaS.

---

## Deployment

Deploy natively to **Render**, **Railway**, or **DigitalOcean**. 
1. Build: `npm run build`
2. Start: `npm start`
3. Requirements: `GROQ_API_KEY`, `BROWSERLESS_API_KEY`.

---

## Project Structure

```
src/
├── platforms/
│   ├── scraper.ts             # Universal Vision orchestration
│   ├── validationService.ts   # Main logic & caching
│   └── imageHandler.ts        # Browserless & Groq Vision
├── utils/
│   ├── nameMatcher.ts         # LLM Name Matching
│   ├── cache.ts               # NodeCache
│   └── logger.ts              # Winston
└── middleware/                # Auth & Joi Validation
```

---

## Security Notes

- Rate limited to 20 req/min per IP (configurable)
- Browser runs headless with sandboxing flags
- Cache keys are hashed — no raw URLs stored
- CORS locked to configured origins in production
