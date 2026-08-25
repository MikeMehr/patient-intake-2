function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Escapes unescaped newlines/carriage-returns that appear inside JSON string
 * values. Models sometimes emit literal line-breaks in strings, which is
 * invalid JSON and causes JSON.parse to throw.
 */
export function escapeRawNewlinesInJsonStrings(raw: string): string {
  let inString = false;
  let result = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        result += ch + (raw[i + 1] ?? "");
        i += 2;
        continue;
      } else if (ch === '"') {
        inString = false;
        result += ch;
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\r") {
        result += "\\r";
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
    i++;
  }
  return result;
}

export function parseJsonValue(raw: string, label = "JSON payload"): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

export function parseJsonObject(raw: string, label = "JSON payload"): Record<string, unknown> {
  const parsed = parseJsonValue(raw, label);
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return value;
}
