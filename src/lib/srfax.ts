type SendFaxParams = {
  toFaxNumber: string;
  fileName: string;
  fileContentBase64: string;
  callerId?: string;
  senderEmail?: string;
};

type SrfaxResponse = {
  Status?: string;
  Result?: string;
  Message?: string;
  [key: string]: unknown;
};

const SRFAX_ENDPOINT = "https://www.srfax.com/SRF_SecWebSvc.php";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required SRFax env var: ${name}`);
  }
  return value.trim();
}

function toSingleLine(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function formatSrfaxFailure(
  parsed: SrfaxResponse,
  rawResponse: string,
  httpStatus: number,
): string {
  const details = [
    parsed.Message,
    typeof parsed.Result === "string" ? parsed.Result : undefined,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => toSingleLine(value));

  if (details.length > 0) {
    return `SRFax send failed (${httpStatus}): ${details.join(" | ")}`;
  }

  const fallback = toSingleLine(rawResponse);
  if (fallback.length > 0) {
    return `SRFax send failed (${httpStatus}): ${fallback.slice(0, 500)}`;
  }

  return `SRFax send failed (${httpStatus}).`;
}

export async function sendFaxViaSrfax(params: SendFaxParams): Promise<SrfaxResponse> {
  const accessId = getRequiredEnv("SRFAX_ACCESS_ID");
  const accessPassword = getRequiredEnv("SRFAX_ACCESS_PASSWORD");
  const defaultSenderEmail = process.env.SRFAX_SENDER_EMAIL?.trim() || "noreply@example.com";
  const defaultCallerId = process.env.SRFAX_CALLER_ID?.trim() || "";

  const form = new URLSearchParams();
  form.set("action", "Queue_Fax");
  form.set("access_id", accessId);
  form.set("access_pwd", accessPassword);
  form.set("sCallerID", params.callerId?.trim() || defaultCallerId);
  form.set("sSenderEmail", params.senderEmail?.trim() || defaultSenderEmail);
  form.set("sFaxType", "SINGLE");
  form.set("sToFaxNumber", params.toFaxNumber.trim());
  form.set("sFileName_1", params.fileName);
  form.set("sFileContent_1", params.fileContentBase64);
  form.set("sResponseFormat", "JSON");

  const response = await fetch(SRFAX_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const raw = await response.text();
  let parsed: SrfaxResponse = {};
  try {
    parsed = JSON.parse(raw) as SrfaxResponse;
  } catch {
    parsed = { Status: "Failed", Message: raw };
  }

  const status = String(parsed.Status || "").toLowerCase();
  if (!response.ok || !(status === "success" || status === "ok")) {
    throw new Error(formatSrfaxFailure(parsed, raw, response.status));
  }

  return parsed;
}

