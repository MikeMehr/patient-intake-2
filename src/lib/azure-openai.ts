import OpenAI from "openai";
import { ensureProdEnv } from "@/lib/required-env";

/**
 * Creates an Azure OpenAI client using env vars:
 * AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION?
 */
export function getAzureOpenAIClient() {
  ensureProdEnv(["AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT"]);
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  // Use the broadly supported preview unless overridden
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-10-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT."
    );
  }

  // Azure OpenAI base should include the deployment segment
  const baseURL = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}`;

  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultQuery: { "api-version": apiVersion },
    defaultHeaders: { "api-key": apiKey },
  });

  return { client, deployment, apiVersion };
}

/**
 * Creates an Azure OpenAI vision client (Phi-4-multimodal or other vision-capable model)
 * using env vars:
 * AZURE_PHI_ENDPOINT, AZURE_PHI_API_KEY, AZURE_PHI_DEPLOYMENT, AZURE_PHI_API_VERSION?
 */
export function getAzureVisionClient() {
  // Allow fallback to AZURE_OPENAI_API_KEY if a dedicated vision key is not set (dev convenience)
  ensureProdEnv(["AZURE_PHI_ENDPOINT", "AZURE_PHI_DEPLOYMENT"]);
  const endpoint = process.env.AZURE_PHI_ENDPOINT;
  const apiKey = process.env.AZURE_PHI_API_KEY || process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_PHI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_PHI_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "Azure vision is not configured. Set AZURE_PHI_ENDPOINT, AZURE_PHI_API_KEY, AZURE_PHI_DEPLOYMENT."
    );
  }

  const baseURL = `${endpoint.replace(/\/$/, "")}/openai/deployments/${deployment}`;

  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultQuery: { "api-version": apiVersion },
    defaultHeaders: { "api-key": apiKey },
  });

  return { client, deployment, apiVersion };
}

