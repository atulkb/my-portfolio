---
description: Project-specific Firebase, Firestore and Gemini (Firebase AI Logic) rules. Replace this folder when reusing .claude/ in another project.
---

# Firebase & Gemini Rules (this project only)

## Firestore

- All user data lives under `users/{uid}/...` subcollections. Security rules check `request.auth.uid == uid` on the path; no top-level user-owned collections.
- Firestore access goes only through repository modules in `apps/mobile/src/services/firestore/` — screens and stores never import the Firestore SDK directly.
- Validate documents with the `zod` schemas from `@portfolio/core` on read and before write.
- Keep reads cheap (free Spark tier): fetch on demand, cache in MMKV, no real-time listeners on large collections unless needed.
- Changes to `firebase/firestore.rules` require matching tests with the Firestore emulator (`@firebase/rules-unit-testing`).

## Gemini via Firebase AI Logic

- Gemini is called only through `apps/mobile/src/services/ai/` using `@react-native-firebase/ai` (Gemini Developer API backend). App Check must be enabled for AI calls in release builds.
- Model names are **never hardcoded** in call sites — read them from `src/config/ai.ts` (`AI_CONFIG.models.flash`), which can be overridden by Firebase Remote Config later.
- Prompts live in `packages/core/src/prompts/` as typed builder functions; no inline prompt strings in services or components.
- Use structured output (`responseMimeType: 'application/json'` + `responseSchema`) and re-validate the result with zod. On validation failure, retry at most `AI_CONFIG.maxRetries` (default 2) times, then surface an error.
- Cap `maxOutputTokens` per call and cache AI analysis results per `{symbol, exchange, asOfDate}` so the same day's analysis is never regenerated unless the user forces a refresh.
- Never log full prompts/responses in release builds.
