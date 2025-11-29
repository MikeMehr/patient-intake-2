## Aurora Intake

AI-assisted medical history taking built with Next.js App Router. Clinicians capture demographics/PMH/allergies up front, then patients chat through targeted follow-up questions before receiving pertinent positives/negatives, investigations, assessment, plan, and a concise summary.

### Highlights
- Pre-chat intake for sex, age, PMH, family history, and drug allergies to ground every interview
- Conversational chat UI that keeps asking questions until enough history is gathered
- Serverless API routes that validate input via `zod` and enforce JSON schemas
- OpenAI-powered interviewing and summarization (positives/negatives/investigations/assessment/plan) with deterministic mock mode
- Vitest coverage for API validation (both question flow and summary endpoint)

### Prerequisites
- Node.js 18+ (tested on v25)
- An OpenAI API key (gpt-4o-mini by default)

### Setup
1. Install dependencies
   ```bash
   npm install
   ```
2. Copy `.env.example` → `.env.local` and provide secrets:
   - `OPENAI_API_KEY` – required in production
   - `OPENAI_MODEL` – optional override (default `gpt-4o-mini`)
   - `MOCK_AI` – set `true` to bypass OpenAI and return canned conversation + summary data
3. Start the dev server
   ```bash
   npm run dev
   # visit http://localhost:3000
   ```

### Using the app
1. Enter the chief complaint plus the patient's sex, age, PMH, family history, and allergies; click “Start interview” (fields lock until reset).
2. Answer each AI-generated follow-up question in the chat panel. The assistant keeps going until it has enough information for a safe summary.
3. Review the structured positives, negatives, investigations, assessment, plan, and paragraph summary in the findings panel. Use reset to begin a new intake.

### Testing & linting
```bash
npm run test   # vitest run (uses mock mode automatically)
npm run lint   # eslint via next lint config
```

### Production notes
- Conversational turns are handled by `src/app/api/interview/route.ts`; the final summarization helper remains in `src/app/api/history/route.ts`.
- Both routes validate inputs and enforce response schemas; missing API keys or schema violations return structured JSON errors.
- The UI is not HIPAA-compliant and should not store PHI; use strictly for prototyping or in secure, approved environments.
