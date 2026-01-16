// Simple Azure OpenAI connectivity sanity test.
// Usage:
// AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... AZURE_OPENAI_DEPLOYMENT=... npm run test:azure-openai

const { OpenAI } = require("openai");

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_API_KEY;
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

if (!endpoint || !apiKey || !deployment) {
  throw new Error(
    "Missing one of AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT"
  );
}

// Build v1 base URL: https://.../openai/v1/
const base = endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
const client = new OpenAI({
  apiKey,
  baseURL: `${base}openai/v1/`,   // 👈 NO api-version here
});

async function main() {
  const response = await client.responses.create({
    model: deployment,             // "gpt-4.1-mini"
    input: "This is a test from HealthAssist AI.",
  });

  console.log(JSON.stringify(response, null, 2));
}

main().catch((err) => {
  console.error("Azure OpenAI sanity test failed:", err);
  process.exitCode = 1;
});


