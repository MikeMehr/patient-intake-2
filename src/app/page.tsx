"use client";

import type { HistoryResponse, PatientUploads, PhqGadResults } from "@/lib/history-schema";
import PhqGadForm from "@/components/PhqGadForm";
import type {
  InterviewMessage,
  InterviewProgress,
  InterviewResponse,
  PatientProfile,
} from "@/lib/interview-schema";
import { detectBodyParts } from "@/lib/body-parts";
import {
  getSpeechLocale,
  languageOptions,
  normalizeLanguageCode,
} from "@/lib/speech-language";
import { lightCleanupTranscript, normalizePunctuation } from "@/lib/speech-transcript";
import BodyPartDiagram from "@/components/BodyPartDiagram";
import { getBodyDiagramImage } from "@/lib/body-diagram-images";
import { getSensitivePhotoContext, isPhotoUploadRequestText } from "@/app/api/interview/prompt-helpers";
import NextImage from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

// Type definitions for Web Speech API
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: any) => any) | null;
  onerror: ((this: SpeechRecognition, ev: any) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onaudiostart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onaudioend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onspeechend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

type Status = "idle" | "awaitingAi" | "awaitingPatient" | "saving" | "complete" | "paused";
type MicUiState = "idle" | "starting" | "listening";

const statusCopy: Record<Status, string> = {
  idle: "Enter your main concern to begin the interview.",
  awaitingAi: "Aurora is composing the next question...",
  awaitingPatient: "Answer the assistant's latest question below.",
  saving: "Finalizing and saving your interview...",
  complete: "Interview complete. Review the summary on the right.",
  paused: "Interview paused. Click Resume to continue.",
};

const LESION_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
const LESION_UPLOAD_COMPRESSION_THRESHOLD_BYTES = 1500 * 1024;
const PRIVACY_COMPLETION_ROUTE = "/intake/completed";
const COMPLETION_REDIRECT_FALLBACK = "https://www.health-assist.org/";

const closingMessageEnglish =
  "We have reached the end of this interview. Thank you for taking the time to answer my questions. You will soon be contacted by your physician to discuss the diagnosis and management.";

function formatElapsedTime(totalSeconds: number) {
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

const closingMessageTranslations: Record<string, string> = {
  es: "Hemos llegado al final de esta entrevista. Gracias por tomarse el tiempo para responder mis preguntas. Su médico se comunicará con usted pronto para hablar sobre el diagnóstico y el plan de manejo.",
  fr: "Nous sommes arrivés à la fin de cet entretien. Merci d'avoir pris le temps de répondre à mes questions. Votre médecin vous contactera bientôt pour discuter du diagnostic et de la prise en charge.",
  de: "Wir sind am Ende dieses Gesprächs angekommen. Vielen Dank, dass Sie sich die Zeit genommen haben, meine Fragen zu beantworten. Ihr Arzt wird sich in Kürze mit Ihnen in Verbindung setzen, um Diagnose und Behandlung zu besprechen.",
  it: "Siamo arrivati alla fine di questa intervista. Grazie per aver dedicato del tempo a rispondere alle mie domande. Il suo medico la contatterà presto per discutere diagnosi e gestione.",
  pt: "Chegamos ao fim desta entrevista. Obrigado(a) por dedicar seu tempo para responder às minhas perguntas. Em breve, seu médico entrará em contato para discutir o diagnóstico e o plano de manejo.",
  zh: "我们已到达本次访谈的结束。感谢您抽出时间回答我的问题。您的医生将很快与您联系，讨论诊断和处理方案。",
  ja: "この面接は終了です。ご質問にお答えいただきありがとうございました。担当医が近日中にご連絡し、診断と治療方針についてご説明します。",
  ko: "이 면담은 여기서 마치겠습니다. 질문에 답해 주셔서 감사합니다. 담당 의사가 곧 연락하여 진단과 치료 계획에 대해 논의할 것입니다.",
  ar: "لقد وصلنا إلى نهاية هذه المقابلة. شكرًا لك على تخصيص الوقت للإجابة عن أسئلتي. سيتواصل معك طبيبك قريبًا لمناقشة التشخيص وخطة العلاج.",
  hi: "यह साक्षात्कार अब समाप्त हो गया है। मेरे प्रश्नों के उत्तर देने के लिए आपका धन्यवाद। आपका चिकित्सक शीघ्र ही आपसे संपर्क करेगा ताकि निदान और उपचार योजना पर चर्चा की जा सके।",
  fa: "این مصاحبه به پایان رسید. از اینکه برای پاسخ به پرسش‌های من وقت گذاشتید سپاسگزارم. پزشک شما به‌زودی برای گفت‌وگو درباره تشخیص و برنامه درمان با شما تماس خواهد گرفت.",
};

const finalCommentsPromptEnglish =
  "Before you go, do you have any last questions or comments for your physician?";

const finalCommentsPromptTranslations: Record<string, string> = {
  es: "Antes de terminar, ¿tiene alguna pregunta o comentario final para su médico?",
  fr: "Avant de terminer, avez-vous des questions ou des commentaires de derniere minute pour votre medecin?",
  de: "Bevor wir abschliessen: Haben Sie noch letzte Fragen oder Kommentare fuer Ihren Arzt/Ihre Aerztin?",
  it: "Prima di concludere, ha qualche ultima domanda o commento per il suo medico?",
  pt: "Antes de terminar, voce tem alguma ultima pergunta ou comentario para o seu medico?",
  zh: "在结束之前，您还有什么想对您的医生说的最后问题或备注吗？",
  ja: "終了する前に、主治医への最後の質問やコメントはありますか？",
  ko: "마치기 전에, 담당 의사에게 전할 마지막 질문이나 의견이 있나요?",
  ar: "قبل الانتهاء، هل لديك اي اسئلة او تعليقات اخيرة لطبيبك؟",
  hi: "समाप्त करने से पहले, क्या आपके चिकित्सक के लिए कोई अंतिम प्रश्न या टिप्पणी है?",
  fa: "پیش از پایان، آیا پرسش یا نظر پایانی برای پزشک خود دارید؟",
};

const AZURE_TTS_DISABLED_SESSION_KEY = "speech.azureTtsDisabled";
const MIC_STARTING_FEEDBACK_MS = 280;

type ChatMessage = InterviewMessage;
type DiagramMarker = { xPct: number; yPct: number };
type DiagramMarkerSelection = {
  part: string;
  side?: "left" | "right";
  markers: DiagramMarker[];
};

export default function Home() {
  const router = useRouter();
  // Default from build-time env, then refresh from runtime config endpoint.
  // This prevents stale client bundles when toggling flags in Azure App Service.
  const [useAzureStt, setUseAzureStt] = useState(
    process.env.NEXT_PUBLIC_USE_AZURE_STT === "true" || process.env.USE_AZURE_STT === "true",
  );
  const [useAzureTts, setUseAzureTts] = useState(
    process.env.NEXT_PUBLIC_USE_AZURE_TTS === "true" || process.env.USE_AZURE_TTS === "true",
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const ttsDisabledForSession =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(AZURE_TTS_DISABLED_SESSION_KEY) === "1";
        if (ttsDisabledForSession) {
          setUseAzureTts(false);
        }
        const res = await fetch("/api/runtime-config", { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        if (typeof (data as any)?.useAzureStt === "boolean") setUseAzureStt((data as any).useAzureStt);
        if (typeof (data as any)?.useAzureTts === "boolean") {
          setUseAzureTts(ttsDisabledForSession ? false : (data as any).useAzureTts);
        }
      } catch {
        // Ignore — fall back to build-time defaults.
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function cleanTranscript(raw: string, lang: string): Promise<string> {
    if (!raw.trim()) return raw;
    try {
      const res = await fetch("/api/speech/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw, language: lang }),
      });
      if (!res.ok) return raw;
      const data = await res.json();
      const parsed = cleaningSchema.safeParse(data);
      if (parsed.success && parsed.data.cleaned.trim().length > 0) {
        return parsed.data.cleaned.trim();
      }
      return raw;
    } catch {
      return raw;
    }
  }
  /**
   * Convert any browser audio blob to 16-kHz mono PCM WAV —
   * the format Azure Speech REST API reliably accepts.
   */
  async function convertToWav(blob: Blob): Promise<Blob> {
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(arrayBuf);
      const mono =
        decoded.numberOfChannels === 1
          ? decoded.getChannelData(0)
          : (() => {
              const ch0 = decoded.getChannelData(0);
              const ch1 = decoded.getChannelData(1);
              const mixed = new Float32Array(ch0.length);
              for (let i = 0; i < ch0.length; i += 1) mixed[i] = (ch0[i] + ch1[i]) / 2;
              return mixed;
            })();
      let samples = mono;
      if (decoded.sampleRate !== 16000) {
        const ratio = 16000 / decoded.sampleRate;
        const newLen = Math.round(mono.length * ratio);
        const resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i += 1) resampled[i] = mono[Math.round(i / ratio)] ?? 0;
        samples = resampled;
      }
      // Trim leading/trailing silence so Azure does not hit InitialSilenceTimeout.
      // Without this, 30+ seconds of silence at the start causes Azure to give up
      // before the patient has said anything.
      {
        const SILENCE_THRESHOLD = 0.01; // ~-40 dB
        const PAD = 1600; // 100ms padding at 16 kHz to avoid clipping word edges
        let trimStart = 0;
        let trimEnd = samples.length - 1;
        while (trimStart < samples.length && Math.abs(samples[trimStart]) < SILENCE_THRESHOLD) trimStart++;
        while (trimEnd > trimStart && Math.abs(samples[trimEnd]) < SILENCE_THRESHOLD) trimEnd--;
        trimStart = Math.max(0, trimStart - PAD);
        trimEnd = Math.min(samples.length - 1, trimEnd + PAD);
        if (trimStart > 0 || trimEnd < samples.length - 1) {
          samples = samples.slice(trimStart, trimEnd + 1);
        }
      }
      const numSamples = samples.length;
      const buffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(buffer);
      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + numSamples * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true);
      view.setUint32(28, 16000 * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, numSamples * 2, true);
      for (let i = 0; i < numSamples; i += 1) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return new Blob([buffer], { type: "audio/wav" });
    } finally {
      await audioCtx.close();
    }
  }

  async function transcribeAudio(audioBlob: Blob, lang: string, attempt = 1): Promise<string> {
    const MAX_ATTEMPTS = 3;
    try {
      const wavBlob = await convertToWav(audioBlob);
      const formData = new FormData();
      const normalizedLanguage = normalizeLanguageCode(lang);
      formData.append("audio", new File([wavBlob], "recording.wav", { type: "audio/wav" }));
      formData.append("language", normalizedLanguage);
      const res = await fetch("/api/speech/stt", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
          return transcribeAudio(audioBlob, lang, attempt + 1);
        }
        console.error("[transcribeAudio] STT request failed:", res.status);
        return "";
      }
      const data = await res.json();
      const parsed = sttSchema.safeParse(data);
      if (!parsed.success) {
        console.error("[transcribeAudio] Invalid STT response:", data);
        return "";
      }
      const result = parsed.data.text.trim();
      console.log("[transcribeAudio] attempt:", attempt, "result:", JSON.stringify(result), "blobSize:", audioBlob.size);
      return result;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        return transcribeAudio(audioBlob, lang, attempt + 1);
      }
      console.error("[transcribeAudio] Error:", err);
      return "";
    }
  }
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [patientResponse, setPatientResponse] = useState("");
  const [detectedComplaints, setDetectedComplaints] = useState<string[]>([]);
  
  // Keep refs in sync with state for use in closures
  useEffect(() => {
    patientResponseRef.current = patientResponse;
  }, [patientResponse]);
  
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Also update ref when patientResponse is set via setPatientResponse
  const setPatientResponseWithRef = (value: string | ((prev: string) => string)) => {
    if (typeof value === "function") {
      setPatientResponse((prev) => {
        const newValue = value(prev);
        patientResponseRef.current = newValue;
        return newValue;
      });
    } else {
      patientResponseRef.current = value;
      setPatientResponse(value);
    }
  };
  const setSelectedDiagramMarkersWithRef = (
    value:
      | DiagramMarkerSelection[]
      | ((prev: DiagramMarkerSelection[]) => DiagramMarkerSelection[]),
  ) => {
    if (typeof value === "function") {
      setSelectedDiagramMarkers((prev) => {
        const next = value(prev);
        selectedDiagramMarkersRef.current = next;
        return next;
      });
      return;
    }
    selectedDiagramMarkersRef.current = value;
    setSelectedDiagramMarkers(value);
  };
  const getDiagramMarkerKey = (part: string, side?: "left" | "right") =>
    `${part}::${side ?? "none"}`;
  const toReadableBodyPart = (part: string) => part.replace(/_/g, " ").trim();
  const formatDiagramSelectionLabel = (selection: DiagramMarkerSelection) => {
    const partName = toReadableBodyPart(selection.part);
    return selection.side ? `${selection.side} ${partName}` : partName;
  };
  const joinWithAnd = (items: string[], languageCode: string) => {
    const normalizedLanguage = normalizeLanguageCode(languageCode).split("-")[0];
    if (items.length <= 1) return items[0] ?? "";
    if (normalizedLanguage === "fa") {
      if (items.length === 2) return `${items[0]} و ${items[1]}`;
      return `${items.slice(0, -1).join("، ")}، و ${items.at(-1)}`;
    }
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  };
  const buildDiagramMarkerResponse = (
    selections: DiagramMarkerSelection[],
    languageCode: string,
  ) => {
    const normalizedLanguage = normalizeLanguageCode(languageCode).split("-")[0];
    const uniqueLabels = Array.from(
      new Set(
        selections
          .filter((selection) => selection.markers.length > 0)
          .map((selection) => formatDiagramSelectionLabel(selection)),
      ),
    );
    if (normalizedLanguage === "fa") {
      if (uniqueLabels.length === 0) {
        return "من محل(های) درد را روی نمودار علامت زدم.";
      }
      return `من محل(های) درد را روی نمودار ${joinWithAnd(uniqueLabels, languageCode)} علامت زدم.`;
    }
    if (uniqueLabels.length === 0) {
      return "I marked the painful spot(s) on the diagram.";
    }
    return `I marked the painful spot(s) on the ${joinWithAnd(uniqueLabels, languageCode)} diagram.`;
  };
  const shouldAutoUpdateDiagramResponse = (value: string, languageCode: string) => {
    const trimmed = value.trim().toLowerCase();
    const normalizedLanguage = normalizeLanguageCode(languageCode).split("-")[0];
    if (!trimmed) return true;
    if (trimmed === "diagram marked." || trimmed === "diagram marked") return true;
    if (normalizedLanguage === "fa") {
      const rawTrimmed = value.trim();
      return /^من محل\(های\) درد را روی نمودار(?: .+)? علامت زدم\.?$/u.test(rawTrimmed);
    }
    return /^i marked the painful spot\(s\) on the .+ diagram\.?$/.test(trimmed);
  };
  /**
   * Removes diagram-marking instructions from question text when no diagram will be shown.
   * Ensures the patient is never told to "mark on the diagram" when nothing is rendered.
   */
  const stripDiagramMarkingPhrases = (text: string): string => {
    return text
      // Remove an inline diagram-marking sentence that follows sentence-ending punctuation.
      // e.g. "Where is the pain? Please mark the area(s) on the body diagram." → "Where is the pain?"
      .replace(
        /([.!?])\s+(?:[Pp]lease\s+)?(?:mark|click|tap|point\s+to)\b[^.!?\n]*?\b(?:diagram|photo|image)\b[^.!?\n]*[.!?]?/g,
        '$1',
      )
      // Remove a standalone diagram-marking sentence at start of string or after a newline
      // (optionally preceded by a numbered list marker like "2. ").
      // e.g. "Please mark the area(s) on the body diagram."
      // e.g. "2. Mark the location on the diagram."
      .replace(
        /(?:^|\n)(?:\d+\.\s+)?(?:[Pp]lease\s+)?(?:mark|click|tap|point\s+to)\b[^.!?\n]*?\b(?:diagram|photo|image)\b[^.!?\n]*[.!?]?/g,
        '\n',
      )
      .replace(/\n{2,}/g, '\n')
      .trim();
  };
  const summarizeDiagramMarkerSelection = (selection: DiagramMarkerSelection) => {
    const markerSummary = selection.markers
      .map((marker) => `(${Math.round(marker.xPct)},${Math.round(marker.yPct)})`)
      .join(", ");
    const partLabel = selection.side ? `${selection.side} ${selection.part}` : selection.part;
    return `${partLabel} markers: ${markerSummary}`;
  };
  const updateSelectionRef = (target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }
    selectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    };
  };

  const resetDraftTranscript = (reason: string) => {
    setDraftTranscript("");
    setDraftTranscriptRaw("");
    draftTranscriptRawRef.current = "";
    setShowReview(false);
    setMicWarning(null);
    setInterimTranscript("");
    interimTranscriptRef.current = "";
  };
  const appendDraftRaw = (text: string) => {
    const combined = `${draftTranscriptRawRef.current} ${text}`.replace(/\s+/g, " ").trim();
    draftTranscriptRawRef.current = combined;
    setDraftTranscriptRaw(combined);
  };
  const finalizeDraftTranscript = async () => {
    const interim = interimTranscriptRef.current.trim();
    const raw = draftTranscriptRawRef.current.trim();
    const combined = `${raw} ${interim}`.replace(/\s+/g, " ").trim();
    console.log("[finalize] raw:", JSON.stringify(raw), "interim:", JSON.stringify(interim), "combined:", JSON.stringify(combined));
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    if (!combined) {
      setMicWarning("No speech detected. Please try again.");
      setDraftTranscript("");
      setShowReview(false);
      return;
    }
    setMicWarning(null);
    setCleaningTranscript(true);
    const lightlyCleaned = lightCleanupTranscript(combined);
    console.log("[finalize] lightlyCleaned:", JSON.stringify(lightlyCleaned));
    if (!lightlyCleaned) {
      setMicWarning("No speech detected. Please try again.");
      setDraftTranscript("");
      setShowReview(false);
      setCleaningTranscript(false);
      return;
    }
    try {
      const startTime = Date.now();
      const cleaned = await cleanTranscript(lightlyCleaned, language);
      const endTime = Date.now();
      const normalized = normalizePunctuation(cleaned);
      const existingDraft = draftTranscriptRef.current.trim();
      const nextDraft = existingDraft ? `${existingDraft} ${normalized}` : normalized;
      if (hasPendingSubmission) {
        setHasPendingSubmission(false);
      }
      setDraftTranscript(nextDraft);
      setShowReview(true);
      setDraftTranscriptRaw("");
      draftTranscriptRawRef.current = "";
    } catch (error) {
      const normalized = normalizePunctuation(lightlyCleaned);
      const existingDraft = draftTranscriptRef.current.trim();
      const nextDraft = existingDraft ? `${existingDraft} ${normalized}` : normalized;
      if (hasPendingSubmission) {
        setHasPendingSubmission(false);
      }
      setDraftTranscript(nextDraft);
      setShowReview(true);
      setDraftTranscriptRaw("");
      draftTranscriptRawRef.current = "";
    } finally {
      setCleaningTranscript(false);
    }
  };
  const handleNoButtonClick = () => {
    if (hasPendingSubmission) {
      setHasPendingSubmission(false);
    }
    setDraftTranscript("No");
    setShowReview(true);
    setMicWarning(null);
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    setDraftTranscriptRaw("");
    draftTranscriptRawRef.current = "";
  };
  const markDiagramAsDone = () => {
    const markerSelections =
      selectedDiagramMarkersRef.current.length > 0
        ? selectedDiagramMarkersRef.current
        : selectedDiagramMarkers;
    const completionText = buildDiagramMarkerResponse(markerSelections, language);
    const existingDraft = draftTranscriptRef.current.trim();
    const alreadyMarked = existingDraft.toLowerCase().includes(completionText.toLowerCase());
    const nextDraft = !existingDraft
      ? completionText
      : alreadyMarked
        ? existingDraft
        : `${existingDraft} ${completionText}`;

    if (hasPendingSubmission && nextDraft.length > 0) {
      setHasPendingSubmission(false);
    }
    setDraftTranscript(nextDraft);
    setShowReview(true);
    setMicWarning(null);
  };
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [uiT, setUiT] = useState<Record<string, string>>({});
  const [isUiTranslating, setIsUiTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [invitePatientDob, setInvitePatientDob] = useState<string | null>(null);
  const [pendingHistoryResult, setPendingHistoryResult] = useState<HistoryResponse | null>(null);
  const [awaitingFinalComments, setAwaitingFinalComments] = useState(false);
  const [finalCommentsChoice, setFinalCommentsChoice] = useState<"yes" | "no" | null>(null);
  const [requestPhqGad, setRequestPhqGad] = useState(false);
  const [awaitingPhqGad, setAwaitingPhqGad] = useState(false);
  const [phqGadPendingHistory, setPhqGadPendingHistory] = useState<HistoryResponse | null>(null);
  const [hasConsented, setHasConsented] = useState(false);
  const [isInvitedFlow, setIsInvitedFlow] = useState(false);
  const [clinicName, setClinicName] = useState<string>("");
  const [physicianIdValue, setPhysicianIdValue] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [showShareLink, setShowShareLink] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);
  const [sessionSavePendingHistory, setSessionSavePendingHistory] = useState<HistoryResponse | null>(null);
  const [sex, setSex] = useState<PatientProfile["sex"]>("female");
  const [language, setLanguage] = useState<string>("");
  const [ageInput, setAgeInput] = useState("");
  const [pmh, setPmh] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [familyDoctor, setFamilyDoctor] = useState("");
  const [showAdditionalMedicalHistory, setShowAdditionalMedicalHistory] = useState(false);
  const [pharmacyNameInput, setPharmacyNameInput] = useState("");
  const [pharmacyNumberInput, setPharmacyNumberInput] = useState("");
  const [pharmacyAddressInput, setPharmacyAddressInput] = useState("");
  const [pharmacyCityInput, setPharmacyCityInput] = useState("");
  const [pharmacyInfo, setPharmacyInfo] = useState<{
    name: string;
    address: string;
    phone?: string;
    fax?: string;
  } | null>(null);
  const [searchingPharmacy, setSearchingPharmacy] = useState(false);
  const [lockedProfile, setLockedProfile] = useState<PatientProfile | null>(
    null,
  );
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [wantsToUploadImage, setWantsToUploadImage] = useState<
    boolean | null
  >(null);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<
    string | null
  >(null);
  const [imageSummary, setImageSummary] = useState<string | null>(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [pmhPhoto, setPmhPhoto] = useState<File | null>(null);
  const [pmhPreview, setPmhPreview] = useState<string | null>(null);
  const [pmhExtracted, setPmhExtracted] = useState<string>("");
  const [analyzingPmh, setAnalyzingPmh] = useState(false);
  const [medListPhoto, setMedListPhoto] = useState<File | null>(null);
  const [medListPreview, setMedListPreview] = useState<string | null>(null);
  const [medListExtracted, setMedListExtracted] = useState<string>("");
  const [analyzingMedList, setAnalyzingMedList] = useState(false);
  const [labReportSummary, setLabReportSummary] = useState<string | null>(null);
  const [previousLabReportSummary, setPreviousLabReportSummary] = useState<string | null>(null);
  const [formSummary, setFormSummary] = useState<string | null>(null);
  const [invitePatientBackground, setInvitePatientBackground] = useState<string | null>(null);
  const [interviewGuidance, setInterviewGuidance] = useState<string | null>(null);
  const [interviewMode, setInterviewMode] = useState<"conversation" | "chatbot">("conversation");
  const [isListening, setIsListening] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState<SpeechRecognition | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [isPaused, setIsPaused] = useState(false);
  const [isEndingInterview, setIsEndingInterview] = useState(false);
  const [pauseCountdownSeconds, setPauseCountdownSeconds] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [cleaningTranscript, setCleaningTranscript] = useState(false);
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<string | null>(null);
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false);
  const [showSubmitToast, setShowSubmitToast] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState<string>("");
  const [draftTranscriptRaw, setDraftTranscriptRaw] = useState<string>("");
  const [deferredIntentHint, setDeferredIntentHint] = useState<string | null>(null);
  const [showStillThinking, setShowStillThinking] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const spinnerFrames = ['+', '×', '#'];
  const [showReview, setShowReview] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [micUiState, setMicUiState] = useState<MicUiState>("idle");
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [isSmallWidth, setIsSmallWidth] = useState(false);
  // Note: short "no" auto-submit removed (per request)
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const hasUnlockedSpeechRef = useRef(false);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const audioPlaybackUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const ttsVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const chatRef = useRef<HTMLDivElement | null>(null);
  const patientResponseInputRef = useRef<HTMLTextAreaElement | null>(null);
  const patientResponseRef = useRef<string>("");
  const pendingHistoryResultRef = useRef<HistoryResponse | null>(null);
  const requestPhqGadRef = useRef(false);
  const draftTranscriptRef = useRef<string>("");
  const draftCommitDedupeRef = useRef<{ draft: string; atMs: number } | null>(null);
  const mutedWhileSpeakingRef = useRef(false);
  const hasRequestedMicPermissionRef = useRef(false);
  const recognitionStartScheduledAtRef = useRef<number | null>(null);
  const recognitionStartedAtRef = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]); // Ref to track latest messages including edits
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const pausedStatusRef = useRef<Status | null>(null); // Store the status before pausing
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCancellingRef = useRef<boolean>(false); // Track if we're intentionally cancelling
  const speakingWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null); // Ref for speech recognition to access in callbacks
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const finalizeMediaOnStopRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false); // Ref for isListening state to access in callbacks
  const interimTranscriptRef = useRef<string>(""); // Ref to track interim transcript for pause detection
  const draftTranscriptRawRef = useRef<string>("");
  const finalizeDraftOnEndRef = useRef<boolean>(false);
  const isHoldingRef = useRef<boolean>(false);
  const messagesLogRef = useRef<number>(-1);
  const typingStateLogRef = useRef<string>("");
  const draftLengthLogRef = useRef<number | null>(null);
  const statusLogRef = useRef<string | null>(null);
  const pendingStopOnResultRef = useRef<boolean>(false);
  const hadResultRef = useRef<boolean>(false);
  const lastTranslatedSummaryKeyRef = useRef<string | null>(null);
  const lastUiTranslatedLangRef = useRef<string>("");
  const consentCheckboxRef = useRef<HTMLInputElement | null>(null);
  const micStartingUiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const autoresizeDraftTextarea = useCallback(() => {
    const el = draftTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);

  const [hasPhysicianId, setHasPhysicianId] = useState<boolean>(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [addingToMessageIndex, setAddingToMessageIndex] = useState<number | null>(null);
  const [addingContent, setAddingContent] = useState<string>("");
  const [showBodyDiagram, setShowBodyDiagram] = useState(false);
  const [diagramUnmarkedWarning, setDiagramUnmarkedWarning] = useState(false);
  const [selectedBodyParts, setSelectedBodyParts] = useState<Array<{ part: string; side?: "left" | "right" | "both" }>>([]);
  const [selectedDiagramMarkers, setSelectedDiagramMarkers] = useState<DiagramMarkerSelection[]>([]);
  const selectedDiagramMarkersRef = useRef<DiagramMarkerSelection[]>([]);
  const committedBodyDiagramRef = useRef<{
    selectedParts: Array<{ part: string; side?: "left" | "right" | "both" }>;
    markersByPart: DiagramMarkerSelection[];
  }>({ selectedParts: [], markersByPart: [] });
  const [endedEarly, setEndedEarly] = useState(false);
  const [showEndInterviewConfirm, setShowEndInterviewConfirm] = useState(false);
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [showSttReviewModal, setShowSttReviewModal] = useState(false);
  const [hasDismissedSttReview, setHasDismissedSttReview] = useState(false);
  const pendingSttSubmitFnRef = useRef<(() => void) | null>(null);
  const [interviewStartTime, setInterviewStartTime] = useState<number | null>(null);
  const interviewStartTimeRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [interviewProgress, setInterviewProgress] = useState<InterviewProgress | null>(null);
  const cleaningSchema = z.object({ cleaned: z.string().min(1) });
  const sttSchema = z.object({
    text: z.string().optional().default(""),
  });
  const isEnglishLanguage = (code: string) =>
    code.trim().toLowerCase().startsWith("en");
  const getClosingMessageForLanguage = (code: string) =>
    closingMessageTranslations[code.trim().toLowerCase()] ?? closingMessageEnglish;
  const isClosingMessage = (content: string) =>
    content.trim() === closingMessageEnglish;
  const getFinalCommentsPromptForLanguage = (code: string) =>
    finalCommentsPromptTranslations[code.trim().toLowerCase()] ?? finalCommentsPromptEnglish;
  const isFinalCommentsPrompt = (content: string) =>
    content.trim() === finalCommentsPromptEnglish;
  const isSummaryMessage = (message: ChatMessage) =>
    message.role === "assistant" &&
    !!result?.summary &&
    message.content.trim() === result.summary.trim();
  const getDisplayMessageContent = (message: ChatMessage) => {
    if (message.role !== "assistant") {
      return message.content;
    }
    if (isSummaryMessage(message)) {
      if (!isEnglishLanguage(language) && translatedSummary) {
        return translatedSummary;
      }
      return message.content;
    }
    if (isClosingMessage(message.content) && !isEnglishLanguage(language)) {
      return getClosingMessageForLanguage(language);
    }
    if (isFinalCommentsPrompt(message.content) && !isEnglishLanguage(language)) {
      return getFinalCommentsPromptForLanguage(language);
    }
    return message.content;
  };
  const getSpokenMessageContent = (message: ChatMessage) => {
    if (message.role !== "assistant") {
      return message.content;
    }
    if (isSummaryMessage(message) && !isEnglishLanguage(language)) {
      return translatedSummary ?? message.content;
    }
    if (isClosingMessage(message.content) && !isEnglishLanguage(language)) {
      return getClosingMessageForLanguage(language);
    }
    if (isFinalCommentsPrompt(message.content) && !isEnglishLanguage(language)) {
      return getFinalCommentsPromptForLanguage(language);
    }
    return message.content;
  };
  const thinkingStatusLabel = showStillThinking ? "Still thinking..." : "Thinking...";

  useEffect(() => {
    if (status !== "awaitingAi" || isPaused) {
      setShowStillThinking(false);
      return;
    }

    setShowStillThinking(false);
    const stillThinkingTimeout = setTimeout(() => {
      setShowStillThinking(true);
    }, 20000);

    return () => {
      clearTimeout(stillThinkingTimeout);
    };
  }, [status, isPaused]);

  useEffect(() => {
    const isActive = isTranscribing || (status === "awaitingAi" && !isPaused);
    if (!isActive) return;
    const interval = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % 3);
    }, 300);
    return () => clearInterval(interval);
  }, [isTranscribing, status, isPaused]);

  const choosePreferredVoice = (
    voices: SpeechSynthesisVoice[],
    langTag: string,
    languageCode: string,
  ): SpeechSynthesisVoice | undefined => {
    const isEnglish = languageCode.toLowerCase().startsWith("en");
    const normalize = (value: string | undefined) => (value || "").toLowerCase();

    const findBy = (predicate: (voice: SpeechSynthesisVoice) => boolean) =>
      voices.find((voice) => predicate(voice));

    if (isEnglish) {
      const googleEnUs = findBy((voice) => {
        const name = normalize(voice.name);
        const lang = normalize(voice.lang);
        return name.includes("google") && lang === "en-us";
      });
      if (googleEnUs) return googleEnUs;

      const exactEnUs = findBy((voice) => normalize(voice.lang) === "en-us");
      if (exactEnUs) return exactEnUs;

      // iOS Safari commonly exposes Samantha/Alex instead of Google voices.
      const iosPreferred = findBy((voice) => {
        const name = normalize(voice.name);
        return name.includes("samantha") || name.includes("alex");
      });
      if (iosPreferred) return iosPreferred;
    }

    const matchLang = findBy((voice) => {
      const voiceLang = normalize(voice.lang);
      const expected = normalize(langTag);
      return (
        voiceLang.startsWith(expected) ||
        voiceLang === expected ||
        normalize(voice.name).includes("farsi") ||
        normalize(voice.name).includes("persian")
      );
    });
    if (matchLang) return matchLang;

    if (isEnglish) {
      return findBy((voice) => normalize(voice.lang).startsWith("en"));
    }

    return voices[0];
  };
  useEffect(() => {
    draftTranscriptRef.current = draftTranscript;
    autoresizeDraftTextarea();
  }, [draftTranscript, autoresizeDraftTextarea]);

  useEffect(() => {
    const summary = result?.summary?.trim();
    if (!summary) {
      setTranslatedSummary(null);
      lastTranslatedSummaryKeyRef.current = null;
      return;
    }
    if (isEnglishLanguage(language)) {
      setTranslatedSummary(null);
      lastTranslatedSummaryKeyRef.current = null;
      return;
    }
    const translationKey = `${language.trim().toLowerCase()}::${summary}`;
    if (lastTranslatedSummaryKeyRef.current === translationKey && translatedSummary) {
      return;
    }
    let isActive = true;
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: summary,
        language,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Translation failed.");
        }
        const data = (await res.json()) as { translation?: string };
        if (!isActive) return;
        if (data.translation && data.translation.trim().length > 0) {
          setTranslatedSummary(data.translation.trim());
          lastTranslatedSummaryKeyRef.current = translationKey;
        }
      })
      .catch((err) => {
        console.error("[page.tsx] Summary translation failed:", err);
        if (isActive) {
          setTranslatedSummary(null);
          lastTranslatedSummaryKeyRef.current = null;
        }
      });
    return () => {
      isActive = false;
    };
  }, [result?.summary, language, translatedSummary]);

  useEffect(() => {
    if (!language || isEnglishLanguage(language)) {
      setUiT({});
      setIsUiTranslating(false);
      lastUiTranslatedLangRef.current = "";
      return;
    }
    if (lastUiTranslatedLangRef.current === language) return;
    setIsUiTranslating(true);
    const strings: Record<string, string> = {
      consentBody:
        "Do not proceed with this interview if this is a medical emergency. Call 911 instead. This AI-guided interview is optional — you may decline and provide your history directly to your physician. I consent to the collection of my health information using Health Assist AI to prepare an AI-assisted intake summary for my physician. My information will be processed on Microsoft Azure, including servers in the United States. This tool does not provide medical advice and is not a substitute for care from your physician. I agree to the",
      startInterview: "Start interview",
      nameLabel: "Your Name (Required)",
      emailLabel: "Your Email (Required)",
      chiefComplaintLabel: "Chief complaint (Required)",
      chiefComplaintPlaceholder: "Describe your main concern (e.g., \"3 days of sore throat with fever\")",
      sexLabel: "Sex (Required)",
      ageLabel: "Age (years)",
      languageLabel: "Interview language",
      addMedHistory: "Add Medical History (Optional)",
      addMedHistorySubtitle: "Allergies, medications, past history, and pharmacy.",
      pleaseSelectLang: "Please select a language before starting the interview.",
      sttReviewTitle: "Review your answer",
      sttReviewBody: "Speech-to-text may occasionally make mistakes. Please make sure your answer is accurate before sending it to your physician.",
      sttReviewEdit: "Edit answer",
      sttReviewSubmit: "Submit",
      hearAgain: "Hear again",
      mute: "Mute",
      muted: "Muted",
      muteTitle: "Mute AI voice",
      unmuteTitle: "Unmute AI voice",
      finalCommentsQuestion: "Do you have any last comments or questions for your provider?",
      finalCommentsYes: "Yes",
      finalCommentsNo: "No",
    };
    Promise.all(
      Object.entries(strings).map(async ([key, text]) => {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language }),
        });
        const data = await res.json();
        return [key, typeof data.translation === "string" ? data.translation : text] as const;
      })
    )
      .then((entries) => {
        setUiT(Object.fromEntries(entries));
        lastUiTranslatedLangRef.current = language;
      })
      .catch(() => {
        // fall back silently to English
      })
      .finally(() => {
        setIsUiTranslating(false);
      });
  }, [language]);

  useEffect(() => {
    if (isMuted) {
      const wasSpeakingWithBrowserTts =
        typeof window !== "undefined" &&
        "speechSynthesis" in window &&
        window.speechSynthesis.speaking;
      const wasSpeakingWithAzureWebAudio = Boolean(audioSourceNodeRef.current);
      const wasSpeakingWithHtmlAudio = Boolean(
        audioPlaybackRef.current && !audioPlaybackRef.current.paused,
      );
      if (wasSpeakingWithBrowserTts || wasSpeakingWithAzureWebAudio || wasSpeakingWithHtmlAudio) {
        mutedWhileSpeakingRef.current = true;
      }

      // Stop every playback path immediately when mute is toggled on.
      stopSpeaking();

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
    } else if (mutedWhileSpeakingRef.current) {
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      if (lastMessage?.role === "assistant") {
        speakText(getSpokenMessageContent(lastMessage));
      }
      mutedWhileSpeakingRef.current = false;
    }
  }, [isMuted]);

  const showSubmitBanner = hasPendingSubmission || isSubmittingResponse;
  const showResponseBox =
    showReview || status === "awaitingPatient" || isSubmittingResponse || hasPendingSubmission;
  const isSpeechBusy =
    micUiState === "starting" ||
    isListening ||
    isHolding ||
    isTranscribing ||
    cleaningTranscript;
  const showReviewActions =
    (showReview || hasPendingSubmission) &&
    (draftTranscript.trim().length > 0 || hasPendingSubmission);
  const minPatientBubbleRows = isSmallWidth ? 3 : 2;
  const isInterviewComplete = status === "complete" || status === "saving";
  useEffect(() => {
  }, [showSubmitBanner, showResponseBox, hasPendingSubmission, isSubmittingResponse, showReview, status]);
  useEffect(() => {
  }, [hasPendingSubmission, showReview, isSubmittingResponse, status]);
  useEffect(() => {
  }, [showReviewActions, showReview, hasPendingSubmission, isSubmittingResponse, status, draftTranscript]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const media = window.matchMedia("(pointer: coarse)");
      const handleChange = () => setIsCoarsePointer(media.matches);
      handleChange();
      if (media.addEventListener) {
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
      }
      media.addListener(handleChange);
      return () => media.removeListener(handleChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // Tailwind `sm` is 640px; treat <640 as "phone-sized".
      const media = window.matchMedia("(max-width: 639px)");
      const handleChange = () => setIsSmallWidth(media.matches);
      handleChange();
      if (media.addEventListener) {
        media.addEventListener("change", handleChange);
        return () => media.removeEventListener("change", handleChange);
      }
      media.addListener(handleChange);
      return () => media.removeListener(handleChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    isHoldingRef.current = isHolding;
  }, [isHolding]);
  useEffect(() => {
    const trimmed = draftTranscript.trim();
    if (!trimmed) {
      typingStateLogRef.current = "";
      return;
    }
    const key = `${trimmed.length}|${showReview}|${status}`;
    if (key === typingStateLogRef.current) {
      return;
    }
    typingStateLogRef.current = key;
  }, [draftTranscript, showReview, status]);
  useEffect(() => {
    const nextLength = draftTranscript.trim().length;
    if (draftLengthLogRef.current === nextLength) {
      return;
    }
    draftLengthLogRef.current = nextLength;
  }, [draftTranscript, showReview, status]);
  useEffect(() => {
  }, [showReview, draftTranscript, status]);
  useEffect(() => {
    if (statusLogRef.current === status) {
      return;
    }
    statusLogRef.current = status;
  }, [status]);
  useEffect(() => {
    if (status === "awaitingPatient" && !isSubmittingResponse && lastSubmittedDraft) {
      setLastSubmittedDraft(null);
    }
  }, [status, isSubmittingResponse, lastSubmittedDraft]);
  useEffect(() => {
    if (status === "awaitingPatient" && !isSubmittingResponse && hasPendingSubmission) {
    }
  }, [status, isSubmittingResponse, hasPendingSubmission]);
  useEffect(() => {
    if (!hasPendingSubmission || messages.length === 0) {
      return;
    }
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
    }
  }, [hasPendingSubmission, messages]);
  useEffect(() => {
    if (status === "awaitingPatient" && !isSubmittingResponse && showSubmitToast) {
      setShowSubmitToast(false);
    }
  }, [status, isSubmittingResponse, showSubmitToast]);
  useEffect(() => {
  }, [isSubmittingResponse]);
  useEffect(() => {
  }, [micWarning]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasRequestedMicPermissionRef.current) return;
    hasRequestedMicPermissionRef.current = true;

    // Do not trigger getUserMedia() on load; that can create an accidental deny
    // which blocks later press-to-talk attempts. Only check current permission state.
    if (!navigator.permissions?.query) return;
    void navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        if (result.state === "denied") {
          setMicWarning("Microphone is blocked in browser settings. Please allow access and try again.");
        }
      })
      .catch(() => {
        // Ignore browser-specific permission API failures.
      });
  }, []);

  const getMedPmhSummary = () => {
    const parts = [medListExtracted, pmhExtracted]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);
    return parts.length ? parts.join("\n") : null;
  };

  const buildPatientUploads = (lesionImageUrl?: string): PatientUploads | undefined => {
    const medPmhSummary = getMedPmhSummary();
    const medPmhSourceNames = [medListPhoto?.name, pmhPhoto?.name]
      .map((name) => name?.trim())
      .filter((name): name is string => Boolean(name));

    // Use live state if available; fall back to last committed diagram data.
    const effectiveSelectedParts =
      selectedBodyParts.length > 0
        ? selectedBodyParts
        : committedBodyDiagramRef.current.selectedParts;

    const selectedParts: Array<{ part: string; side?: "left" | "right" | "both" }> = [];
    for (const part of effectiveSelectedParts) {
      const trimmedPart = part.part?.trim();
      if (!trimmedPart) continue;
      selectedParts.push({
        part: trimmedPart,
        side: part.side,
      });
    }

    const liveMarkers =
      selectedDiagramMarkersRef.current.length > 0
        ? selectedDiagramMarkersRef.current
        : selectedDiagramMarkers;
    const currentDiagramMarkerSelections =
      liveMarkers.length > 0
        ? liveMarkers
        : committedBodyDiagramRef.current.markersByPart;

    const bodyDiagramNoteParts: string[] = [];
    if (selectedParts.length > 0) {
      bodyDiagramNoteParts.push(
        selectedParts.map((part) => (part.side ? `${part.side} ${part.part}` : part.part)).join(", "),
      );
    }
    for (const markerSelection of currentDiagramMarkerSelections) {
      if (markerSelection.markers.length === 0) continue;
      bodyDiagramNoteParts.push(summarizeDiagramMarkerSelection(markerSelection));
    }

    const uploads: PatientUploads = {};

    if (medPmhSummary) {
      uploads.medPmh = {
        summary: medPmhSummary,
        sourceFileName: medPmhSourceNames.length > 0 ? medPmhSourceNames.join(", ") : undefined,
      };
    }

    if (imageSummary || lesionImageUrl || selectedImage?.name) {
      uploads.lesionImage = {
        summary: imageSummary?.trim() || undefined,
        imageUrl: lesionImageUrl,
        imageName: selectedImage?.name?.trim() || undefined,
      };
    }

    const leftFootSelection = currentDiagramMarkerSelections.find(
      (selection) => selection.part === "foot" && selection.side === "left",
    );
    if (selectedParts.length > 0 || currentDiagramMarkerSelections.length > 0) {
      uploads.bodyDiagram = {
        leftSoleMarkers: leftFootSelection?.markers?.length
          ? leftFootSelection.markers
          : undefined,
        markersByPart: currentDiagramMarkerSelections.length > 0
          ? currentDiagramMarkerSelections
          : undefined,
        selectedParts,
        note: bodyDiagramNoteParts.join(" | ") || undefined,
      };
    }

    return Object.keys(uploads).length > 0 ? uploads : undefined;
  };

  const parseMedPmhSummary = (summary: string) => {
    const medsMatch = summary.match(/Medications:\s*([\s\S]*?)(?:\n\s*Pertinent PMH:|\s*$)/i);
    const pmhMatch = summary.match(/Pertinent PMH:\s*([\s\S]*)/i);
    const meds = medsMatch?.[1]?.trim() ?? "";
    const pmhText = pmhMatch?.[1]?.trim() ?? "";
    const cleanLines = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const medsLines = cleanLines(meds).filter((line) => !/^unclear\b/i.test(line));
    const pmhLines = cleanLines(pmhText).filter((line) => !/^unclear\b/i.test(line));

    // If everything was filtered out as unclear or empty but original had content, keep originals
    const finalMeds =
      medsLines.length > 0 ? medsLines.join("\n") : meds.length > 0 ? meds : "";
    const finalPmh =
      pmhLines.length > 0 ? pmhLines.join("\n") : pmhText.length > 0 ? pmhText : "";

    return {
      meds: finalMeds.trim(),
      pmh: finalPmh.trim(),
    };
  };

  // Check for physicianId in sessionStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const physicianId = sessionStorage.getItem("physicianId");
      const invitedFlow = sessionStorage.getItem("invitedFlow") === "true";
      const invitePatientName = sessionStorage.getItem("invitePatientName");
      const invitePatientEmail = sessionStorage.getItem("invitePatientEmail");
      const inviteDob = sessionStorage.getItem("invitePatientDob");
      const ssClinicName = sessionStorage.getItem("clinicName");
      if (ssClinicName) setClinicName(ssClinicName);
      setIsInvitedFlow(invitedFlow);
      if (invitedFlow) {
        if (invitePatientName) {
          setPatientName(invitePatientName);
        }
        if (invitePatientEmail) {
          setPatientEmail(invitePatientEmail);
        }
        if (inviteDob && inviteDob.trim()) {
          setInvitePatientDob(inviteDob.trim());
        }
      }
      if (physicianId) {
        console.log("[page.tsx] Found physicianId in sessionStorage:", physicianId);
        setHasPhysicianId(true);
        setPhysicianIdValue(physicianId);
      } else {
        console.warn("[page.tsx] No physicianId found in sessionStorage. Patient should access via /intake/[slug] route.");
        setHasPhysicianId(false);
        setPhysicianIdValue(null);
      }
    }
  }, []);

  // Fetch lab report summary when patient email is entered
  useEffect(() => {
    if (patientEmail && patientEmail.includes("@") && typeof window !== "undefined") {
      fetch(`/api/invitations/lab-report`)
          .then((res) => res.json())
          .then((data) => {
            if (data.labReportSummary) {
              setLabReportSummary(data.labReportSummary);
              console.log("[page.tsx] Loaded lab report summary");
            }
            if (data.previousLabReportSummary) {
              setPreviousLabReportSummary(data.previousLabReportSummary);
              console.log("[page.tsx] Loaded previous lab report summary");
            }
            if (data.formSummary) {
              setFormSummary(data.formSummary);
              console.log("[page.tsx] Loaded form summary");
            }
            if (data.interviewGuidance) {
              setInterviewGuidance(data.interviewGuidance);
              console.log("[page.tsx] Loaded interview guidance");
            }
            if (data.patientBackground) {
              setInvitePatientBackground(data.patientBackground);
              console.log("[page.tsx] Loaded patient background");
            }
            if (data.requestPhqGad) {
              setRequestPhqGad(true);
              requestPhqGadRef.current = true;
            }
          })
          .catch((err) => {
            console.error("[page.tsx] Failed to fetch lab report summary:", err);
            // Don't show error to user - lab report is optional
          });
    }
  }, [patientEmail]);
  const statusRef = useRef<Status>("idle");

  useEffect(() => {
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);
  useEffect(() => {
    if (messages.length === messagesLogRef.current) {
      return;
    }
    messagesLogRef.current = messages.length;
    const lastMessage = messages[messages.length - 1];
  }, [messages, status, showReview]);
  // Speak assistant messages automatically and auto-start listening
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      // Get the last message
      const lastMessage = messages[messages.length - 1];
      
      // Speak if it's an assistant message, we're not already speaking, and either:
      // - status is awaitingPatient (normal question), OR
      // - status is complete and it's the final "comments or questions" message
      const spokenContent = lastMessage ? getSpokenMessageContent(lastMessage) : "";
      const shouldSpeak = lastMessage &&
        lastMessage.role === "assistant" &&
        !isSpeaking &&
        spokenContent !== lastSpokenMessageRef.current &&
        (status === "awaitingPatient" ||
         (status === "complete" && isClosingMessage(lastMessage.content)));
      
      if (shouldSpeak) {
        // This is a new assistant message that hasn't been spoken yet
        lastSpokenMessageRef.current = spokenContent;
        speakText(spokenContent);
        
        // Note: Listening will start automatically when speech ends via utterance.onend callback
        // This ensures immediate activation without delay
      }
    }
  }, [messages, status, isSpeaking, speechRecognition, isListening]);
  
  // Hide diagram when interview is complete/saving
  useEffect(() => {
    if (status === "complete" || status === "saving") {
      setShowBodyDiagram(false);
      setEditingMessageIndex(null);
      setEditingContent("");
      setAddingToMessageIndex(null);
      setAddingContent("");
    }
  }, [status]);

  // Update timer every second when interview is active
  useEffect(() => {
    if (interviewStartTime && status !== "idle" && status !== "complete" && status !== "saving") {
      const interval = setInterval(() => {
        const elapsed = Math.round((Date.now() - interviewStartTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);

      return () => clearInterval(interval);
    } else if (status === "idle") {
      setElapsedTime(0);
    }
  }, [interviewStartTime, status]);

  // Auto-start listening removed: use press-and-hold to talk.

  // Cleanup speech on unmount or status change
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
        audioPlaybackRef.current.src = "";
        audioPlaybackRef.current = null;
      }
      if (audioPlaybackUrlRef.current) {
        URL.revokeObjectURL(audioPlaybackUrlRef.current);
        audioPlaybackUrlRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore recorder stop errors on unmount
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const langTag = getSpeechLocale(language);
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) {
        console.log("[Voice Selection] No voices available yet");
        return;
      }

      console.log("[Voice Selection] Available voices:", voices.map(v => ({ name: v.name, lang: v.lang })));
      const chosenVoice = choosePreferredVoice(voices, langTag, language);
      if (chosenVoice) {
        setSelectedVoice(chosenVoice);
        console.log("[Voice Selection] Selected voice:", chosenVoice.name, chosenVoice.lang);
      }
      
      window.speechSynthesis.onvoiceschanged = null;
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      pickVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = pickVoice;
    }

    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [language]);

  const clearAzureAudioPlayback = () => {
    // Stop Web Audio API source node if playing (used for iOS-safe playback)
    if (audioSourceNodeRef.current) {
      try {
        audioSourceNodeRef.current.stop();
      } catch {
        // Already stopped — ignore
      }
      audioSourceNodeRef.current = null;
    }
    // Stop HTML Audio element — pause it and revoke the blob URL, but keep the
    // element alive in audioPlaybackRef so iOS "sticky activation" persists.
    // Nulling the ref would force a new element on the next TTS call, causing
    // iOS to treat it as an unactivated element and throw AbortError / NotAllowedError.
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.onplay = null;
      audioPlaybackRef.current.onended = null;
      audioPlaybackRef.current.onerror = null;
      audioPlaybackRef.current.onloadedmetadata = null;
      // Remove src so the element is idle (don't revoke yet — we revoke below)
      audioPlaybackRef.current.src = "";
      // Keep audioPlaybackRef.current alive for future TTS calls
    }
    if (audioPlaybackUrlRef.current) {
      URL.revokeObjectURL(audioPlaybackUrlRef.current);
      audioPlaybackUrlRef.current = null;
    }
  };

  const clearSpeakingWatchdog = () => {
    if (speakingWatchdogTimeoutRef.current) {
      clearTimeout(speakingWatchdogTimeoutRef.current);
      speakingWatchdogTimeoutRef.current = null;
    }
  };

  const armSpeakingWatchdog = (durationMs: number) => {
    clearSpeakingWatchdog();
    const safeDuration = Number.isFinite(durationMs) ? durationMs : 0;
    if (safeDuration <= 0) return;
    speakingWatchdogTimeoutRef.current = setTimeout(() => {
      // Fallback recovery when browser audio events do not fire reliably.
      clearAzureAudioPlayback();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        isCancellingRef.current = true;
        window.speechSynthesis.cancel();
        setTimeout(() => {
          isCancellingRef.current = false;
        }, 200);
      }
      speechSynthesisRef.current = null;
      setIsSpeaking(false);
      speakingWatchdogTimeoutRef.current = null;
    }, safeDuration);
  };

  const speakWithBrowserTts = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    clearAzureAudioPlayback();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = isMuted ? 0.0 : 1.0;

    const langTag = getSpeechLocale(language);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang || langTag || "en-US";
      console.log("[speakText] Using pre-selected voice:", selectedVoice.name, selectedVoice.lang);
    } else {
      const voices = window.speechSynthesis.getVoices();
      const chosen = choosePreferredVoice(voices, langTag, language);
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang || langTag || "en-US";
        console.log("[speakText] Using fallback voice:", chosen.name, chosen.lang);
      } else {
        utterance.lang = langTag || "en-US";
        console.log("[speakText] Using default lang:", utterance.lang);
      }
    }

    utterance.onstart = () => {
      setIsSpeaking(true);
      const estimatedMs = Math.max(
        4000,
        Math.min(45000, Math.ceil((text.length / 13) * 1000) + 2500),
      );
      armSpeakingWatchdog(estimatedMs);
    };

    utterance.onend = () => {
      clearSpeakingWatchdog();
      setIsSpeaking(false);
      speechSynthesisRef.current = null;
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (!isCancellingRef.current && event.error !== "interrupted") {
        console.error("Speech synthesis error:", event.error, event);
      }
      clearSpeakingWatchdog();
      setIsSpeaking(false);
      speechSynthesisRef.current = null;
    };

    speechSynthesisRef.current = utterance;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  };

  const speakWithAzureTts = async (text: string): Promise<void> => {
    if (typeof window === "undefined") {
      return;
    }
    const response = await fetch("/api/speech/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });

    if (!response.ok) {
      const error = new Error(`Azure TTS request failed (${response.status})`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    const audioBlob = await response.blob();
    if (!audioBlob.size) {
      throw new Error("Azure TTS returned empty audio.");
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speechSynthesisRef.current = null;
    }
    clearAzureAudioPlayback();

    // AudioContext path: used only if audioContextRef was set externally.
    // unlockAudioPlayback() no longer creates an AudioContext (it uses
    // HTMLAudioElement to activate iOS AVAudioSession "playback" category),
    // so ctx will be null and we fall through to the HTMLAudioElement path below.
    const ctx = audioContextRef.current;
    console.log("[speech] speakWithAzureTts: ctx exists:", !!ctx, "blob size:", audioBlob.size);
    if (ctx) {
      console.log("[speech] AudioContext state before resume:", ctx.state);
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        await ctx.resume();
        console.log("[speech] AudioContext state after resume:", ctx.state);
      }
      if (ctx.state !== "running") {
        throw new Error(`AudioContext not running after resume (${ctx.state})`);
      }
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      console.log("[speech] Decoded audio buffer: duration:", audioBuffer.duration, "channels:", audioBuffer.numberOfChannels, "sampleRate:", audioBuffer.sampleRate, "length:", audioBuffer.length);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      audioSourceNodeRef.current = source;

      setIsSpeaking(true);
      armSpeakingWatchdog(Math.ceil(audioBuffer.duration * 1000) + 1500);
      source.onended = () => {
        console.log("[speech] AudioContext source ended");
        clearSpeakingWatchdog();
        setIsSpeaking(false);
        audioSourceNodeRef.current = null;
      };
      source.start(0);
      console.log("[speech] AudioContext source started, ctx.state:", ctx.state);
      return;
    }

    // HTMLAudioElement path (all browsers — AudioContext no longer used).
    // Reuse the persistent element created during unlockAudioPlayback() so that
    // iOS "sticky activation" carries over without creating a second competing element.
    const audioUrl = URL.createObjectURL(audioBlob);
    if (!audioPlaybackRef.current) {
      audioPlaybackRef.current = new Audio();
    }
    const audio = audioPlaybackRef.current;
    audio.preload = "auto";
    audio.src = audioUrl;
    audioPlaybackUrlRef.current = audioUrl;

    audio.onplay = () => {
      setIsSpeaking(true);
      const fallbackMs = Number.isFinite(audio.duration) && audio.duration > 0
        ? Math.ceil(audio.duration * 1000) + 1500
        : Math.max(4000, Math.min(45000, Math.ceil((text.length / 13) * 1000) + 2500));
      armSpeakingWatchdog(fallbackMs);
    };
    audio.onended = () => {
      clearSpeakingWatchdog();
      setIsSpeaking(false);
      clearAzureAudioPlayback();
    };
    audio.onerror = () => {
      clearSpeakingWatchdog();
      setIsSpeaking(false);
      clearAzureAudioPlayback();
    };

    await audio.play();
  };

  const speakText = (text: string) => {
    if (!text.trim().length || isMuted) {
      setIsSpeaking(false);
      return;
    }

    if (!useAzureTts) {
      speakWithBrowserTts(text);
      return;
    }

    void (async () => {
      try {
        await speakWithAzureTts(text);
      } catch (error) {
        const status =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof (error as { status?: unknown }).status === "number"
            ? ((error as { status: number }).status as number)
            : null;
        if (status === 404 || status === 405) {
          // Route unavailable in this deployment; avoid repeatedly failing Azure TTS calls.
          setUseAzureTts(false);
          if (typeof window !== "undefined") {
            window.sessionStorage.setItem(AZURE_TTS_DISABLED_SESSION_KEY, "1");
          }
        }
        console.warn("[speech] Azure TTS failed, falling back to browser TTS:", error);
        speakWithBrowserTts(text);
      }
    })();
  };

  // Minimal silent WAV: 44100Hz, mono, 16-bit PCM, 1 sample (46 bytes)
  const SILENT_WAV_URI = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAQARKwAAIhYAQACABAAZGF0YQIAAAAAAAA==";

  /** Play a silent audio clip during a user gesture to activate iOS AVAudioSession
   *  in "playback" category. This bypasses the ringer switch and stays active for
   *  subsequent HTMLAudioElement.play() calls from async code (fetch callbacks, etc.).
   *  AudioContext used the "ambient" category which respects the ringer switch and
   *  would end immediately on iOS when the session was interrupted.
   *
   *  We create the persistent audio element ONCE here and keep it for the whole session.
   *  TTS reuses the same element so iOS "sticky activation" carries over — no second
   *  unlock needed and no two elements competing for the audio session (AbortError). */
  const unlockAudioPlayback = () => {
    if (typeof window === "undefined") return;
    try {
      if (!audioPlaybackRef.current) {
        audioPlaybackRef.current = new Audio();
      }
      const audio = audioPlaybackRef.current;
      audio.src = SILENT_WAV_URI;
      void audio.play().then(() => { audio.pause(); audio.src = ""; }).catch((err) => {
        console.warn("[speech] Audio unlock play failed:", err);
      });
      console.log("[speech] HTMLAudioElement unlock initiated (playback session)");
    } catch (error) {
      console.warn("[speech] Unable to unlock audio session:", error);
    }
  };

  const unlockSpeechSynthesis = () => {
    // Also unlock AudioContext for Azure TTS on iOS
    unlockAudioPlayback();

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    if (hasUnlockedSpeechRef.current) {
      return;
    }
    try {
      // Prime speech on a direct user gesture so iOS allows later async TTS.
      const unlockUtterance = new SpeechSynthesisUtterance(" ");
      unlockUtterance.volume = 0;
      unlockUtterance.rate = 1;
      unlockUtterance.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(unlockUtterance);
      window.speechSynthesis.resume();
      hasUnlockedSpeechRef.current = true;
    } catch (error) {
      console.warn("[speech] Unable to unlock speech synthesis:", error);
    }
  };

  const stopSpeaking = () => {
    clearSpeakingWatchdog();
    clearAzureAudioPlayback();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      // Set flag BEFORE cancelling to prevent error logging
      isCancellingRef.current = true;
      
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      // Clear the current utterance reference
      if (speechSynthesisRef.current) {
        speechSynthesisRef.current = null;
      }
      
      setIsSpeaking(false);
      
      // Reset flag after a delay to handle any delayed error events
      setTimeout(() => {
        isCancellingRef.current = false;
      }, 200);
    }
    setIsSpeaking(false);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const resumeInterruptedAudio = () => {
      if (isMuted) return;

      const ctx = audioContextRef.current;
      if (ctx && (ctx.state === "suspended" || ctx.state === "interrupted")) {
        void ctx.resume().catch((error) => {
          console.warn("[speech] AudioContext resume failed after interruption:", error);
        });
      }

      if ("speechSynthesis" in window && window.speechSynthesis.paused) {
        try {
          window.speechSynthesis.resume();
        } catch (error) {
          console.warn("[speech] speechSynthesis resume failed after interruption:", error);
        }
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        resumeInterruptedAudio();
      }
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("pageshow", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("pageshow", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [isMuted]);

  // The TTS avatar video runs continuously (muted, autoPlay) and is shown/hidden
  // via CSS visibility. We deliberately avoid calling video.play()/pause() from JS
  // because any JS-triggered media state change during active AudioContext playback
  // causes iOS to reconfigure AVAudioSession, which interrupts TTS audio.

  // Initialize speech recognition
  useEffect(() => {
    if (useAzureStt) {
      return;
    }
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        // Set recognition properties in correct order
        recognition.lang = getSpeechLocale(language);
        recognition.continuous = true;
        recognition.interimResults = true;
        
        // Track the last time we received a result for no-speech detection
        let lastResultTime = Date.now();

        // Helper function to reset the pause timeout
        recognition.onstart = () => {
          recognitionStartedAtRef.current = Date.now();
          setIsListening(true);
          isListeningRef.current = true;
          setMicUiListeningWithFeedbackDelay();
          lastResultTime = Date.now();
          setError(null); // Clear any previous errors
          hadResultRef.current = false;
        };
        recognition.onaudiostart = () => {
        };
        recognition.onaudioend = () => {
        };
        recognition.onspeechstart = () => {
        };
        recognition.onspeechend = () => {
        };

        recognition.onresult = (event: any) => {
          // Update last result time whenever we get any result (including interim)
          // This tracks when the patient last spoke
          lastResultTime = Date.now();
          hadResultRef.current = true;
          
          // If paused or not awaiting patient, ignore incoming speech
          if (statusRef.current !== "awaitingPatient" || isPaused) {
            return;
          }
          if (!isHoldingRef.current && !finalizeDraftOnEndRef.current) {
            return;
          }
          
          let currentInterim = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + " ";
            } else {
              currentInterim += transcript;
            }
          }

          // Track interim results for finalization (no live transcript UI)
          if (currentInterim) {
            // Track interim for finalization but do not display live transcript
            interimTranscriptRef.current = currentInterim;
          } else if (!finalTranscript && finalizeDraftOnEndRef.current && interimTranscriptRef.current.trim().length > 0) {
            // Keep last interim when we're finalizing to avoid dropping short replies.
          } else if (!finalTranscript && isHoldingRef.current && interimTranscriptRef.current.trim().length > 0) {
            // Keep interim results while still holding, even if no new interim
          } else {
            interimTranscriptRef.current = ""; // Update ref immediately
          }

          // Add final transcript to the draft buffer
          if (finalTranscript) {
            appendDraftRaw(finalTranscript);
            interimTranscriptRef.current = "";
          }
          if (finalizeDraftOnEndRef.current && !isHoldingRef.current) {
            finalizeDraftOnEndRef.current = false;
            void finalizeDraftTranscript();
            return;
          }
          if (pendingStopOnResultRef.current && !isHoldingRef.current) {
            pendingStopOnResultRef.current = false;
            try {
              speechRecognitionRef.current?.stop();
            } catch {
              // Ignore stop errors
            }
          }
        };

        recognition.onerror = (event: any) => {
          // Handle different error types
          if (event.error === "not-allowed") {
            // Microphone permission denied
            console.error("Speech recognition error: Microphone access denied");
            setIsListening(false);
            isListeningRef.current = false;
            setMicUiState("idle");
            setError("Microphone access denied. Please enable microphone permissions.");
          } else if (event.error === "no-speech") {
            // "no-speech" is normal - don't log as error, just handle it
            // This can happen when the user pauses or hasn't started speaking yet
            const timeSinceStart = Date.now() - lastResultTime;
            const hasAnyDraft =
              draftTranscriptRawRef.current.trim().length > 0 ||
              interimTranscriptRef.current.trim().length > 0;
            if (timeSinceStart > 10000 && !hasAnyDraft) {
              // Been listening for more than 10 seconds with no speech at all and no response
              console.log("Speech recognition: No speech detected after 10 seconds");
              setMicWarning("No speech detected. Please try again.");
            }
            // Otherwise, continue listening
          } else if (event.error === "aborted") {
            // User stopped manually or we stopped it programmatically - this is normal
            setIsListening(false);
            isListeningRef.current = false;
            setMicUiState("idle");
          } else if (event.error === "network") {
            // Network error
            console.error("Speech recognition error: Network issue");
            setIsListening(false);
            isListeningRef.current = false;
            setMicUiState("idle");
            setError("Network error. Please check your connection and try again.");
          } else if (event.error === "audio-capture") {
            // Audio capture error
            console.error("Speech recognition error: Audio capture failed");
            setIsListening(false);
            isListeningRef.current = false;
            setMicUiState("idle");
            setError("Audio capture failed. Please check your microphone.");
          } else {
            // Other errors - log but don't show to user unless critical
            console.warn("Speech recognition warning:", event.error);
            // Don't stop listening for minor errors - let it continue
            if (event.error === "service-not-allowed" || event.error === "bad-grammar") {
              setIsListening(false);
              isListeningRef.current = false;
              setMicUiState("idle");
              setError("Voice input is not available on this browser.");
            }
          }
        };

        recognition.onend = () => {
          console.log("[Speech Recognition] onend - stopped listening, status:", statusRef.current);
          const shouldRestart =
            statusRef.current === "awaitingPatient" &&
            isHoldingRef.current &&
            !hadResultRef.current &&
            !isCancellingRef.current;
          if (shouldRestart) {
            try {
              setMicUiState("starting");
              speechRecognitionRef.current?.start();
              isListeningRef.current = true;
              setIsListening(true);
            } catch {
              setIsListening(false);
              isListeningRef.current = false;
              setMicUiState("idle");
            }
            return;
          }
          setIsListening(false);
          isListeningRef.current = false;
          setMicUiState("idle");
          const interimAtEnd = interimTranscriptRef.current.trim();
          // Always preserve any interim results when holding, even if short
          // This ensures speech that was detected but not finalized gets captured
          if (isHoldingRef.current && interimAtEnd.length > 0) {
            appendDraftRaw(interimAtEnd);
            interimTranscriptRef.current = "";
          }
          if (finalizeDraftOnEndRef.current) {
            const hasAnyDraft =
              draftTranscriptRawRef.current.trim().length > 0 ||
              interimTranscriptRef.current.trim().length > 0;
            if (!hasAnyDraft) {
              setMicWarning("No speech detected. Please try again.");
              setShowReview(false);
              finalizeDraftOnEndRef.current = false;
              return;
            }
            finalizeDraftOnEndRef.current = false;
            void finalizeDraftTranscript();
            return;
          }
          interimTranscriptRef.current = "";
        };

        setSpeechRecognition(recognition);
        speechRecognitionRef.current = recognition;
        recognition.lang = getSpeechLocale(language);
      } else {
        console.warn("Speech recognition not supported in this browser");
      }
    }
  }, [status, language, useAzureStt]);

  const setMicUiListeningWithFeedbackDelay = () => {
    const scheduledAt = recognitionStartScheduledAtRef.current;
    const elapsed = scheduledAt ? Date.now() - scheduledAt : MIC_STARTING_FEEDBACK_MS;
    const delayMs = Math.max(0, MIC_STARTING_FEEDBACK_MS - elapsed);

    if (micStartingUiTimeoutRef.current) {
      clearTimeout(micStartingUiTimeoutRef.current);
      micStartingUiTimeoutRef.current = null;
    }

    micStartingUiTimeoutRef.current = setTimeout(() => {
      micStartingUiTimeoutRef.current = null;
      if (isHoldingRef.current || isListeningRef.current) {
        setMicUiState("listening");
      }
    }, delayMs);
  };

  const startListening = async (options?: { allowDuringReview?: boolean }) => {
    // Capture current selection before we start listening (in case focus shifts)
    updateSelectionRef(patientResponseInputRef.current);
    const allowDuringReview = options?.allowDuringReview ?? false;
    if (status !== "awaitingPatient") return;
    setMicUiState("starting");
    setIsTranscribing(false);
    if (isSpeaking) {
      stopSpeaking();
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (cleaningTranscript) {
      setMicUiState("idle");
      return;
    }
    if (showReview && !allowDuringReview) {
      setMicUiState("idle");
      return;
    }
    if (useAzureStt && status === "awaitingPatient") {
      try {
        setError(null);
        if (hasPendingSubmission) {
          setHasPendingSubmission(false);
        }
        setDraftTranscriptRaw("");
        draftTranscriptRawRef.current = "";
        setInterimTranscript("");
        interimTranscriptRef.current = "";
        const hasDraft = draftTranscriptRef.current.trim().length > 0;
        if (!showReview && !hasDraft) {
          resetDraftTranscript("startListening-azure");
        } else {
          setMicWarning(null);
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          try {
            mediaRecorderRef.current.stop();
          } catch {
            // Ignore stop errors from previous recorder
          }
        }
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });

        // Recording format doesn't matter for Azure STT — we convert to WAV
        // before uploading. Prefer webm/opus for best Chrome recording quality.
        const mimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/ogg;codecs=opus",
          "audio/webm",
        ];
        const selectedMimeType = mimeCandidates.find((mime) =>
          typeof MediaRecorder !== "undefined" &&
          MediaRecorder.isTypeSupported?.(mime),
        );
        const recorder = selectedMimeType
          ? new MediaRecorder(stream, { mimeType: selectedMimeType })
          : new MediaRecorder(stream);

        mediaChunksRef.current = [];
        mediaStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        finalizeMediaOnStopRef.current = false;

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            mediaChunksRef.current.push(event.data);
          }
        };

        recorder.onerror = () => {
          setIsListening(false);
          isListeningRef.current = false;
          setMicUiState("idle");
          setError("Audio capture failed. Please check your microphone.");
        };

        recorder.onstop = async () => {
          setIsListening(false);
          isListeningRef.current = false;
          setMicUiState("idle");
          const shouldFinalize = finalizeMediaOnStopRef.current;
          finalizeMediaOnStopRef.current = false;
          const chunks = [...mediaChunksRef.current];
          mediaChunksRef.current = [];

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }

          if (!shouldFinalize) {
            setIsTranscribing(false);
            return;
          }

          setIsTranscribing(true);
          try {
            const audioBlob = new Blob(chunks, {
              type: recorder.mimeType || "audio/webm",
            });

            if (!audioBlob.size) {
              setMicWarning("No speech detected. Please try again.");
              return;
            }

            const rawTranscript = await transcribeAudio(audioBlob, language);
            if (!rawTranscript) {
              setMicWarning("We could not transcribe your speech. Please try again.");
              return;
            }

            appendDraftRaw(rawTranscript);
            await finalizeDraftTranscript();
          } finally {
            setIsTranscribing(false);
          }
        };

        recorder.start(250);
        setIsHolding(true);
        isHoldingRef.current = true;
        setIsListening(true);
        isListeningRef.current = true;
        setMicUiListeningWithFeedbackDelay();
        return;
      } catch (error) {
        setIsListening(false);
        isListeningRef.current = false;
        setMicUiState("idle");
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setError("Microphone access denied. Please enable microphone permissions.");
        } else {
          console.error("Error starting Azure STT recording:", error);
          setError("Unable to start voice input. Please try again.");
        }
        return;
      }
    }
    if (speechRecognition && status === "awaitingPatient") {
      try {
        if (hasPendingSubmission) {
          setHasPendingSubmission(false);
        }
        setDraftTranscriptRaw("");
        draftTranscriptRawRef.current = "";
        setInterimTranscript("");
        interimTranscriptRef.current = "";
        if (isListeningRef.current) {
          try {
            speechRecognition.stop();
          } catch {
            // ignore stop errors
          }
          setIsListening(false);
          isListeningRef.current = false;
        }
        // Create a fresh recognition instance for each attempt to avoid state corruption
        const freshRecognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        freshRecognition.lang = getSpeechLocale(language);
        freshRecognition.continuous = true;
        freshRecognition.interimResults = true;
        // Re-apply all event handlers to the fresh instance
        freshRecognition.onstart = speechRecognition.onstart;
        freshRecognition.onresult = speechRecognition.onresult;
        freshRecognition.onend = speechRecognition.onend;
        freshRecognition.onerror = speechRecognition.onerror;
        setSpeechRecognition(freshRecognition);
        speechRecognitionRef.current = freshRecognition;
        pendingStopOnResultRef.current = false;
        const hasDraft = draftTranscriptRef.current.trim().length > 0;
        if (!showReview && !hasDraft) {
          resetDraftTranscript("startListening");
        } else {
          setMicWarning(null);
        }
        setIsHolding(true);
        isHoldingRef.current = true;
        finalizeDraftOnEndRef.current = false;
        // Removed mic priming as it may interfere with speech recognition
        recognitionStartScheduledAtRef.current = Date.now();
        speechRecognitionRef.current?.start();
        isListeningRef.current = true;
        return;
      } catch (error) {
        // Check if error is because recognition is already started
        if (error instanceof Error && error.name === "InvalidStateError") {
          console.log("[Speech Recognition] Recognition already started");
          setIsListening(true);
          isListeningRef.current = true;
          setMicUiListeningWithFeedbackDelay();
          return;
        } else {
          console.error("Error starting speech recognition:", error);
          setMicUiState("idle");
          setError("Unable to start voice input. Please try again.");
          return;
        }
      }
    }
    setMicUiState("idle");
  };

  const stopListening = (finalizeDraft = false) => {
    if (micStartingUiTimeoutRef.current) {
      clearTimeout(micStartingUiTimeoutRef.current);
      micStartingUiTimeoutRef.current = null;
    }
    setIsHolding(false);
    isHoldingRef.current = false;
    setMicUiState("idle");
    if (useAzureStt) {
      finalizeMediaOnStopRef.current = finalizeDraft;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        if (finalizeDraft) {
          setIsTranscribing(true);
        }
        try {
          recorder.stop();
        } catch {
          // Ignore recorder stop errors
        }
      } else if (finalizeDraft) {
        setMicWarning("No speech detected. Please try again.");
        setIsTranscribing(false);
      }
      setIsListening(false);
      isListeningRef.current = false;
      return;
    }
    const rawLength = draftTranscriptRawRef.current.length;
    const interimLength = interimTranscriptRef.current.length;

    if (finalizeDraft && (rawLength > 0 || interimLength > 0)) {
      // If we have transcripts and want to finalize, do it immediately
      void finalizeDraftTranscript();
      finalizeDraftOnEndRef.current = false;
    } else if (finalizeDraft) {
      // Wait for late results before showing no-speech
      finalizeDraftOnEndRef.current = true;
    }

    if (speechRecognition) {
      speechRecognition.stop();
      setIsListening(false);
      isListeningRef.current = false;
    }
  };

  const toggleListening = (options?: { allowDuringReview?: boolean }) => {
    if (micUiState === "starting") {
      return;
    }
    if (isHoldingRef.current || isListeningRef.current) {
      stopListening(true);
      return;
    }
    void startListening(options);
  };

  const commitDraftToResponse = (autoSubmit = false) => {
    const draft = draftTranscript.trim();
    if (!draft) {
      return;
    }
    if (autoSubmit) {
      setIsSubmittingResponse(true);
      setLastSubmittedDraft(draft);
      setHasPendingSubmission(true);
      setShowSubmitToast(true);
      setShowReview(false);
      setDraftTranscript("");
      setDraftTranscriptRaw("");
      draftTranscriptRawRef.current = "";
      setInterimTranscript("");
      interimTranscriptRef.current = "";
    }
    setPatientResponseWithRef(draft);
    if (patientResponseInputRef.current) {
      requestAnimationFrame(() => {
        patientResponseInputRef.current?.focus();
        const pos = draft.length;
        patientResponseInputRef.current?.setSelectionRange(pos, pos);
      });
    }
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    const shouldAutoSubmit = autoSubmit && statusRef.current === "awaitingPatient";
    if (shouldAutoSubmit) {
      void handlePatientSubmit();
    }
  };

  const commitDraftToResponseOnce = (autoSubmit = false) => {
    const draft = draftTranscriptRef.current.trim();
    if (!draft) {
      return;
    }
    const now = Date.now();
    const previous = draftCommitDedupeRef.current;
    if (previous && previous.draft === draft && now - previous.atMs < 800) {
      return;
    }
    draftCommitDedupeRef.current = { draft, atMs: now };
    commitDraftToResponse(autoSubmit);
  };

  const handleSubmitWithSttReview = (fn: () => void) => {
    if (!hasDismissedSttReview) {
      pendingSttSubmitFnRef.current = fn;
      setShowSttReviewModal(true);
    } else {
      fn();
    }
  };

  const redoDraftTranscript = () => {
    resetDraftTranscript("redo");
  };

  const handlePreInterviewEnterKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (status !== "idle" || event.key !== "Enter") return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Keep multiline fields usable while blocking accidental form submit from single-line controls.
    if (target instanceof HTMLTextAreaElement) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      event.preventDefault();
    }
  };

  const isConsentErrorMessage = (value: string | null): boolean => {
    if (!value) return false;
    const normalized = value.toLowerCase();
    return normalized.includes("consent") || normalized.includes("acknowledgement");
  };

  async function handleStart(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    unlockSpeechSynthesis();
    if (status === "awaitingAi") {
      return;
    }

    setIsEndingInterview(false);

    // Check for physician ID before starting
    if (typeof window !== "undefined") {
      const physicianId = sessionStorage.getItem("physicianId");
      if (!physicianId) {
        // TEMP: Allow testing without physician ID
        console.warn("[TEST MODE] No physicianId found, using test-physician-id");
        sessionStorage.setItem("physicianId", "test-physician-id");
        setPhysicianIdValue("test-physician-id");
      } else {
        setPhysicianIdValue(physicianId);
      }
    }

    if (!hasConsented) {
      setError("Please check the acknowledgement/consent checkbox to proceed.");
      const consentCheckbox = consentCheckboxRef.current;
      if (consentCheckbox) {
        consentCheckbox.scrollIntoView({ behavior: "smooth", block: "center" });
        consentCheckbox.focus({ preventScroll: true });
      }
      return;
    }

    const trimmed = chiefComplaint.trim();
    if (trimmed.length < 3) {
      setError("Please describe the complaint in a few words.");
      return;
    }

    if (!patientName.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!patientEmail.trim() || !patientEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    // Prevent duplicate submissions if a session already exists for this patient
    try {
      const dupRes = await fetch("/api/sessions/check");
      if (dupRes.ok) {
        const data = (await dupRes.json()) as { exists?: boolean };
        if (data.exists) {
          setError("You have already completed the history taking.");
          return;
        }
      } else {
        console.error("[page.tsx] handleStart - duplicate check failed", dupRes.status);
      }
    } catch (err) {
      console.error("[page.tsx] handleStart - duplicate check error", err);
      // Continue if check fails; do not block the user on check errors
    }

    const ageValue = Number(ageInput);
    if (!Number.isFinite(ageValue) || ageValue < 0) {
      setError("Please enter a valid age in years.");
      return;
    }

    // For testing: allow blank fields - use "None" or "Unknown" as defaults if empty
    // Apply defaults immediately, before any validation
    const pmhFinal = pmh.trim().length > 0 ? pmh.trim() : "None";
    const familyFinal = familyHistory.trim().length > 0 ? familyHistory.trim() : "None";
    const medsFinal = currentMedications.trim().length > 0 ? currentMedications.trim() : "None";
    const allergiesFinal = allergies.trim().length > 0 ? allergies.trim() : "None";
    const familyDoctorFinal = familyDoctor.trim().length > 0 ? familyDoctor.trim() : "Unknown";
    const pharmacyNameFinal = (pharmacyInfo?.name ?? pharmacyNameInput).trim();
    const pharmacyAddressRaw = (pharmacyInfo?.address ?? pharmacyAddressInput).trim();
    const pharmacyCityFinal = pharmacyCityInput.trim();
    const pharmacyAddressFinal =
      pharmacyAddressRaw ||
      [pharmacyAddressInput.trim(), pharmacyCityFinal]
        .filter((item) => item.length > 0)
        .join(", ");
    const pharmacyPhoneFinal = (pharmacyInfo?.phone ?? "").trim();
    const pharmacyFaxFinal = (pharmacyInfo?.fax ?? "").trim();
    const pharmacyNumberFinal = pharmacyNumberInput.trim();

    const profile: PatientProfile = {
      sex,
      age: ageValue,
      dateOfBirth: isInvitedFlow && invitePatientDob ? invitePatientDob : undefined,
      pmh: pmhFinal,
      familyHistory: familyFinal,
      familyDoctor: familyDoctorFinal,
      currentMedications: medsFinal,
      allergies: allergiesFinal,
      pharmacyName: pharmacyNameFinal || undefined,
      pharmacyNumber: pharmacyNumberFinal || undefined,
      pharmacyAddress: pharmacyAddressFinal || undefined,
      pharmacyCity: pharmacyCityFinal || undefined,
      pharmacyPhone: pharmacyPhoneFinal || undefined,
      pharmacyFax: pharmacyFaxFinal || undefined,
    };

    setPmh(pmhFinal);
    setFamilyHistory(familyFinal);
    setFamilyDoctor(familyDoctorFinal);
    setCurrentMedications(medsFinal);
    setAllergies(allergiesFinal);
    setAgeInput(String(ageValue));
    setLockedProfile(profile);

    setChiefComplaint(trimmed);
    setDeferredIntentHint(null);
    setInterviewProgress(null);
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setDetectedComplaints([]);
    setError(null);
    
    // Fetch lab report summaries and form summary if not already fetched (in case useEffect didn't complete)
    let finalLabReportSummary = labReportSummary;
    let finalPreviousLabReportSummary = previousLabReportSummary;
    let finalFormSummary = formSummary;
    if (process.env.NODE_ENV === "development") {
      console.log("[page.tsx] handleStart - Summary presence", {
        hasLabReportSummary: Boolean(finalLabReportSummary),
        hasPreviousLabReportSummary: Boolean(finalPreviousLabReportSummary),
        hasFormSummary: Boolean(finalFormSummary),
      });
    }
    
    if ((!finalLabReportSummary || !finalPreviousLabReportSummary || !finalFormSummary) && typeof window !== "undefined") {
      const physicianId = sessionStorage.getItem("physicianId");
      if (process.env.NODE_ENV === "development") {
        console.log("[page.tsx] handleStart - Fetching invitation summaries");
      }
      
      if (physicianId && patientEmail && patientEmail.includes("@")) {
        try {
          const response = await fetch(`/api/invitations/lab-report`);
          if (process.env.NODE_ENV === "development") {
            console.log("[page.tsx] handleStart - Summary fetch status:", response.status);
          }
          
          if (response.ok) {
            const data = await response.json();
            if (data.labReportSummary) {
              finalLabReportSummary = data.labReportSummary;
              setLabReportSummary(data.labReportSummary);
            }
            
            if (data.previousLabReportSummary) {
              finalPreviousLabReportSummary = data.previousLabReportSummary;
              setPreviousLabReportSummary(data.previousLabReportSummary);
            }
            
            if (data.formSummary) {
              finalFormSummary = data.formSummary;
              setFormSummary(data.formSummary);
            }
          } else {
            console.error("[page.tsx] handleStart - Summary fetch failed:", response.status);
          }
        } catch (err) {
          console.error("[page.tsx] handleStart - Failed to fetch lab report summaries:", err);
          // Continue without lab report summaries - they're optional
        }
      } else {
        if (process.env.NODE_ENV === "development") {
          console.log("[page.tsx] handleStart - Missing physician context; skipping summary fetch");
        }
      }
    }
    
    // Start timer when interview begins
    const startTime = Date.now();
    setInterviewStartTime(startTime);
    interviewStartTimeRef.current = startTime;
    setStatus("awaitingAi");

    try {
      // Start each interview with a clean photo prompt state.
      setImageSummary(null);
      setAnalyzingImage(false);

      const physicianIdToUse =
        physicianIdValue || (typeof window !== "undefined" ? sessionStorage.getItem("physicianId") : null);
      if (!physicianIdToUse) {
        setStatus("idle");
        setError("You weren’t invited to complete this form.");
        return;
      }

      const turn = await requestTurn(
        trimmed,
        profile,
        [],
        null,
        finalLabReportSummary,
        finalPreviousLabReportSummary,
        finalFormSummary,
        interviewGuidance,
        getMedPmhSummary(),
        invitePatientBackground || null,
        patientEmail.trim(),
        physicianIdToUse,
        language,
        deferredIntentHint,
      );
      processTurn(turn);
      const complaintLower = trimmed.toLowerCase();
      const skinKeywords = [
        "rash",
        "lesion",
        "skin",
        "mole",
        "spot",
        "bump",
        "hives",
        "blister",
        "ulcer",
      ];
      const shouldOfferImage = skinKeywords.some((keyword) =>
        complaintLower.includes(keyword),
      );
      const sensitiveComplaintContext = getSensitivePhotoContext({
        sex: profile.sex,
        textBlocks: [trimmed],
      });
      // Preserve any explicit photo prompt set by processTurn(turn).
      // Only auto-enable for skin complaints; do not force-hide otherwise.
      if (
        shouldOfferImage &&
        !sensitiveComplaintContext.suppressPhotoRequest &&
        !selectedImage &&
        !selectedImagePreview
      ) {
        setShowImagePrompt(true);
        setWantsToUploadImage(null);
      }
      if (selectedImagePreview) {
        URL.revokeObjectURL(selectedImagePreview);
      }
      setSelectedImage(null);
      setSelectedImagePreview(null);
    } catch (err) {
      console.error(err);
      setStatus("idle");
      setError(
        err instanceof Error
          ? err.message
          : "Unable to start the interview. Please try again.",
      );
    }
  }

  async function handlePatientSubmit(
    event?: React.FormEvent<HTMLFormElement>,
    submitOptions?: { finalChoiceOverride?: "yes" | "no" },
  ): Promise<void> {
    if (event) {
      event.preventDefault();
    }
    setSessionSaveError(null);
    setIsSubmittingResponse(true);
    
    // Don't allow submission when paused
    if (isPaused || status === "paused") {
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }
    
    // Use ref to check current status (might have changed)
    const currentStatus = statusRef.current;
    if (currentStatus !== "awaitingPatient") {
      console.log("[handlePatientSubmit] Not awaiting patient, status:", currentStatus);
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }
    
    // Stop listening when submitting
    stopListening();
    
    const profile = lockedProfile;
    if (!profile) {
      setError("Please start the interview before responding.");
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }
    
    // Use ref to get current response value
    const currentResponse = patientResponseRef.current.trim();
    let trimmed = currentResponse;

    const lastMessage = messagesRef.current[messagesRef.current.length - 1];
    const isFinalCommentsTurn =
      awaitingFinalComments ||
      (lastMessage?.role === "assistant" && isFinalCommentsPrompt(lastMessage.content));
    const effectiveFinalCommentsChoice =
      submitOptions?.finalChoiceOverride ?? finalCommentsChoice;

    const finalizeFinalCommentsTurn = async (finalComment?: string) => {
      const baseHistory = pendingHistoryResultRef.current;
      if (!baseHistory) {
        setError("Unable to save your final comment. Please try again.");
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        return;
      }

      if (finalComment) {
        const patientMessage: ChatMessage = { role: "patient", content: finalComment };
        const updatedMessages = [...messagesRef.current, patientMessage];
        messagesRef.current = updatedMessages;
        setMessages(updatedMessages);
      }

      setPatientResponse("");
      setInterimTranscript("");
      interimTranscriptRef.current = "";

      const historyWithFinal = finalComment
        ? ({
            ...baseHistory,
            patientFinalQuestionsComments: finalComment,
          } satisfies HistoryResponse)
        : ({ ...baseHistory } satisfies HistoryResponse);

      setResult(historyWithFinal);
      setPendingHistoryResult(null);
      pendingHistoryResultRef.current = null;
      setAwaitingFinalComments(false);
      setFinalCommentsChoice(null);

      // If PHQ/GAD screening was requested, park the history and show the form instead of saving.
      if (requestPhqGadRef.current) {
        setPhqGadPendingHistory(historyWithFinal);
        setAwaitingPhqGad(true);
        setSavingSession(false);
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        setStatus("awaitingPatient");
        statusRef.current = "awaitingPatient";
        return;
      }

      setSessionSavePendingHistory(historyWithFinal);
      setSessionSaveError(null);
      setSavingSession(true);
      setStatus("saving");
      statusRef.current = "saving";

      try {
        await saveSession(historyWithFinal);
        setSessionSavePendingHistory(null);
        await finalizePrivacyAndExit();
      } catch (err) {
        console.error("Failed to save session with final comment:", err);
        setSessionSaveError(
          err instanceof Error ? err.message : "Failed to save your interview. Please retry.",
        );
      } finally {
        setSavingSession(false);
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
      }
    };

    // Final clinician-facing comment: capture and save without calling the AI.
    if (isFinalCommentsTurn) {
      if (interviewMode === "conversation") {
        if (effectiveFinalCommentsChoice === "no") {
          await finalizeFinalCommentsTurn();
          return;
        }

        if (effectiveFinalCommentsChoice !== "yes") {
          setError("Please choose Yes or No before continuing.");
          setIsSubmittingResponse(false);
          setShowSubmitToast(false);
          return;
        }
      }

      if (!currentResponse && effectiveFinalCommentsChoice !== "no") {
        console.log("[handlePatientSubmit] No final comment text");
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        return;
      }

      if (trimmed.length > 1000) {
        setError(`Your response is too long (${trimmed.length} characters). Please keep it under 1000 characters.`);
        setDraftTranscript(trimmed);
        setShowReview(true);
        setPatientResponseWithRef("");
        setHasPendingSubmission(false);
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        return;
      }

      if (effectiveFinalCommentsChoice !== "no" && currentResponse) {
        setLastSubmittedDraft(currentResponse);
      }
      await finalizeFinalCommentsTurn(
        effectiveFinalCommentsChoice === "no" ? undefined : trimmed,
      );
      return;
    }

    if (!currentResponse) {
      console.log("[handlePatientSubmit] No response text");
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }

    // Warn once if the diagram is visible but no markers have been placed.
    // Second submit bypasses the warning so the patient is never truly blocked.
    if (showBodyDiagram && selectedDiagramMarkersRef.current.length === 0 && !diagramUnmarkedWarning) {
      setDiagramUnmarkedWarning(true);
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }
    setDiagramUnmarkedWarning(false);

    setLastSubmittedDraft(currentResponse);

    if (trimmed.length > 1000) {
      setError(`Your response is too long (${trimmed.length} characters). Please keep it under 1000 characters.`);
      setDraftTranscript(trimmed);
      setShowReview(true);
      setPatientResponseWithRef("");
      setHasPendingSubmission(false);
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }

    const patientMessage: ChatMessage = {
      role: "patient",
      content: trimmed,
    };
    // Build transcript from messagesRef (which always has the latest, including any edits) plus the new patient message
    // Use the ref to ensure we have the most up-to-date messages, including any recent edits
    const optimisticTranscript = [...messagesRef.current, patientMessage];
    setMessages(optimisticTranscript);
    messagesRef.current = optimisticTranscript; // Update ref immediately
    setPatientResponse("");
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    setStatus("awaitingAi");
    statusRef.current = "awaitingAi";
    setError(null);

    setIsSubmittingResponse(true);
    let submittedSuccessfully = false;
    try {
      const physicianIdToUse =
        physicianIdValue || (typeof window !== "undefined" ? sessionStorage.getItem("physicianId") : null);
      if (!physicianIdToUse) {
        setStatus("awaitingPatient");
        statusRef.current = "awaitingPatient";
        setError("You weren’t invited to complete this form.");
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        return;
      }

      const turn = await requestTurn(
        chiefComplaint,
        profile,
        optimisticTranscript,
        imageSummary,
        labReportSummary,
        previousLabReportSummary,
        formSummary,
        interviewGuidance,
        getMedPmhSummary(),
        invitePatientBackground || null,
        patientEmail.trim(),
        physicianIdToUse,
        language,
        deferredIntentHint,
        detectedComplaints,
      );
      processTurn(turn);
      submittedSuccessfully = true;
    } catch (err) {
      console.error(err);
      setMessages((current) => {
        const rolledBack = current.slice(0, -1);
        messagesRef.current = rolledBack;
        return rolledBack;
      });
      setPatientResponse(trimmed);
      setStatus("awaitingPatient");
      statusRef.current = "awaitingPatient";
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't deliver that message. Please retry.",
      );
    } finally {
      setIsSubmittingResponse(false);
    }
  }

  function clearPauseTimers() {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
      pauseTimeoutRef.current = null;
    }
    if (pauseCountdownIntervalRef.current) {
      clearInterval(pauseCountdownIntervalRef.current);
      pauseCountdownIntervalRef.current = null;
    }
    setPauseCountdownSeconds(null);
  }

  function pauseInterview() {
    stopListening();
    stopSpeaking();
    clearPauseTimers();
    pausedStatusRef.current = status;
    setIsPaused(true);
    setStatus("paused");
    statusRef.current = "paused";
    pauseTimeoutRef.current = setTimeout(() => {
      if (statusRef.current !== "paused") {
        return;
      }
      let remainingSeconds = 60;
      setPauseCountdownSeconds(remainingSeconds);
      pauseCountdownIntervalRef.current = setInterval(() => {
        if (statusRef.current !== "paused") {
          clearPauseTimers();
          return;
        }
        remainingSeconds -= 1;
        setPauseCountdownSeconds(remainingSeconds);
        if (remainingSeconds <= 0) {
          clearPauseTimers();
          endInterview();
        }
      }, 1000);
    }, 10 * 60 * 1000);
  }

  async function resumeInterview() {
    setIsPaused(false);
    clearPauseTimers();
    const previousStatus = pausedStatusRef.current || "awaitingPatient";
    pausedStatusRef.current = null;
    
    // If resuming from awaitingAi, check if we need to re-trigger the API call
    // This happens if the last message is from the patient (meaning we submitted but haven't received a response)
    if (previousStatus === "awaitingAi") {
      const lastMessage = messagesRef.current[messagesRef.current.length - 1];
      // If the last message is from the patient and we have the required data, re-trigger the API call
      // This handles the case where the API call completed while paused but we never processed the response
      if (lastMessage && lastMessage.role === "patient" && lockedProfile && chiefComplaint) {
        setStatus("awaitingAi");
        statusRef.current = "awaitingAi";
        try {
          const physicianIdToUse =
            physicianIdValue || (typeof window !== "undefined" ? sessionStorage.getItem("physicianId") : null);
          if (!physicianIdToUse) {
            setStatus("awaitingPatient");
            statusRef.current = "awaitingPatient";
            setError("You weren’t invited to complete this form.");
            return;
          }

          const turn = await requestTurn(
            chiefComplaint,
            lockedProfile,
            messagesRef.current,
            imageSummary,
            labReportSummary,
            previousLabReportSummary,
            formSummary,
            interviewGuidance,
            getMedPmhSummary(),
            invitePatientBackground || null,
            patientEmail.trim(),
            physicianIdToUse,
            language,
            deferredIntentHint,
            detectedComplaints,
          );
          processTurn(turn);
        } catch (err) {
          console.error("[resumeInterview] Error re-triggering API call:", err);
          setStatus("awaitingPatient");
          statusRef.current = "awaitingPatient";
          setError(
            err instanceof Error
              ? err.message
              : "We couldn't deliver that message. Please retry.",
          );
        }
        return;
      }
      // If the last message is from assistant, the API call already completed
      // Just restore the status - the question should already be displayed
      if (lastMessage && lastMessage.role === "assistant") {
        setStatus("awaitingPatient");
        statusRef.current = "awaitingPatient";
        return;
      }
    }
    
    setStatus(previousStatus);
    statusRef.current = previousStatus as any;
  }

  async function fileToDataUrl(blob: Blob): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === "string" && result.length > 0) {
          resolve(result);
          return;
        }
        reject(new Error("Failed to read uploaded image."));
      };
      reader.onerror = () => reject(new Error("Failed to process uploaded image."));
      reader.readAsDataURL(blob);
    });
  }

  async function prepareLesionImageDataUrl(file: File): Promise<string> {
    if (file.size > LESION_UPLOAD_MAX_BYTES) {
      throw new Error("Uploaded photo exceeds 6MB. Please upload a smaller image.");
    }
    if (file.size <= LESION_UPLOAD_COMPRESSION_THRESHOLD_BYTES) {
      return await fileToDataUrl(file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      let image: HTMLImageElement;
      try {
        image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Unable to load uploaded image for compression."));
          img.src = objectUrl;
        });
      } catch {
        // Some browsers cannot decode HEIC/HEIF for canvas compression.
        // Fall back to storing original bytes instead of failing the upload.
        return await fileToDataUrl(file);
      }

      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return await fileToDataUrl(file);
      }
      ctx.drawImage(image, 0, 0, width, height);

      const compressedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      });
      if (!compressedBlob) {
        return await fileToDataUrl(file);
      }
      return await fileToDataUrl(compressedBlob);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function clearInviteSessionStorage() {
    if (typeof window === "undefined") return;
    const inviteKeys = [
      "physicianId",
      "physicianName",
      "clinicName",
      "invitedFlow",
      "invitePatientName",
      "invitePatientEmail",
      "invitePatientDob",
      "organizationWebsiteUrl",
    ];
    inviteKeys.forEach((key) => sessionStorage.removeItem(key));
    for (let idx = sessionStorage.length - 1; idx >= 0; idx -= 1) {
      const key = sessionStorage.key(idx);
      if (key && key.startsWith("inviteAutoOtpRequested:")) {
        sessionStorage.removeItem(key);
      }
    }
  }

  async function handlePhqGadSubmit(results: PhqGadResults) {
    if (!phqGadPendingHistory) return;
    const historyWithPhqGad: HistoryResponse = { ...phqGadPendingHistory, phqGadResults: results };
    setAwaitingPhqGad(false);
    setPhqGadPendingHistory(null);
    setSessionSavePendingHistory(historyWithPhqGad);
    setSessionSaveError(null);
    setSavingSession(true);
    setStatus("saving");
    statusRef.current = "saving";
    try {
      await saveSession(historyWithPhqGad);
      setSessionSavePendingHistory(null);
      await finalizePrivacyAndExit();
    } catch (err) {
      console.error("Failed to save session after PHQ/GAD:", err);
      setSessionSaveError(
        err instanceof Error ? err.message : "Failed to save your interview. Please retry.",
      );
    } finally {
      setSavingSession(false);
    }
  }

  async function finalizePrivacyAndExit() {
    const configuredRedirect =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("organizationWebsiteUrl") || "").trim()
        : "";
    let completionRedirectUrl = COMPLETION_REDIRECT_FALLBACK;
    if (configuredRedirect) {
      try {
        const parsed = new URL(configuredRedirect);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          completionRedirectUrl = parsed.toString();
        }
      } catch {
        completionRedirectUrl = COMPLETION_REDIRECT_FALLBACK;
      }
    }

    clearPauseTimers();
    stopListening();
    stopSpeaking();
    lastSpokenMessageRef.current = "";

    if (selectedImagePreview) URL.revokeObjectURL(selectedImagePreview);
    if (pmhPreview) URL.revokeObjectURL(pmhPreview);
    if (medListPreview) URL.revokeObjectURL(medListPreview);

    setMessages([]);
    messagesRef.current = [];
    setResult(null);
    setTranslatedSummary(null);
    setPendingHistoryResult(null);
    pendingHistoryResultRef.current = null;
    setAwaitingFinalComments(false);
    setFinalCommentsChoice(null);
    setAwaitingPhqGad(false);
    setPhqGadPendingHistory(null);
    setRequestPhqGad(false);
    requestPhqGadRef.current = false;
    setPatientResponse("");
    patientResponseRef.current = "";
    setDetectedComplaints([]);
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    setDraftTranscript("");
    draftTranscriptRef.current = "";
    setDraftTranscriptRaw("");
    draftTranscriptRawRef.current = "";
    setLastSubmittedDraft(null);
    setHasPendingSubmission(false);
    setShowSubmitToast(false);
    setIsSubmittingResponse(false);
    setSavingSession(false);
    setSessionSaveError(null);
    setSessionSavePendingHistory(null);
    setSessionCode(null);
    setShowShareLink(false);

    setChiefComplaint("");
    setPatientName("");
    setPatientEmail("");
    setInvitePatientDob(null);
    setLockedProfile(null);
    setHasConsented(false);
    setIsInvitedFlow(false);
    setPhysicianIdValue(null);
    setHasPhysicianId(false);
    setError(null);
    setEndedEarly(false);
    setIsEndingInterview(false);
    setInterviewProgress(null);
    setInterviewStartTime(null);
    interviewStartTimeRef.current = null;
    setElapsedTime(0);

    setSelectedImage(null);
    setSelectedImagePreview(null);
    setImageSummary(null);
    setShowImagePrompt(false);
    setWantsToUploadImage(null);
    setShowBodyDiagram(false);
    setSelectedBodyParts([]);
    setSelectedDiagramMarkersWithRef([]);
    committedBodyDiagramRef.current = { selectedParts: [], markersByPart: [] };
    setPmhPhoto(null);
    setPmhPreview(null);
    setPmhExtracted("");
    setMedListPhoto(null);
    setMedListPreview(null);
    setMedListExtracted("");
    setLabReportSummary(null);
    setPreviousLabReportSummary(null);
    setFormSummary(null);
    setInvitePatientBackground(null);
    setInterviewGuidance(null);

    clearInviteSessionStorage();
    try {
      await fetch("/api/invitations/session/clear", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best effort: continue to redirect even if cookie clear fails.
    }
    router.replace(
      `${PRIVACY_COMPLETION_ROUTE}?redirect=${encodeURIComponent(completionRedirectUrl)}`,
    );
  }

  async function persistSessionRequest(requestBody: Record<string, unknown>): Promise<string> {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.json().catch(() => ({} as Record<string, unknown>));
    if (!response.ok) {
      const message =
        typeof responseBody?.error === "string" && responseBody.error.length > 0
          ? responseBody.error
          : "Failed to save session. Please try again.";
      throw new Error(message);
    }
    if (typeof responseBody?.sessionCode !== "string" || responseBody.sessionCode.trim().length === 0) {
      throw new Error("Session save response was incomplete. Please try again.");
    }
    return responseBody.sessionCode;
  }

  async function saveSession(historyResult: HistoryResponse): Promise<string> {
    if (!lockedProfile) {
      console.warn("[saveSession] Cannot save session: lockedProfile is missing");
      throw new Error("Profile is missing. Please restart the interview.");
    }

    const physicianId = typeof window !== "undefined" ? sessionStorage.getItem("physicianId") || "" : "";
    if (!physicianId) {
      throw new Error(
        "Physician ID not found. Please access this form through the invitation link provided by your physician.",
      );
    }

    const finalPatientName = patientName?.trim() || "Patient";
    const finalPatientEmail = patientEmail?.trim() || `patient-${Date.now()}@unknown.com`;
    if (!patientName || !patientEmail) {
      console.warn("[saveSession] Patient identifiers missing; using fallback placeholders");
    }

    const sourceMessages = messagesRef.current.length > 0 ? messagesRef.current : messages;
    const transcriptToSave: InterviewMessage[] = Array.isArray(sourceMessages) ? sourceMessages : [];
    if (process.env.NODE_ENV === "development") {
      console.log("[saveSession] Persisting interview transcript", {
        transcriptLength: transcriptToSave.length,
        messagesLength: messages.length,
        messagesRefLength: messagesRef.current.length,
      });
    }
    if (transcriptToSave.length === 0) {
      console.error("[saveSession] ERROR: Transcript is empty at save time", {
        messagesCount: messages.length,
        messagesRefCount: messagesRef.current.length,
        sourceMessagesCount: sourceMessages.length,
        status: statusRef.current,
      });
    }

    const duration = interviewStartTimeRef.current
      ? Math.round((Date.now() - interviewStartTimeRef.current) / 1000)
      : 0;
    const medPmhSummary = getMedPmhSummary();

    let imageUrl: string | undefined;
    if (selectedImage) {
      imageUrl = await prepareLesionImageDataUrl(selectedImage);
    } else if (selectedImagePreview?.startsWith("data:")) {
      imageUrl = selectedImagePreview;
    }

    const patientUploadsPayload = buildPatientUploads(imageUrl);
    const bodyDiagramPayload = patientUploadsPayload?.bodyDiagram;
    const requestBody = {
      physicianId,
      patientName: finalPatientName,
      patientEmail: finalPatientEmail,
      chiefComplaint,
      patientProfile: lockedProfile,
      history: {
        ...historyResult,
        interviewLanguage: language,
        labReportSummary: labReportSummary || undefined,
        previousLabReportSummary: previousLabReportSummary || undefined,
        formSummary: formSummary || undefined,
        medPmhSummary: medPmhSummary || undefined,
        patientUploads: patientUploadsPayload,
      },
      imageSummary: imageSummary || undefined,
      imageUrl,
      imageName: selectedImage?.name || undefined,
      duration,
      transcript: transcriptToSave,
    };

    if (process.env.NODE_ENV === "development") {
      console.log("[saveSession] Sending POST request", {
        hasImage: !!imageUrl,
        hasTranscript: !!requestBody.transcript,
        transcriptLength: requestBody.transcript?.length || 0,
        bodyDiagramSelectedParts: Array.isArray(bodyDiagramPayload?.selectedParts)
          ? bodyDiagramPayload.selectedParts.length
          : 0,
        bodyDiagramMarkersByPart: Array.isArray(bodyDiagramPayload?.markersByPart)
          ? bodyDiagramPayload.markersByPart.length
          : 0,
        bodyDiagramLeftSoleMarkers: Array.isArray(bodyDiagramPayload?.leftSoleMarkers)
          ? bodyDiagramPayload.leftSoleMarkers.length
          : 0,
        bodyKeys: Object.keys(requestBody),
      });
    }

    return await persistSessionRequest(requestBody as Record<string, unknown>);
  }

  const retrySessionSave = async () => {
    if (!sessionSavePendingHistory || savingSession) return;
    setSessionSaveError(null);
    setSavingSession(true);
    setStatus("saving");
    statusRef.current = "saving";
    try {
      await saveSession(sessionSavePendingHistory);
      setSessionSavePendingHistory(null);
      await finalizePrivacyAndExit();
    } catch (err) {
      console.error("Retry session save failed:", err);
      setSessionSaveError(
        err instanceof Error ? err.message : "Failed to save session. Please try again.",
      );
    } finally {
      setSavingSession(false);
    }
  };

  async function endInterview() {
    clearPauseTimers();
    stopListening();
    stopSpeaking();
    setIsPaused(false);
    pausedStatusRef.current = null;
    setIsEndingInterview(true);
    
    // If there are messages, generate a summary with what we have
    if (messages.length > 0 && lockedProfile && chiefComplaint) {
      const endRequestMessage: ChatMessage = {
        role: "patient",
        content:
          "I would like to end the interview now. Please provide a summary of what we've discussed.",
      };
      try {
        setStatus("awaitingAi");
        
        const physicianIdToUse =
          physicianIdValue || (typeof window !== "undefined" ? sessionStorage.getItem("physicianId") : null);
        if (!physicianIdToUse) {
          throw new Error("You weren’t invited to complete this form.");
        }

        // Create a special request that forces a summary.
        const finalMessages = [...messages, endRequestMessage];
        const turn = await requestTurn(
          chiefComplaint,
          lockedProfile,
          finalMessages,
          imageSummary,
          labReportSummary,
          previousLabReportSummary,
          formSummary,
          interviewGuidance,
          getMedPmhSummary(),
          invitePatientBackground || null,
          patientEmail.trim(),
          physicianIdToUse,
          language,
          deferredIntentHint,
          detectedComplaints,
          true,
        );
        
        if (turn.type === "summary") {
          // Process the summary
          const historyResult: HistoryResponse = {
            positives: turn.positives,
            negatives: turn.negatives,
            physicalFindings: turn.physicalFindings || [],
            summary: turn.summary,
            investigations: turn.investigations,
            assessment: turn.assessment,
            plan: turn.plan,
            interviewEndedEarly: true,
          };
          setResult(historyResult);
          setEndedEarly(true); // Mark that patient ended interview early
          
          const summaryMessage: ChatMessage = { role: "assistant", content: turn.summary };
          const endMessage: ChatMessage = { role: "assistant", content: closingMessageEnglish };
          const finalCommentsPromptMessage: ChatMessage = {
            role: "assistant",
            content: finalCommentsPromptEnglish,
          };
          const updatedMessages: ChatMessage[] = [
            ...messages,
            endRequestMessage,
            summaryMessage,
            endMessage,
            finalCommentsPromptMessage,
          ];

          messagesRef.current = updatedMessages;
          setMessages(updatedMessages);

          setPendingHistoryResult(historyResult);
          pendingHistoryResultRef.current = historyResult;
          setAwaitingFinalComments(true);
          setFinalCommentsChoice(null);
          setStatus("awaitingPatient");
          statusRef.current = "awaitingPatient";
        } else {
          // If we got a question instead of summary, create a summary from what we have
          const patientResponses = messages
            .filter((m) => m.role === "patient")
            .map((m) => m.content)
            .join(" ");
          
          const summaryText = `The patient is a ${lockedProfile.age}-year-old ${lockedProfile.sex} who presented with ${chiefComplaint}. ${patientResponses.substring(0, 400)}`;
          
          const historyResult: HistoryResponse = {
            positives: [],
            negatives: [],
            physicalFindings: [],
            summary: summaryText.substring(0, 600), // Ensure it fits in one paragraph
            investigations: [],
            assessment: "Interview ended early by patient request.",
            plan: [],
            interviewEndedEarly: true,
          };
          setResult(historyResult);
          setEndedEarly(true); // Mark that patient ended interview early
          
          const summaryMessage: ChatMessage = { role: "assistant", content: historyResult.summary };
          const endMessage: ChatMessage = { role: "assistant", content: closingMessageEnglish };
          const finalCommentsPromptMessage: ChatMessage = {
            role: "assistant",
            content: finalCommentsPromptEnglish,
          };
          const updatedMessages: ChatMessage[] = [
            ...messages,
            endRequestMessage,
            summaryMessage,
            endMessage,
            finalCommentsPromptMessage,
          ];

          messagesRef.current = updatedMessages;
          setMessages(updatedMessages);

          setPendingHistoryResult(historyResult);
          pendingHistoryResultRef.current = historyResult;
          setAwaitingFinalComments(true);
          setFinalCommentsChoice(null);
          setStatus("awaitingPatient");
          statusRef.current = "awaitingPatient";
        }
      } catch (err) {
        console.error("Error generating final summary:", err);
        // Create a basic summary even if API fails
        if (messages.length > 0) {
          const patientResponses = messages
            .filter((m) => m.role === "patient")
            .map((m) => m.content)
            .join(" ");
          
          const summaryText = `The patient is a ${lockedProfile.age}-year-old ${lockedProfile.sex} who presented with ${chiefComplaint}. ${patientResponses.substring(0, 400)}`;
          
          const historyResult: HistoryResponse = {
            positives: [],
            negatives: [],
            physicalFindings: [],
            summary: summaryText.substring(0, 600),
            investigations: [],
            assessment: "Interview ended early. Summary generated from available information.",
            plan: [],
            interviewEndedEarly: true,
          };
          setResult(historyResult);
          setEndedEarly(true); // Mark that patient ended interview early
          
          const summaryMessage: ChatMessage = { role: "assistant", content: historyResult.summary };
          const endMessage: ChatMessage = { role: "assistant", content: closingMessageEnglish };
          const finalCommentsPromptMessage: ChatMessage = {
            role: "assistant",
            content: finalCommentsPromptEnglish,
          };
          const updatedMessages: ChatMessage[] = [
            ...messages,
            endRequestMessage,
            summaryMessage,
            endMessage,
            finalCommentsPromptMessage,
          ];

          messagesRef.current = updatedMessages;
          setMessages(updatedMessages);

          setPendingHistoryResult(historyResult);
          pendingHistoryResultRef.current = historyResult;
          setAwaitingFinalComments(true);
          setFinalCommentsChoice(null);
          setStatus("awaitingPatient");
          statusRef.current = "awaitingPatient";
        } else {
          setStatus("complete");
          statusRef.current = "complete";
        }
      }
    } else {
      // No messages yet, just mark as complete
      setStatus("complete");
      statusRef.current = "complete";
    }
  }

  function resetConversation() {
    clearPauseTimers();
    stopListening();
    stopSpeaking();
    lastSpokenMessageRef.current = "";
    setInterimTranscript("");
    interimTranscriptRef.current = "";
    setIsPaused(false);
    setIsEndingInterview(false);
    pausedStatusRef.current = null;
    setStatus("idle");
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setFinalCommentsChoice(null);
    setError(null);
    setSavingSession(false);
    setSessionSaveError(null);
    setSessionSavePendingHistory(null);
    setInterviewProgress(null);
    // Keep chief complaint - don't clear it
    setLockedProfile(null);
    setInterviewStartTime(null);
    interviewStartTimeRef.current = null;
    setElapsedTime(0);
    // Keep family doctor, current medications, and pharmacy inputs - don't clear them
    setShowImagePrompt(false);
    setWantsToUploadImage(null);
    setImageSummary(null);
    setAnalyzingImage(false);
    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview);
    }
    setSelectedImage(null);
    setSelectedImagePreview(null);
    setShowBodyDiagram(false);
    setSelectedBodyParts([]);
    setSelectedDiagramMarkersWithRef([]);
    committedBodyDiagramRef.current = { selectedParts: [], markersByPart: [] };
  }

  async function searchPharmacy(details?: {
    name?: string;
    address?: string;
    city?: string;
  }) {
    const formattedName = details?.name?.trim() ?? pharmacyNameInput.trim();
    const formattedAddress =
      details?.address?.trim() ?? pharmacyAddressInput.trim();
    const formattedCity = details?.city?.trim() ?? pharmacyCityInput.trim();

    if (!formattedName && !formattedAddress && !formattedCity) {
      setError("Enter at least the pharmacy name and address before searching.");
      setPharmacyInfo(null);
      return;
    }

    if (!formattedName || !formattedAddress) {
      setError("Please provide both the pharmacy name and street address.");
      setPharmacyInfo(null);
      return;
    }

    const fallbackAddress =
      formattedAddress ||
      [formattedCity, "British Columbia"]
        .filter((value) => value && value.length > 0)
        .join(", ");

    setSearchingPharmacy(true);
    setError(null);

    try {

      const response = await fetch("/api/pharmacy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pharmacyName: formattedName,
          address: formattedAddress,
          city: formattedCity || undefined,
        }),
      });

      // Handle 404 (not found) as a normal case
      if (response.status === 404) {
        setPharmacyInfo({
          name: formattedName || "Pharmacy",
          address: fallbackAddress,
          phone: undefined,
          fax: undefined,
        });
        return;
      }

      // For other errors, try to get error message
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        console.warn("Pharmacy search error:", errorPayload.error);
        // Create basic entry without phone/fax
        setPharmacyInfo({
          name: formattedName || "Pharmacy",
          address: fallbackAddress,
          phone: undefined,
          fax: undefined,
        });
        return;
      }

      const data = (await response.json()) as {
        pharmacies?: Array<{
          name: string;
          address: string;
          phone?: string;
          fax?: string;
        }>;
      };

      if (data.pharmacies && data.pharmacies.length > 0) {
        setPharmacyInfo(data.pharmacies[0]);
      } else {
        // If search returns empty results, create a basic entry from input
        setPharmacyInfo({
          name: formattedName || "Pharmacy",
          address: fallbackAddress,
          phone: undefined,
          fax: undefined,
        });
      }
    } catch (err) {
      console.error(err);
      // If search fails, create a basic entry from the input
      setPharmacyInfo({
        name: formattedName || "Pharmacy",
        address: fallbackAddress,
        phone: undefined,
        fax: undefined,
      });
      // Don't show error - allow manual entry
    } finally {
      setSearchingPharmacy(false);
    }
  }

  async function processTurn(turn: InterviewResponse) {
    setInterviewProgress(turn.progress ?? null);

    // Pick up mid-interview PHQ-9/GAD-7 toggle set by physician via monitor window
    if ((turn as unknown as { requestPhqGad?: boolean }).requestPhqGad === true && !requestPhqGadRef.current) {
      setRequestPhqGad(true);
      requestPhqGadRef.current = true;
    }

    if (turn.type === "question") {
      if (turn.newComplaints && turn.newComplaints.length > 0) {
        setDetectedComplaints((prev) => {
          const merged = [...prev];
          turn.newComplaints!.forEach((c) => {
            if (!merged.some((existing) => existing.toLowerCase() === c.toLowerCase())) {
              merged.push(c);
            }
          });
          return merged;
        });
      }
      setDeferredIntentHint(turn.deferredIntentHint ?? null);

      // ── Resolve diagram visibility BEFORE setting messages ────────────────────
      // This lets us sanitize the question text when the diagram won't be shown,
      // so the patient is never told to "mark on the diagram" when nothing renders.
      const questionLower = turn.question.toLowerCase();

      // Check if the AI is asking for a photo
      const isRequestingPhotoFromFlag = turn.requiresPhotoUpload === true;
      const isRequestingPhoto =
        isRequestingPhotoFromFlag || isPhotoUploadRequestText(turn.question);
      const sensitivePhotoContext = getSensitivePhotoContext({
        sex: lockedProfile?.sex || sex,
        textBlocks: [chiefComplaint, turn.question],
      });

      // Show image prompt if AI is requesting a photo and no image has been uploaded yet
      if (
        isRequestingPhoto &&
        !sensitivePhotoContext.suppressPhotoRequest &&
        !selectedImage &&
        !selectedImagePreview
      ) {
        setShowImagePrompt(true);
        setWantsToUploadImage(null);
      }

      // Diagrams are shown only when the LLM explicitly sets requiresLocationMarking: true.
      const shouldShowDiagramFromFlag = turn.requiresLocationMarking === true;

      // Use LLM-provided body parts; fall back to detection from context when AI omits locationBodyParts.
      let bodyParts: ReturnType<typeof detectBodyParts>;
      if (
        turn.requiresLocationMarking &&
        Array.isArray(turn.locationBodyParts) &&
        turn.locationBodyParts.length > 0
      ) {
        const questionLowerForSide = turn.question.toLowerCase();
        bodyParts = turn.locationBodyParts.map((part: string) => ({
          part: part as any,
          name: part.replace(/_/g, " "),
          side: questionLowerForSide.includes("right")
            ? ("right" as const)
            : questionLowerForSide.includes("left")
              ? ("left" as const)
              : undefined,
        }));
      } else if (turn.requiresLocationMarking) {
        // AI set requiresLocationMarking but omitted locationBodyParts — detect from context.
        bodyParts = detectBodyParts(`${chiefComplaint} ${turn.question}`);
      } else {
        bodyParts = [];
      }

      // Filter out any body parts that are not valid BodyPart keys (e.g. "bone", "skeleton")
      // so they don't cause a broken diagram to appear.
      const validBodyPartKeys = new Set([
        "wrist", "hand", "elbow", "shoulder", "neck", "back", "lower_back", "upper_back",
        "knee", "lower_leg", "ankle", "foot", "hip", "head", "chest", "abdomen",
      ]);
      bodyParts = bodyParts.filter((bp) => validBodyPartKeys.has(bp.part));

      // Determine which parts to show (empty means no diagram).
      let partsToShow: Array<{ part: string; side?: "left" | "right" | "both" }> = [];
      if (bodyParts.length > 0 && shouldShowDiagramFromFlag) {
        const uniqueParts = bodyParts.filter((bp, index, arr) => {
          const key = getDiagramMarkerKey(bp.part, bp.side === "both" ? undefined : bp.side);
          return index === arr.findIndex((candidate) => {
            const candidateKey = getDiagramMarkerKey(
              candidate.part,
              candidate.side === "both" ? undefined : candidate.side,
            );
            return candidateKey === key;
          });
        });
        // Deduplicate parts that resolve to the same diagram image (e.g. "head" and "neck").
        const seenImageSrcs = new Set<string>();
        const deduplicatedParts = uniqueParts.filter((bp) => {
          const image = getBodyDiagramImage(bp.part as any, bp.side === "both" ? undefined : bp.side);
          if (seenImageSrcs.has(image.src)) return false;
          seenImageSrcs.add(image.src);
          return true;
        });
        const shouldDropGenericBack = deduplicatedParts.some((bp) => bp.part !== "back");
        const hasChestSelection = deduplicatedParts.some((bp) => bp.part === "chest");
        const filteredParts = shouldDropGenericBack
          ? deduplicatedParts.filter((bp) => bp.part !== "back")
          : deduplicatedParts;
        const partsForTurn =
          shouldShowDiagramFromFlag && hasChestSelection
            ? filteredParts.filter((bp) => bp.part !== "neck")
            : filteredParts;
        partsToShow = partsForTurn.map((bp) => ({ part: bp.part, side: bp.side }));
      }

      const willShowDiagram = partsToShow.length > 0;

      // ── Sanitize question text ────────────────────────────────────────────────
      // If the diagram won't be shown but the AI referenced one, remove the
      // diagram-marking instructions so the patient sees a coherent question.
      const questionContent = (() => {
        if (!willShowDiagram && turn.requiresLocationMarking) {
          const stripped = stripDiagramMarkingPhrases(turn.question);
          // Fall back to original if stripping removed everything
          return stripped.trim() ? stripped : turn.question;
        }
        return turn.question;
      })();

      // ── Commit message to chat ────────────────────────────────────────────────
      setMessages((current) => {
        const assistantMessage: ChatMessage = { role: "assistant", content: questionContent };
        const updated: ChatMessage[] = [...current, assistantMessage];
        messagesRef.current = updated; // Update ref immediately
        return updated;
      });

      // ── Apply diagram state ───────────────────────────────────────────────────
      if (willShowDiagram) {
        const nextMarkerKeys = new Set(
          partsToShow.map((part) =>
            getDiagramMarkerKey(part.part, part.side === "both" ? undefined : part.side),
          ),
        );
        setSelectedBodyParts(partsToShow);
        setShowBodyDiagram(true);
        // Keep markers only for diagrams that are still being shown.
        setSelectedDiagramMarkersWithRef((prev) =>
          prev.filter((selection) => nextMarkerKeys.has(getDiagramMarkerKey(selection.part, selection.side))),
        );
      } else {
        // Persist diagram data for session save before clearing the UI state.
        if (selectedBodyParts.length > 0 || selectedDiagramMarkersRef.current.length > 0) {
          committedBodyDiagramRef.current = {
            selectedParts: [...selectedBodyParts],
            markersByPart: [...selectedDiagramMarkersRef.current],
          };
        }
        // Hide diagram. Also clear parts and markers so stale data from a previous
        // turn is not submitted with a future answer.
        setShowBodyDiagram(false);
        setSelectedBodyParts([]);
        setSelectedDiagramMarkersWithRef([]);
        setDiagramUnmarkedWarning(false);
      }
      
      setStatus("awaitingPatient");
      return;
    }

    setDeferredIntentHint(null);
    const historyResult: HistoryResponse = {
      positives: turn.positives,
      negatives: turn.negatives,
      physicalFindings: turn.physicalFindings || [],
      summary: turn.summary,
      investigations: turn.investigations,
      assessment: turn.assessment,
      plan: turn.plan,
    };

    setResult(historyResult);
    setEndedEarly(false); // Normal completion, not ended early
    
    // Add closing + final-comments prompt, then wait for patient response before saving.
    // Use messagesRef to avoid dropping the latest just-submitted patient response.
    const baseMessages = messagesRef.current.length > 0 ? messagesRef.current : messages;
    const summaryMessage: ChatMessage = { role: "assistant", content: turn.summary };
    const endMessage: ChatMessage = { role: "assistant", content: closingMessageEnglish };
    const finalCommentsPromptMessage: ChatMessage = {
      role: "assistant",
      content: finalCommentsPromptEnglish,
    };
    const updatedMessages: ChatMessage[] = [
      ...baseMessages,
      summaryMessage,
      endMessage,
      finalCommentsPromptMessage,
    ];
    
    messagesRef.current = updatedMessages;
    
    setMessages(updatedMessages);
    
    setPendingHistoryResult(historyResult);
    pendingHistoryResultRef.current = historyResult;
    setAwaitingFinalComments(true);
    setFinalCommentsChoice(null);
    setStatus("awaitingPatient");
    statusRef.current = "awaitingPatient";
  }

  const microphoneBlocked =
    typeof error === "string" && error.toLowerCase().includes("microphone access denied");
  const micStatusText = micUiState === "listening"
    ? "Listening..."
    : micUiState === "starting"
      ? "Starting microphone..."
    : isTranscribing
      ? "Transcribing..."
    : cleaningTranscript
      ? "Processing transcript..."
      : microphoneBlocked
        ? "Microphone blocked. Please allow access in browser settings."
        : "";
  const micStatusClassName = microphoneBlocked
    ? "text-amber-600"
    : isTranscribing
      ? "text-slate-500 animate-pulse"
      : "text-slate-500";
  const micButtonLabel =
    micUiState === "listening"
      ? "Stop talking"
      : micUiState === "starting"
        ? "Starting..."
        : isTranscribing
          ? "Transcribing"
          : "Start talking";
  const micButtonTitle =
    micUiState === "listening"
      ? "Click once to stop talking"
      : micUiState === "starting"
        ? "Starting..."
        : isTranscribing
          ? "Transcribing..."
          : "Click once to start talking";
  const showListeningDecor = micUiState === "listening" && !micWarning;
  const elapsedTimeLabel = formatElapsedTime(elapsedTime);
  const showInterviewProgress =
    interviewProgress !== null &&
    status !== "idle" &&
    status !== "saving" &&
    status !== "complete" &&
    status !== "paused";
  const interviewProgressPercent = showInterviewProgress
    ? Math.max(
        0,
        Math.min(
          100,
          interviewProgress.approxTotalQuestions > 0
            ? (interviewProgress.questionsAsked / interviewProgress.approxTotalQuestions) * 100
            : 0,
        ),
      )
    : 0;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <main className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-100 backdrop-blur">
        <header className={`border-b border-slate-100 px-8 py-6${status !== "idle" ? " hidden sm:block" : ""}`}>
          <div className="flex flex-col items-center text-center gap-3 sm:flex-row sm:justify-between sm:text-left sm:gap-4">
            <NextImage
              src="/LogoFinal.png"
              alt="Health Assist AI logo"
              width={146}
              height={36}
              className="h-[40px] w-[123px] object-contain sm:h-[54px] sm:w-[163px] flex-shrink-0 sm:order-last"
              priority
            />
            <div className="sm:order-first">
              <h1 className="mt-1 text-[1.08rem] font-semibold tracking-tight text-slate-900">
                AI-Powered History Intake
              </h1>
            </div>
          </div>
        </header>

        <section className="px-8 py-8">
          <div className="space-y-6">
            {!hasPhysicianId && status === "idle" && (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <svg
                    className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-amber-900">
                      Physician Information Not Found
                    </h3>
                    <p className="mt-1 text-sm text-amber-800">
                      Please click on the invitation link provided by your physician again, or contact your physician's office for assistance.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <form onSubmit={handleStart} onKeyDown={handlePreInterviewEnterKeyDown} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="language"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.languageLabel || "Interview language"}
                </label>
                <select
                  id="language"
                  name="language"
                  value={language}
                  disabled={status !== "idle"}
                  onChange={(event) => setLanguage(event.target.value)}
                  className={`w-full rounded-2xl border px-4 py-3 text-base text-slate-900 outline-none transition disabled:cursor-not-allowed disabled:opacity-70 ${!language && status === "idle" ? "border-amber-400 bg-amber-50 ring-2 ring-amber-100 focus:border-amber-500" : "border-slate-200 bg-[#F2FCF8] focus:border-slate-400 focus:bg-white"}`}
                >
                  <option value="" disabled>Select language...</option>
                  {languageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {isUiTranslating ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                    <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading language...
                  </p>
                ) : !language && status === "idle" ? (
                  <p className="text-xs text-amber-600 font-medium">{uiT.pleaseSelectLang || "Please select a language before starting the interview."}</p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Assistant questions and patient-facing text will use this language (fallback to English if translation fails).
                  </p>
                )}
              </div>
              <div className={status !== "idle" ? "hidden sm:block" : ""}>
              <div className="rounded-2xl border border-slate-200 bg-[#F2FCF8] px-3.5 py-2.5 text-[13px] leading-[1.35rem] text-slate-800">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={hasConsented}
                    ref={consentCheckboxRef}
                    aria-invalid={isConsentErrorMessage(error)}
                    disabled={status !== "idle"}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setHasConsented(next);
                      if (next && isConsentErrorMessage(error)) {
                        setError(null);
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  />
                  <span>
                    {uiT.consentBody || "Do not proceed with this interview if this is a medical emergency. Call 911 instead. This AI-guided interview is optional — you may decline and provide your history directly to your physician. I consent to the collection of my health information using Health Assist AI to prepare an AI-assisted intake summary for my physician. My information will be processed on Microsoft Azure, including servers in the United States. This tool does not provide medical advice and is not a substitute for care from your physician. I agree to the"}{" "}
                    <a
                      href="https://www.health-assist.org/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                    >
                      Terms of Use
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://www.health-assist.org/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800"
                    >
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                <label
                  htmlFor="patient-name"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.nameLabel || "Your Name (Required)"}
                </label>
                  <input
                    id="patient-name"
                    name="patientName"
                    type="text"
                    value={patientName}
                    disabled={status !== "idle" || isInvitedFlow}
                    readOnly={isInvitedFlow}
                    onChange={(event) => setPatientName(event.target.value)}
                    placeholder="e.g., John Doe"
                    className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>

                <div className="space-y-2">
                <label
                  htmlFor="patient-email"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.emailLabel || "Your Email (Required)"}
                </label>
                  <input
                    id="patient-email"
                    name="patientEmail"
                    type="email"
                    value={patientEmail}
                    disabled={status !== "idle" || isInvitedFlow}
                    readOnly={isInvitedFlow}
                    onChange={(event) => setPatientEmail(event.target.value)}
                    placeholder="e.g., john@example.com"
                    className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>
              </div>
              {isInvitedFlow && (
                <p className="text-xs text-slate-600">
                  Name and email are prefilled from your invitation and cannot be changed.
                </p>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="chief-complaint"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.chiefComplaintLabel || 'Chief complaint (Required)'}
                </label>
                <textarea
                  id="chief-complaint"
                  name="chiefComplaint"
                  rows={2}
                  placeholder={uiT.chiefComplaintPlaceholder || 'Describe your main concern (e.g., “3 days of sore throat with fever”)'}

                  value={chiefComplaint}
                  disabled={status !== "idle"}
                  onChange={(event) => setChiefComplaint(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                <label
                  htmlFor="sex"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.sexLabel || "Sex (Required)"}
                </label>
                  <select
                    id="sex"
                    name="sex"
                    value={sex}
                    disabled={status !== "idle"}
                    onChange={(event) =>
                      setSex(event.target.value as PatientProfile["sex"])
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="nonbinary">Non-binary</option>
                    <option value="unspecified">Prefer not to share</option>
                  </select>
                </div>

                <div className="space-y-2">
                <label
                  htmlFor="age"
                  className="text-sm font-medium text-slate-800"
                >
                  {uiT.ageLabel || "Age (years)"}
                </label>
                  <input
                    id="age"
                    name="age"
                    type="number"
                    min={0}
                    max={120}
                    value={ageInput}
                    disabled={status !== "idle"}
                    onChange={(event) => setAgeInput(event.target.value)}
                    placeholder="e.g., 34"
                    className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2 mt-3">
                <button
                  type="button"
                  aria-expanded={showAdditionalMedicalHistory}
                  onClick={() => setShowAdditionalMedicalHistory((prev) => !prev)}
                  className="w-full cursor-pointer rounded-xl px-1 py-1 text-left transition-colors hover:bg-slate-50/80"
                >
                  <span className="inline-flex items-center gap-2 text-base font-medium text-slate-800">
                    <span
                      className={[
                        "text-[17px] font-semibold leading-none text-slate-500 transition-transform",
                        showAdditionalMedicalHistory ? "rotate-90" : "",
                      ].join(" ")}
                      aria-hidden="true"
                    >
                      ▸
                    </span>
                    <span>{uiT.addMedHistory || "Add Medical History (Optional)"}</span>
                  </span>
                </button>
                {!showAdditionalMedicalHistory && (
                  <p className="ml-6 -mt-0.5 text-xs text-slate-500">
                    {uiT.addMedHistorySubtitle || "Allergies, medications, past history, and pharmacy."}
                  </p>
                )}

                {showAdditionalMedicalHistory && (
                  <div className="space-y-5 pt-1">
                    <div className="space-y-2">
                      <label
                        htmlFor="allergies"
                        className="text-sm font-medium text-slate-800"
                      >
                        Drug allergies
                      </label>
                      <textarea
                        id="allergies"
                        name="allergies"
                        rows={2}
                        value={allergies}
                        disabled={status !== "idle"}
                        onChange={(event) => setAllergies(event.target.value)}
                        placeholder='e.g., penicillin (rash) (leave blank for "None")'
                        className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            Past Medical History (Optional)
                          </p>
                          <p className="text-xs text-slate-500">
                            Type it in, or upload a photo/PDF and we’ll extract it below.
                          </p>
                        </div>
                        {pmhPreview ? (
                          <img
                            src={pmhPreview}
                            alt="PMH preview"
                            className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : null}
                      </div>
                      <textarea
                        id="pmh"
                        name="pmh"
                        rows={2}
                        value={pmh}
                        disabled={status !== "idle"}
                        onChange={(event) => setPmh(event.target.value)}
                        aria-label="Past medical history"
                        placeholder="e.g., asthma, hypertension on lisinopril (leave blank for 'None')"
                        className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                      />
                      <div className="space-y-2">
                        <input
                          type="file"
                          accept="image/*,.heic,.heif,.pdf"
                          disabled={status !== "idle"}
                          aria-label="Upload PMH photo or PDF"
                          onChange={async (event) => {
                            const file = event.target.files?.[0] ?? null;
                            if (pmhPreview) {
                              URL.revokeObjectURL(pmhPreview);
                            }
                            if (!file) {
                              setPmhPhoto(null);
                              setPmhPreview(null);
                              setPmhExtracted("");
                              return;
                            }
                            if (file.size > 6 * 1024 * 1024) {
                              setError(
                                "File too large (max 6MB). Please choose a smaller/clearer image or PDF."
                              );
                              return;
                            }
                            const previewUrl = URL.createObjectURL(file);
                            setPmhPhoto(file);
                            setPmhPreview(previewUrl);
                            setAnalyzingPmh(true);
                            setPmhExtracted("");
                            try {
                              const formData = new FormData();
                              formData.append("image", file);
                              formData.append("mode", "pmh");
                              const response = await fetch("/api/analyze-med-pmh", {
                                method: "POST",
                                body: formData,
                              });
                              if (!response.ok) {
                                const errJson = await response.json().catch(() => ({}));
                                throw new Error(
                                  errJson.error || errJson.details || "Failed to analyze photo."
                                );
                              }
                              const data = (await response.json()) as { summary?: string };
                              if (data.summary) {
                                const summary = data.summary.trim();
                                const parsed = parseMedPmhSummary(summary);
                                const pmhOnly = parsed.pmh || summary;
                                setPmhExtracted(pmhOnly);
                                if (!pmh.trim()) {
                                  setPmh(pmhOnly);
                                }
                              }
                            } catch (err) {
                              console.error("[page.tsx] PMH photo analysis error:", err);
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to analyze the photo. Please try again."
                              );
                            } finally {
                              setAnalyzingPmh(false);
                            }
                          }}
                          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:border-slate-300 hover:file:bg-slate-50 disabled:cursor-not-allowed"
                        />
                        {analyzingPmh && <p className="text-xs text-slate-500">Analyzing file…</p>}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-800">
                            AI-extracted PMH (editable)
                          </label>
                          <textarea
                            rows={3}
                            value={pmhExtracted}
                            disabled={status !== "idle"}
                            onChange={(e) => setPmhExtracted(e.target.value)}
                            placeholder="Extracted PMH will appear here. Edit freely."
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                          />
                          <p className="text-[11px] text-slate-500">
                            You can edit this text. It will be shared with the assistant and your clinician.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            Current medications (Optional)
                          </p>
                          <p className="text-xs text-slate-500">
                            Type them in, or upload a photo/PDF and we’ll extract them below.
                          </p>
                        </div>
                        {medListPreview ? (
                          <img
                            src={medListPreview}
                            alt="Medication list preview"
                            className="h-12 w-12 rounded-lg border border-slate-200 object-cover"
                          />
                        ) : null}
                      </div>
                      <textarea
                        id="current-medications"
                        name="currentMedications"
                        rows={2}
                        value={currentMedications}
                        disabled={status !== "idle"}
                        onChange={(event) => setCurrentMedications(event.target.value)}
                        aria-label="Current medications"
                        placeholder="e.g., amlodipine 5 mg daily, metformin 500 mg BID (leave blank for 'None')"
                        className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                      />
                      <div className="space-y-2">
                        <input
                          type="file"
                          accept="image/*,.heic,.heif,.pdf"
                          disabled={status !== "idle"}
                          aria-label="Upload medication list photo or PDF"
                          onChange={async (event) => {
                            const file = event.target.files?.[0] ?? null;
                            if (medListPreview) {
                              URL.revokeObjectURL(medListPreview);
                            }
                            if (!file) {
                              setMedListPhoto(null);
                              setMedListPreview(null);
                              setMedListExtracted("");
                              return;
                            }
                            if (file.size > 6 * 1024 * 1024) {
                              setError(
                                "File too large (max 6MB). Please choose a smaller/clearer image or PDF."
                              );
                              return;
                            }
                            const previewUrl = URL.createObjectURL(file);
                            setMedListPhoto(file);
                            setMedListPreview(previewUrl);
                            setAnalyzingMedList(true);
                            setMedListExtracted("");
                            try {
                              const formData = new FormData();
                              formData.append("image", file);
                              formData.append("mode", "medications");
                              const response = await fetch("/api/analyze-med-pmh", {
                                method: "POST",
                                body: formData,
                              });
                              if (!response.ok) {
                                const errJson = await response.json().catch(() => ({}));
                                throw new Error(
                                  errJson.error || errJson.details || "Failed to analyze photo."
                                );
                              }
                              const data = (await response.json()) as { summary?: string };
                              if (data.summary) {
                                const summary = data.summary.trim();
                                const parsed = parseMedPmhSummary(summary);
                                const medsOnly = parsed.meds || summary;
                                setMedListExtracted(medsOnly);
                                if (!currentMedications.trim()) {
                                  setCurrentMedications(medsOnly);
                                }
                              }
                            } catch (err) {
                              console.error("[page.tsx] Med list photo analysis error:", err);
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to analyze the photo. Please try again."
                              );
                            } finally {
                              setAnalyzingMedList(false);
                            }
                          }}
                          className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:border-slate-300 hover:file:bg-slate-50 disabled:cursor-not-allowed"
                        />
                        {analyzingMedList && <p className="text-xs text-slate-500">Analyzing file…</p>}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-800">
                            AI-extracted medications (editable)
                          </label>
                          <textarea
                            rows={3}
                            value={medListExtracted}
                            disabled={status !== "idle"}
                            onChange={(e) => setMedListExtracted(e.target.value)}
                            placeholder="Extracted medications will appear here. Edit freely."
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                          />
                          <p className="text-[11px] text-slate-500">
                            You can edit this text. It will be shared with the assistant and your clinician.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="family-history"
                        className="text-sm font-medium text-slate-800"
                      >
                        Family history (Optional)
                      </label>
                      <textarea
                        id="family-history"
                        name="familyHistory"
                        rows={2}
                        value={familyHistory}
                        disabled={status !== "idle"}
                        onChange={(event) => setFamilyHistory(event.target.value)}
                        aria-label="Family history"
                        placeholder="e.g., mother with HTN, father with type 2 diabetes (leave blank for 'None')"
                        className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor="family-doctor"
                        className="text-sm font-medium text-slate-800"
                      >
                        Family doctor (Optional)
                      </label>
                      <input
                        id="family-doctor"
                        name="familyDoctor"
                        type="text"
                        value={familyDoctor}
                        disabled={status !== "idle"}
                        onChange={(event) => setFamilyDoctor(event.target.value)}
                        aria-label="Family doctor"
                        placeholder='e.g., Dr. Kim Lee (leave blank for "Unknown")'
                        className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                      />
                    </div>

                    <div className="space-y-4">
                      <label
                        htmlFor="pharmacy-name"
                        className="text-sm font-medium text-slate-800"
                      >
                        Pharmacy (Optional)
                      </label>
                      <div className="space-y-2">
                        <label
                          htmlFor="pharmacy-name"
                          className="text-sm font-medium text-slate-800"
                        >
                          Pharmacy name (Optional)
                        </label>
                        <input
                          id="pharmacy-name"
                          name="pharmacyName"
                          type="text"
                          value={pharmacyNameInput}
                          disabled={status !== "idle"}
                          onChange={(event) => setPharmacyNameInput(event.target.value)}
                          placeholder="e.g., Shoppers Drug Mart"
                          className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor="pharmacy-number"
                          className="text-sm font-medium text-slate-800"
                        >
                          Pharmacy number
                        </label>
                        <input
                          id="pharmacy-number"
                          name="pharmacyNumber"
                          type="text"
                          value={pharmacyNumberInput}
                          disabled={status !== "idle"}
                          onChange={(event) => setPharmacyNumberInput(event.target.value)}
                          placeholder="e.g., 12345"
                          className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor="pharmacy-address"
                          className="text-sm font-medium text-slate-800"
                        >
                          Pharmacy street address
                        </label>
                        <input
                          id="pharmacy-address"
                          name="pharmacyAddress"
                          type="text"
                          value={pharmacyAddressInput}
                          disabled={status !== "idle"}
                          onChange={(event) => setPharmacyAddressInput(event.target.value)}
                          placeholder="e.g., 1221 Lynn Valley Rd"
                          className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                        />
                      </div>

                      <div className="space-y-2">
                        <label
                          htmlFor="pharmacy-city"
                          className="text-sm font-medium text-slate-800"
                        >
                          Pharmacy city
                        </label>
                        <input
                          id="pharmacy-city"
                          name="pharmacyCity"
                          type="text"
                          value={pharmacyCityInput}
                          disabled={status !== "idle"}
                          onChange={(event) => setPharmacyCityInput(event.target.value)}
                          placeholder="e.g., North Vancouver"
                          className="w-full rounded-2xl border border-slate-200 bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => searchPharmacy()}
                          className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                          disabled={
                            status !== "idle" ||
                            searchingPharmacy ||
                            pharmacyNameInput.trim() === "" ||
                            pharmacyAddressInput.trim() === ""
                          }
                        >
                          {searchingPharmacy ? "Searching..." : "Search pharmacy"}
                        </button>
                        <p className="text-xs text-slate-500">
                          Provide the pharmacy details, then search to auto-fill phone and fax.
                        </p>
                      </div>

                      {pharmacyInfo && (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm">
                          <p className="font-semibold text-emerald-900">{pharmacyInfo.name}</p>
                          <p className="mt-1 text-emerald-800">{pharmacyInfo.address}</p>
                          {pharmacyInfo.phone ? (
                            <p className="mt-1 text-emerald-700">
                              <span className="font-medium">Tel:</span> {pharmacyInfo.phone}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs italic text-slate-500">
                              Phone number not available from search
                            </p>
                          )}
                          {pharmacyInfo.fax ? (
                            <p className="mt-1 text-emerald-700">
                              <span className="font-medium">Fax:</span> {pharmacyInfo.fax}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs italic text-slate-500">
                              Fax number not available from search
                            </p>
                          )}
                        </div>
                      )}
                      {!pharmacyInfo &&
                        !searchingPharmacy &&
                        (pharmacyNameInput.trim() !== "" ||
                          pharmacyAddressInput.trim() !== "") && (
                        <p className="text-xs italic text-slate-500">
                          Pharmacy information will appear here after search. If not found, you can manually enter the details.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {error && !error.startsWith("Your response is too long") && <p className="text-xs text-red-600">{error}</p>}
              </div>

              <div className={`mt-3 flex flex-wrap gap-3${status !== "idle" ? " hidden sm:flex" : ""}`}>
                <button
                  type="submit"
                  className="inline-flex flex-1 items-center justify-center rounded-2xl bg-[#52A882] px-5 py-2.5 text-base font-semibold text-white transition hover:bg-[#459970] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#52A882] disabled:cursor-not-allowed disabled:bg-[#F2FCF8] disabled:text-[#3a7a5e]"
                  disabled={status !== "idle" || chiefComplaint.length < 3 || !language}
                >
                  {uiT.startInterview || "Start interview"}
                </button>
              </div>
            </form>

            <div className={`mt-2 h-px w-full bg-slate-200/70${status !== "idle" ? " hidden sm:block" : ""}`} aria-hidden="true" />

            {/* Mobile only: hamburger + "Guided Interview" title ABOVE the box border */}
            {status !== "idle" && (
              <div className="sm:hidden flex items-center mt-3 mb-1">
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowHamburgerMenu((v) => !v)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition"
                    aria-label="Menu"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  {showHamburgerMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowHamburgerMenu(false)} />
                      <div className="absolute left-0 top-9 z-20 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setShowHamburgerMenu(false);
                            if (window.confirm("Are you sure you want to reset the conversation? All progress will be lost.")) {
                              resetConversation();
                            }
                          }}
                          className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Reset conversation
                        </button>
                        {(status === "awaitingPatient" || status === "awaitingAi" || status === "paused") &&
                          !awaitingFinalComments &&
                          !awaitingPhqGad &&
                          !isEndingInterview && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowHamburgerMenu(false);
                              setShowEndInterviewConfirm(true);
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                            </svg>
                            End Early
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <h2 className="flex-1 text-center text-[1.05rem] font-semibold text-slate-900">
                  Guided Interview
                </h2>
                <div className="w-8 flex-shrink-0" />
              </div>
            )}

            <section className="mt-2 rounded-3xl border border-slate-100 bg-white/80 px-3 py-4 sm:px-5 sm:py-6 shadow-slate-100">
              <div className="flex flex-col gap-3 sm:flex-col sm:items-center sm:justify-center sm:gap-4">
                <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-full sm:justify-center">
                  {status === "awaitingPatient" && !isSpeaking && messages.some(m => m.role === "assistant") && (
                    <button
                      type="button"
                      onClick={() => {
                        const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
                        if (lastAssistant) speakText(getSpokenMessageContent(lastAssistant));
                      }}
                      disabled={isSpeaking}
                      className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors bg-[#F2FCF8] text-slate-700 hover:bg-[#d8f5e9] disabled:opacity-60 disabled:cursor-not-allowed"
                      title="Replay the last question"
                    >
                      🔊 {uiT.hearAgain || "Hear again"}
                    </button>
                  )}
                  {/* Mute + Video: on mobile — video on top, Mute below (flex-col-reverse);
                      gap only when video is visible so Mute stays aligned with Hear again otherwise.
                      On desktop: Mute then Video inline (sm:flex-row restores DOM order). */}
                  <div
                    className="flex flex-col-reverse items-center sm:flex-col-reverse sm:items-center sm:gap-2"
                    style={{ gap: isSpeaking && !isPaused && language.toLowerCase().startsWith("en") ? "0.5rem" : "0" }}
                  >
                    <button
                      onClick={() => {
                        setIsMuted(!isMuted);
                      }}
                      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        isMuted
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-[#F2FCF8] text-slate-700 hover:bg-[#d8f5e9]"
                      }`}
                      title={isMuted ? (uiT.unmuteTitle || "Unmute AI voice") : (uiT.muteTitle || "Mute AI voice")}
                    >
                      {isMuted ? (
                        <>
                          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipPath="url(#clip0)" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                          </svg>
                          {uiT.muted || "Muted"}
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 9l-6 6H4a1 1 0 01-1-1v-4a1 1 0 011-1h2l6-6v14z" />
                          </svg>
                          {uiT.mute || "Mute"}
                        </>
                      )}
                    </button>
                    {/* Video runs continuously (autoPlay muted) — shown/hidden via visibility CSS only.
                        Never call video.play()/pause() from JS: any JS-triggered media state change
                        during active AudioContext playback causes iOS to reconfigure AVAudioSession
                        and interrupt TTS audio. */}
                    <video
                      ref={ttsVideoRef}
                      className="w-full max-w-40 rounded-xl border border-slate-200 object-cover shadow-sm sm:w-56"
                      style={
                        isSpeaking && !isPaused && language.toLowerCase().startsWith("en")
                          ? { visibility: "visible" as const, height: "auto" }
                          : { visibility: "hidden" as const, height: 0, overflow: "hidden", border: "none" }
                      }
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="auto"
                    >
                      <source src="/Confident_Busines_woman.mp4" type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              </div>
              <div
                ref={chatRef}
                className={`mt-5 space-y-4 overflow-y-auto rounded-2xl border border-slate-100 bg-white px-2 py-3 sm:px-4 sm:py-4 text-sm text-slate-800 max-h-[360px] ${
                  interviewMode === "conversation" ? "conversation-mode" : ""
                }`}
              >
                {messages.length === 0 ? (
                  <p className="text-slate-500">
                    {interviewMode === "conversation"
                      ? "The AI assistant will ask follow-up questions to help your doctor understand your symptoms."
                      : "Once you start the interview, the assistant will ask targeted questions here."}
                  </p>
                ) : interviewMode === "conversation" ? (
                  // Conversation mode: more natural, dialogue-like presentation
                  <div className="space-y-6">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}-${message.content.slice(0, 8)}`}
                        className={`${
                          message.role === "assistant"
                            ? "flex items-start gap-3"
                            : "flex items-start gap-3 justify-end"
                        }`}
                      >
                        <div
                          className={`flex-1 ${
                            message.role === "assistant"
                              ? "max-w-[95%] sm:max-w-[85%]"
                              : "max-w-[95%] sm:max-w-[85%]"
                          }`}
                        >
                          {message.role === "assistant" ? (
                            <>
                              <div className="rounded-2xl rounded-tl-sm px-3 py-2 sm:px-5 sm:py-3 shadow-sm border border-transparent" style={{background: 'linear-gradient(90deg, #52A882 0%, #55C293 50%, #509473 100%)'}}>
                                <p className="text-white leading-relaxed whitespace-pre-wrap">
                                  {getDisplayMessageContent(message)}
                                </p>
                              </div>
                            </>
                          ) : (
                            <div
                              className={[
                                "bg-gradient-to-r from-[#FA5A6F] via-[#FFE0E5] to-[#FA5A6F] rounded-2xl rounded-tr-sm px-3 py-2 sm:px-5 sm:py-3 text-slate-900 text-left ml-auto relative group max-w-full shadow-sm",
                                // When editing/adding, expand the bubble so the textarea isn't cramped on desktop/tablet.
                                addingToMessageIndex === index || editingMessageIndex === index
                                  ? "block w-full"
                                  : "inline-block",
                                // Visual affordance: make it obvious when provider is editing a patient message.
                                editingMessageIndex === index
                                  ? "ring-4 ring-red-300 ring-offset-2 ring-offset-slate-50 bg-gradient-to-r from-[#FA5A6F] via-[#FFE0E5] to-[#FA5A6F] shadow-md"
                                  : "",
                              ].join(" ")}
                            >
                              {addingToMessageIndex === index && !isInterviewComplete ? (
                                <div className="space-y-2 w-full">
                                  <p className="mb-2 text-sm text-slate-900">Original: {message.content}</p>
                                  <textarea
                                    value={addingContent}
                                    onChange={(e) => setAddingContent(e.target.value)}
                                    className="w-full min-h-[60px] resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                                    rows={Math.max(minPatientBubbleRows, addingContent.split('\n').length)}
                                    placeholder="Add additional comments..."
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setAddingToMessageIndex(null);
                                        setAddingContent("");
                                      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        if (addingContent.trim()) {
                                          const newContent = messagesRef.current[index].content + " " + addingContent.trim();
                                          setMessages((current) => {
                                            const updated = [...current];
                                            updated[index] = {
                                              ...updated[index],
                                              content: newContent,
                                            };
                                            return updated;
                                          });
                                          messagesRef.current[index] = {
                                            ...messagesRef.current[index],
                                            content: newContent,
                                          };
                                        }
                                        setAddingToMessageIndex(null);
                                        setAddingContent("");
                                      }
                                    }}
                                  />
                                  <div className="flex items-center gap-2 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAddingToMessageIndex(null);
                                        setAddingContent("");
                                      }}
                                      className="px-3 py-1.5 text-xs font-medium text-white bg-slate-500/80 rounded-lg hover:bg-slate-600 transition"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (addingContent.trim()) {
                                          const newContent = messagesRef.current[index].content + " " + addingContent.trim();
                                          setMessages((current) => {
                                            const updated = [...current];
                                            updated[index] = {
                                              ...updated[index],
                                              content: newContent,
                                            };
                                            return updated;
                                          });
                                          messagesRef.current[index] = {
                                            ...messagesRef.current[index],
                                            content: newContent,
                                          };
                                        }
                                        setAddingToMessageIndex(null);
                                        setAddingContent("");
                                      }}
                                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition"
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>
                              ) : editingMessageIndex === index && !isInterviewComplete ? (
                                <div className="space-y-2 w-full">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-semibold text-red-100 bg-red-600/70 px-2 py-0.5 rounded-full border border-red-200/40">
                                      Editing
                                    </span>
                                    <span className="text-[11px] text-emerald-50/90">
                                      Save or Cancel
                                    </span>
                                  </div>
                                  <textarea
                                    value={editingContent}
                                    onChange={(e) => setEditingContent(e.target.value)}
                                    className="w-full bg-white text-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none min-h-[60px]"
                                    rows={Math.max(minPatientBubbleRows, editingContent.split('\n').length)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') {
                                        setEditingMessageIndex(null);
                                        setEditingContent("");
                                      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        if (editingContent.trim()) {
                                          setMessages((current) => {
                                            const updated = [...current];
                                            updated[index] = {
                                              ...updated[index],
                                              content: editingContent.trim(),
                                            };
                                            return updated;
                                          });
                                        }
                                        setEditingMessageIndex(null);
                                        setEditingContent("");
                                      }
                                    }}
                                  />
                                  <div className="flex items-center gap-2 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingMessageIndex(null);
                                        setEditingContent("");
                                      }}
                                      className="px-3 py-1.5 text-xs font-medium text-white bg-slate-500/80 rounded-lg hover:bg-slate-600 transition"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (editingContent.trim()) {
                                          setMessages((current) => {
                                            const updated = [...current];
                                            updated[index] = {
                                              ...updated[index],
                                              content: editingContent.trim(),
                                            };
                                            return updated;
                                          });
                                        }
                                        setEditingMessageIndex(null);
                                        setEditingContent("");
                                      }}
                                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <p className="leading-relaxed whitespace-pre-wrap">
                                    {message.content}
                                  </p>
                                  {!isInterviewComplete && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isInterviewComplete) return;
                                        setEditingMessageIndex(index);
                                        setEditingContent(message.content);
                                      }}
                                      className="absolute -bottom-2.5 right-3 rounded-full border-2 border-white bg-[#FA5A6F] px-2.5 py-0.5 text-xs font-medium text-white shadow-sm transition hover:bg-[#e04460]"
                                      title="Edit this message"
                                    >
                                      Edit
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Chatbot mode: original chat bubble style
                  messages.map((message, index) => (
                    <article
                      key={`${message.role}-${index}-${message.content.slice(0, 8)}`}
                      className={`flex ${
                        message.role === "assistant"
                          ? "justify-start"
                          : "justify-end"
                      }`}
                    >
                      <div
                        className={`max-w-xs rounded-2xl px-4 py-2 flex items-start gap-2 ${
                          message.role === "assistant"
                            ? "text-white shadow"
                            : "bg-slate-900 text-white"
                        }`}
                        style={message.role === "assistant" ? {background: 'linear-gradient(90deg, #52A882 0%, #55C293 50%, #509473 100%)'} : undefined}
                      >
                        <p className="flex-1">{getDisplayMessageContent(message)}</p>
                        {message.role === "assistant" && index === messages.length - 1 && isSpeaking && (
                          <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center mt-0.5">
                            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" title="Reading question aloud"></div>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
              {status === "complete" && (
                <p className="mt-3 text-sm font-medium text-emerald-600">
                  You are done. You will soon be contacted by your physician.
                </p>
              )}
              {status === "saving" && (
                <p className="mt-3 text-sm font-medium text-amber-700 animate-pulse">
                  Finalizing and saving your interview...
                </p>
              )}
              {sessionSaveError && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <p>{sessionSaveError}</p>
                  <button
                    type="button"
                    onClick={() => void retrySessionSave()}
                    disabled={savingSession}
                    className="mt-2 inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                  >
                    {savingSession ? "Retrying..." : "Retry save"}
                  </button>
                </div>
              )}

              {status !== "complete" && status !== "saving" && (
              <form
                onSubmit={handlePatientSubmit}
                className={`mt-5 flex flex-col gap-3 ${
                  interviewMode === "conversation" ? "conversation-input" : ""
                }`}
              >
                {interviewMode === "conversation" ? (
                  <>
                    {awaitingPhqGad && (
                      <PhqGadForm language={language} onSubmit={(results) => void handlePhqGadSubmit(results)} />
                    )}
                    {awaitingFinalComments && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                        <p className="text-sm font-medium text-slate-800">
                          {uiT.finalCommentsQuestion || "Do you have any last comments or questions for your provider?"}
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => {
                              setFinalCommentsChoice("yes");
                              setError(null);
                              resetDraftTranscript("final-comments-yes");
                              setPatientResponse("");
                              patientResponseRef.current = "";
                            }}
                            disabled={status !== "awaitingPatient" || isSubmittingResponse}
                            className={`inline-flex min-h-[56px] items-center justify-center rounded-2xl px-5 py-3 text-base font-semibold transition ${
                              finalCommentsChoice === "yes"
                                ? "bg-emerald-600 text-white"
                                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {uiT.finalCommentsYes || "Yes"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (status !== "awaitingPatient" || isSubmittingResponse) {
                                return;
                              }
                              setFinalCommentsChoice("no");
                              setError(null);
                              resetDraftTranscript("final-comments-no");
                              setPatientResponse("");
                              patientResponseRef.current = "";
                              void handlePatientSubmit(undefined, {
                                finalChoiceOverride: "no",
                              });
                            }}
                            disabled={status !== "awaitingPatient" || isSubmittingResponse}
                            className={`inline-flex min-h-[56px] items-center justify-center rounded-2xl px-5 py-3 text-base font-semibold transition ${
                              finalCommentsChoice === "no"
                                ? "bg-slate-900 text-white"
                                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                            } disabled:cursor-not-allowed disabled:opacity-60`}
                          >
                            {uiT.finalCommentsNo || "No"}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="text-[0.9rem] text-slate-400" aria-live="polite">
                      <p className="flex flex-wrap items-center gap-1">
                        {showInterviewProgress ? (
                          <>
                            <span>Interview progress:</span>
                            <span>
                              {interviewProgress.questionsAsked} of ~
                              {interviewProgress.approxTotalQuestions} questions
                            </span>
                          </>
                        ) : (
                          <>
                            <span>Interview status:</span>
                            <span>{statusCopy[status]}</span>
                          </>
                        )}
                        {interviewStartTime && status !== "idle" && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span>{elapsedTimeLabel}</span>
                          </>
                        )}
                      </p>
                      {showInterviewProgress && (
                        <div
                          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#FA5A6F] via-[#FFE0E5] to-[#FA5A6F] transition-[width] duration-300 ease-out"
                            style={{ width: `${interviewProgressPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {showResponseBox && !awaitingPhqGad && (
                      <div className="group flex flex-col items-center">
                        <div className="relative w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition">
                        <textarea
                          ref={draftTextareaRef}
                          rows={2}
                          placeholder={
                            awaitingFinalComments && finalCommentsChoice === "yes"
                              ? "Type your final comment for your provider."
                              : "Tap mic to start/stop or type your response."
                          }
                          value={draftTranscript}
                          disabled={
                            isSubmittingResponse ||
                            (awaitingFinalComments && finalCommentsChoice !== "yes")
                          }
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            const nextTrimmedLength = nextValue.trim().length;
                            if (hasPendingSubmission && nextTrimmedLength > 0) {
                              setHasPendingSubmission(false);
                            }
                            if (status === "awaitingPatient") {
                              if (nextTrimmedLength > 0) {
                                setShowReview(true);
                                setMicWarning(null);
                              } else if (showReview && !draftTranscriptRef.current.trim()) {
                                setShowReview(false);
                              }
                            }
                            setDraftTranscript(nextValue);
                            autoresizeDraftTextarea();
                          }}
                          className={[
                            "mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2 pt-2 text-sm text-slate-800 outline-none transition focus:border-[#80D7FF] focus:ring-2 focus:ring-[#C0ECFC]",
                            "pb-2",
                            "text-left",
                            "overflow-hidden",
                          ].join(" ")}
                        />
                        {error && error.startsWith("Your response is too long") && (
                          <p className="mt-2 text-xs text-red-600">{error}</p>
                        )}
                        {showReviewActions && (
                          <div className="mt-2 flex items-center justify-end gap-2 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={
                                isSpeechBusy ||
                                isSubmittingResponse ||
                                hasPendingSubmission ||
                                (awaitingFinalComments && finalCommentsChoice !== "yes")
                              }
                              onPointerDown={(event) => {
                                event.preventDefault();
                                if (!isSpeechBusy && !isSubmittingResponse && !hasPendingSubmission) {
                                  handleSubmitWithSttReview(() => commitDraftToResponseOnce(true));
                                }
                              }}
                              onPointerUp={() => {
                              }}
                              onClick={() => {
                                if (!isSpeechBusy && !isSubmittingResponse && !hasPendingSubmission) {
                                  handleSubmitWithSttReview(() => commitDraftToResponseOnce(true));
                                }
                              }}
                            className="inline-flex min-h-[31px] sm:min-h-[26px] items-center justify-center rounded-full bg-gradient-to-r from-[#FA5A6F] via-[#FFE0E5] to-[#FA5A6F] px-2.5 py-1.5 sm:py-1 text-xs font-medium text-slate-900 shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Submit
                            </button>
                            <button
                              type="button"
                              disabled={
                                isSubmittingResponse ||
                                hasPendingSubmission ||
                                (awaitingFinalComments && finalCommentsChoice !== "yes")
                              }
                              onClick={() => {
                                redoDraftTranscript();
                              }}
                              className="inline-flex min-h-[24px] sm:min-h-0 items-center justify-center rounded-full border border-slate-200 px-2.5 py-1 sm:py-0.5 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Redo
                            </button>
                          </div>
                        )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            toggleListening({ allowDuringReview: true });
                          }}
                          disabled={
                            status !== "awaitingPatient" ||
                            isPaused ||
                            cleaningTranscript ||
                            (awaitingFinalComments && finalCommentsChoice !== "yes")
                          }
                          style={{ touchAction: "manipulation", WebkitUserSelect: "none", userSelect: "none" }}
                          className={`mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2 text-base font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 select-none ${
                            micUiState === "listening"
                              ? "gi-animate-mic-pulse border border-red-700 bg-red-600 text-white shadow-red-300/60 focus-visible:outline-red-600"
                              : micUiState === "starting"
                                ? "bg-amber-500 text-white border border-amber-500 focus-visible:outline-amber-500"
                              : (status === "awaitingAi" && !isPaused)
                                ? "bg-orange-500 text-white border border-orange-500 focus-visible:outline-orange-500"
                              : "border border-[#52A882] bg-[#52A882] text-white focus-visible:outline-[#52A882]"
                          } ${isCoarsePointer ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                          title={micButtonTitle}
                        >
                          {isTranscribing ? (
                            <span className="inline-flex" aria-label="Transcribing">
                              {"TRANSCRIBING".split("").map((letter, i) => (
                                <span
                                  key={i}
                                  className="animate-bounce inline-block"
                                  style={{ animationDelay: `${i * 0.08}s`, animationDuration: "0.96s" }}
                                >
                                  {letter}
                                </span>
                              ))}
                            </span>
                          ) : status === "awaitingAi" && !isPaused ? (
                            <span className="inline-flex items-center gap-1 animate-pulse">
                              <span className="inline-block w-5 font-mono">{spinnerFrames[spinnerFrame]}</span>{thinkingStatusLabel}
                            </span>
                          ) : (
                            <>
                              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 00-3 3v6a3 3 0 006 0V4a3 3 0 00-3-3z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 01-14 0v-2" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19v4m-4 0h8" />
                              </svg>
                              {micButtonLabel}
                            </>
                          )}
                        </button>
                        <div className={`mt-2 flex min-h-[20px] w-full items-center gap-3 text-xs ${showListeningDecor ? "justify-center" : "justify-between"}`}>
                          {micWarning ? (
                            <p className="text-amber-600">{micWarning}</p>
                          ) : (
                            <div className="flex items-center gap-2">
                              {showListeningDecor && (
                                <span
                                  aria-hidden="true"
                                  className="gi-voice-bars text-red-600"
                                >
                                  <span className="gi-voice-bar gi-voice-bar--1" />
                                  <span className="gi-voice-bar gi-voice-bar--2" />
                                  <span className="gi-voice-bar gi-voice-bar--3" />
                                  <span className="gi-voice-bar gi-voice-bar--4" />
                                </span>
                              )}
                              <p className={showListeningDecor ? "font-semibold text-red-600" : micStatusClassName}>
                                {showListeningDecor ? "Listening..." : (isTranscribing ? null : micStatusText)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {/* End button and paused status - moved below Listening box */}
                    <div className="flex items-center justify-between gap-3 mt-4 relative z-0">
                      <div className="flex items-center gap-3">
                        {/* Reset conversation — desktop only (mobile uses hamburger menu) */}
                        {status !== "idle" && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Are you sure you want to reset the conversation? All progress will be lost.")) {
                                resetConversation();
                              }
                            }}
                            className="hidden sm:flex items-center gap-1 px-2 py-1 text-[0.6rem] font-medium text-slate-600 bg-[#F2FCF8] rounded-md hover:bg-[#d8f5e9] transition whitespace-nowrap"
                          >
                            Reset conversation
                          </button>
                        )}
                        {/* Paused status */}
                        {status === "paused" && (
                          <span className="text-sm text-slate-500">
                            {pauseCountdownSeconds !== null
                              ? `Paused — ending in ${Math.floor(pauseCountdownSeconds / 60)}:${String(
                                  pauseCountdownSeconds % 60
                                ).padStart(2, "0")} unless resumed`
                              : "Paused"}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 justify-end">
                        {/* End button — desktop only (mobile uses hamburger menu) */}
                        {(status === "awaitingPatient" || status === "awaitingAi" || status === "paused") &&
                          !awaitingFinalComments &&
                          !awaitingPhqGad &&
                          !isEndingInterview && (
                          <button
                            type="button"
                            onClick={() => setShowEndInterviewConfirm(true)}
                            className="hidden sm:flex items-center gap-1 px-2 py-1 text-[0.6rem] font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition whitespace-nowrap"
                            title="End Early"
                          >
                            <svg
                              className="w-2 h-2 flex-shrink-0"
                              fill="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                            </svg>
                            <span>End Early</span>
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Body part diagrams - shown below buttons, side by side if multiple */}
                    {diagramUnmarkedWarning && showBodyDiagram && (
                      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
                        Please tap the diagram to mark where you feel the pain, then press <strong>Done</strong>. Or submit again to skip.
                      </div>
                    )}
                    {showBodyDiagram && selectedBodyParts.length > 0 && (
                      <div className="mt-4 mb-4 flex flex-wrap justify-center gap-4 z-10 relative">
                        {selectedBodyParts.map((bodyPart, index) => {
                          const safeSide = bodyPart.side === "both" ? undefined : bodyPart.side;
                          const markerSelection = selectedDiagramMarkers.find(
                            (selection) =>
                              selection.part === bodyPart.part && selection.side === safeSide,
                          );
                          return (
                          <BodyPartDiagram
                            key={`${bodyPart.part}-${bodyPart.side || 'none'}-${index}`}
                            bodyPart={bodyPart.part as any}
                            side={safeSide}
                            sex={sex === "female" || sex === "male" ? sex : undefined}
                            markers={markerSelection?.markers || []}
                            onMarkerAdd={({ part, side, marker }) => {
                              setDiagramUnmarkedWarning(false);
                              let nextSelections: DiagramMarkerSelection[] = [];
                              setSelectedDiagramMarkersWithRef((prev) => {
                                const key = getDiagramMarkerKey(part, side);
                                const indexForPart = prev.findIndex(
                                  (selection) =>
                                    getDiagramMarkerKey(selection.part, selection.side) === key,
                                );
                                if (indexForPart === -1) {
                                  nextSelections = [{ part, side, markers: [marker] }, ...prev];
                                  return nextSelections;
                                }
                                const updated = [...prev];
                                const existing = updated[indexForPart];
                                updated[indexForPart] = {
                                  ...existing,
                                  markers: [...existing.markers, marker].slice(0, 30),
                                };
                                nextSelections = updated;
                                return updated;
                              });
                              if (
                                shouldAutoUpdateDiagramResponse(
                                  patientResponseRef.current,
                                  language,
                                )
                              ) {
                                const markerResponse = buildDiagramMarkerResponse(
                                  nextSelections,
                                  language,
                                );
                                setPatientResponseWithRef(markerResponse);
                              }
                            }}
                            onMarkersClear={() => {
                              setSelectedDiagramMarkersWithRef((prev) =>
                                prev.filter(
                                  (selection) =>
                                    selection.part !== bodyPart.part || selection.side !== safeSide,
                                ),
                              );
                            }}
                            onMarkersDone={() => {
                              markDiagramAsDone();
                            }}
                          />
                        );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <label
                      htmlFor="patient-response-chatbot"
                      className="text-sm font-medium text-slate-700"
                    >
                      Your response
                    </label>
                    <div className="relative">
                      <textarea
                        ref={patientResponseInputRef}
                        id="patient-response-chatbot"
                        name="patientResponse"
                        rows={4}
                        maxLength={1000}
                        placeholder={
                          status === "awaitingPatient"
                            ? isSpeaking
                              ? "AI is speaking... please wait"
                              : "Tap mic to start/stop (or type your response)"
                            : "Start the interview to respond."
                        }
                        value={patientResponse}
                        onChange={(event) => {
                          const val = event.target.value;
                          setPatientResponse(val);
                          patientResponseRef.current = val;
                          updateSelectionRef(event.target);
                        }}
                        onSelect={(event) => {
                          const target = event.target as HTMLTextAreaElement;
                          updateSelectionRef(target);
                        }}
                        onKeyUp={(event) => updateSelectionRef(event.target as HTMLTextAreaElement)}
                        onClick={(event) => updateSelectionRef(event.target as HTMLTextAreaElement)}
                        onMouseUp={(event) => updateSelectionRef(event.target as HTMLTextAreaElement)}
                        onFocus={(event) => updateSelectionRef(event.target as HTMLTextAreaElement)}
                        disabled={status !== "awaitingPatient" || isSpeaking}
                        className={`w-full rounded-2xl border bg-[#F2FCF8] px-4 py-3 text-base text-slate-900 outline-none transition focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 ${
                          isListening
                            ? "border-[#80D7FF] ring-2 ring-[#C0ECFC]"
                            : "border-slate-200 focus:border-slate-400"
                        }`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          toggleListening();
                        }}
                        disabled={
                          status !== "awaitingPatient" ||
                          isPaused ||
                          cleaningTranscript ||
                          showReview
                        }
                        style={{
                          touchAction: "manipulation",
                          WebkitUserSelect: "none",
                          userSelect: "none",
                          WebkitTapHighlightColor: "transparent",
                        }}
                        className={`inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-semibold transition select-none ${
                          micUiState === "listening"
                            ? "gi-animate-mic-pulse border border-red-700 bg-red-600 text-white shadow-sm shadow-red-300/60 hover:bg-red-700"
                            : micUiState === "starting"
                              ? "bg-amber-500 text-white hover:bg-amber-600"
                            : "bg-[#52A882] text-white hover:bg-[#459970]"
                        } appearance-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-[#a8d4bc] disabled:text-white`}
                        title={micButtonLabel}
                      >
                        {isTranscribing ? (
                          <span className="inline-flex" aria-label="Transcribing">
                            {"TRANSCRIBING".split("").map((letter, i) => (
                              <span
                                key={i}
                                className="animate-bounce inline-block"
                                style={{ animationDelay: `${i * 0.08}s`, animationDuration: "0.96s" }}
                              >
                                {letter}
                              </span>
                            ))}
                          </span>
                        ) : status === "awaitingAi" && !isPaused ? (
                          <span className="inline-flex items-center gap-1 animate-pulse">
                            <span className="inline-block w-5 font-mono">{spinnerFrames[spinnerFrame]}</span>{thinkingStatusLabel}
                          </span>
                        ) : micButtonLabel}
                      </button>
                    </div>
                    <div className={`flex min-h-[20px] items-center gap-3 text-xs ${showListeningDecor ? "justify-center" : "justify-between"}`}>
                      {micWarning ? (
                        <p className="text-amber-600">{micWarning}</p>
                      ) : (
                        <div className="flex items-center gap-2">
                          {showListeningDecor && (
                            <span
                              aria-hidden="true"
                              className="gi-voice-bars text-red-600"
                            >
                              <span className="gi-voice-bar gi-voice-bar--1" />
                              <span className="gi-voice-bar gi-voice-bar--2" />
                              <span className="gi-voice-bar gi-voice-bar--3" />
                              <span className="gi-voice-bar gi-voice-bar--4" />
                            </span>
                          )}
                          <p className={showListeningDecor ? "font-semibold text-red-600" : micStatusClassName}>
                            {showListeningDecor ? "Listening..." : (isTranscribing ? null : micStatusText)}
                          </p>
                        </div>
                      )}
                    </div>
                    {isSubmittingResponse && (
                      <p className="text-xs text-slate-500">Submitting response...</p>
                    )}
                    {showReview && draftTranscript.trim().length > 0 && (
                      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Looks right?</p>
                        <p className="mt-2 whitespace-pre-wrap">{draftTranscript}</p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            disabled={isSpeechBusy || isSubmittingResponse}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              if (!isSpeechBusy && !isSubmittingResponse && !hasPendingSubmission) {
                                handleSubmitWithSttReview(() => commitDraftToResponseOnce());
                              }
                            }}
                            onPointerUp={() => {
                            }}
                            onClick={() => {
                              if (!isSpeechBusy && !isSubmittingResponse && !hasPendingSubmission) {
                                handleSubmitWithSttReview(() => commitDraftToResponseOnce());
                              }
                            }}
                            className="inline-flex min-h-[108px] sm:min-h-[74px] items-center justify-center rounded-xl bg-gradient-to-r from-[#FA5A6F] via-[#FFE0E5] to-[#FA5A6F] px-4 py-2.5 sm:py-2 text-sm font-semibold text-slate-900 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isSubmittingResponse ? "Sending..." : "Submit"}
                          </button>
                          <button
                            type="button"
                            disabled={isSubmittingResponse}
                            onClick={redoDraftTranscript}
                            className="inline-flex min-h-[53px] sm:min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 sm:py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Redo
                          </button>
                        </div>
                      </div>
                    )}
                    {patientResponse.length > 800 && (
                      <p className="text-xs text-slate-500">
                        {1000 - patientResponse.length} characters remaining
                      </p>
                    )}
                  </>
                )}
                {/* Send button for chatbot mode */}
                {interviewMode !== "conversation" && (
                  <button
                    type="submit"
                    onClick={() => stopListening()}
                    className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    disabled={
                      status !== "awaitingPatient" || patientResponse.trim() === ""
                    }
                  >
                    Send
                  </button>
                )}
                {showImagePrompt && wantsToUploadImage === null && (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-700">
                    <p className="font-medium text-slate-800">
                      A photo can help with assessment.
                    </p>
                    <p className="mt-1 text-slate-600">
                      Would you like to upload a photo of the affected area?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setWantsToUploadImage(true)}
                        className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        Yes, upload photo
                      </button>
                      <button
                        type="button"
                        onClick={() => setWantsToUploadImage(false)}
                        className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        No, continue without photo
                      </button>
                    </div>
                  </div>
                )}

                {showImagePrompt && wantsToUploadImage === true && !selectedImage && !selectedImagePreview && (
                  <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-700">
                    <label
                      htmlFor="lesion-photo"
                      className="text-xs font-medium text-slate-800"
                    >
                      Optional photo upload
                    </label>
                    <input
                      id="lesion-photo"
                      name="lesionPhoto"
                      type="file"
                      accept="image/*,.heic,.heif"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (selectedImagePreview) {
                          URL.revokeObjectURL(selectedImagePreview);
                        }
                        if (file) {
                          if (file.size > LESION_UPLOAD_MAX_BYTES) {
                            setError("Uploaded photo exceeds 6MB. Please choose a smaller image.");
                            setSelectedImage(null);
                            setSelectedImagePreview(null);
                            setImageSummary(null);
                            setAnalyzingImage(false);
                            return;
                          }
                          const previewUrl = URL.createObjectURL(file);
                          setSelectedImage(file);
                          setSelectedImagePreview(previewUrl);
                          setAnalyzingImage(true);
                          setImageSummary(null);
                          const formData = new FormData();
                          formData.append("image", file);
                          fetch("/api/analyze-lesion", {
                            method: "POST",
                            body: formData,
                          })
                            .then(async (response) => {
                              if (!response.ok) {
                                const errorData = (await response.json().catch(() => ({}))) as {
                                  error?: string;
                                  details?: string;
                                };
                                const errorMessage = errorData.error || errorData.details || "Image analysis failed.";
                                throw new Error(errorMessage);
                              }
                              const data = (await response.json()) as {
                                summary?: string;
                              };
                              if (data.summary && data.summary.trim().length > 0) {
                                setImageSummary(data.summary.trim());
                              }
                            })
                            .catch((err) => {
                              console.error("Image analysis error:", err);
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to analyze image. Please try again."
                              );
                            })
                            .finally(() => {
                              setAnalyzingImage(false);
                            });
                        } else {
                          setSelectedImage(null);
                          setSelectedImagePreview(null);
                          setImageSummary(null);
                          setAnalyzingImage(false);
                        }
                      }}
                      className="block w-full text-xs text-slate-700 file:mr-3 file:rounded-2xl file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white file:hover:bg-slate-800"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      This photo is optional. A brief description of the visible findings will
                      be shared with the assistant to support its assessment and with your clinician.
                    </p>
                  </div>
                )}
                {showImagePrompt &&
                  wantsToUploadImage === true &&
                  (selectedImage || selectedImagePreview || analyzingImage || imageSummary) && (
                    <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-700">
                      <p className="text-xs font-medium text-slate-800">
                        Photo uploaded
                      </p>
                      {selectedImage && (
                        <p className="text-[11px] text-slate-600">
                          Selected file:{" "}
                          <span className="font-medium">{selectedImage.name}</span>
                        </p>
                      )}
                      {selectedImagePreview && (
                        <div className="mt-2">
                          <p className="text-[11px] text-slate-600">Preview:</p>
                          <img
                            src={selectedImagePreview}
                            alt="Uploaded photo preview"
                            className="mt-1 max-h-40 w-auto rounded-2xl border border-slate-200 object-contain"
                          />
                        </div>
                      )}
                      {analyzingImage && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Analyzing photo…
                        </p>
                      )}
                      {imageSummary && !analyzingImage && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          AI image summary:{" "}
                          <span className="font-medium">{imageSummary}</span>
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedImagePreview) {
                              URL.revokeObjectURL(selectedImagePreview);
                            }
                            setSelectedImage(null);
                            setSelectedImagePreview(null);
                            setImageSummary(null);
                            setAnalyzingImage(false);
                          }}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Remove photo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setWantsToUploadImage(false);
                          }}
                          className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
              </form>
              )}
            </section>
          </div>

        </section>
      </main>
      {showSttReviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="stt-review-title"
            aria-describedby="stt-review-description"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl shadow-slate-900/20"
          >
            <p className="text-sm font-semibold text-slate-500">Health Assist AI</p>
            <h2 id="stt-review-title" className="mt-2 text-xl font-semibold text-slate-900">
              {uiT.sttReviewTitle || "Review your answer"}
            </h2>
            <p id="stt-review-description" className="mt-3 text-sm leading-6 text-slate-600">
              {uiT.sttReviewBody || "Speech-to-text may occasionally make mistakes. Please make sure your answer is accurate before sending it to your physician."}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowSttReviewModal(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                {uiT.sttReviewEdit || "Edit answer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHasDismissedSttReview(true);
                  setShowSttReviewModal(false);
                  pendingSttSubmitFnRef.current?.();
                  pendingSttSubmitFnRef.current = null;
                }}
                className="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
              >
                {uiT.sttReviewSubmit || "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showEndInterviewConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="end-interview-title"
            aria-describedby="end-interview-description"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl shadow-slate-900/20"
          >
            <p className="text-sm font-semibold text-slate-500">Health Assist AI</p>
            <h2 id="end-interview-title" className="mt-2 text-xl font-semibold text-slate-900">
              End interview early?
            </h2>
            <p id="end-interview-description" className="mt-3 text-sm leading-6 text-slate-600">
              Your answers so far will be saved, and a summary will still be prepared for your
              doctor.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowEndInterviewConfirm(false)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEndInterviewConfirm(false);
                  endInterview();
                }}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                End interview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function requestTurn(
  chiefComplaint: string,
  profile: PatientProfile,
  transcript: ChatMessage[],
  imageSummary: string | null,
  labReportSummary: string | null,
  previousLabReportSummary: string | null,
  formSummary: string | null,
  interviewGuidance: string | null,
  medPmhSummary: string | null,
  patientBackground: string | null,
  patientEmail: string,
  physicianId: string,
  language: string,
  deferredIntentHint: string | null,
  detectedComplaints: string[] = [],
  forceSummary: boolean = false,
): Promise<InterviewResponse> {
  if (process.env.NODE_ENV === "development") {
    console.log("[requestTurn] Sending request with optional summary fields", {
      hasLabReportSummary: Boolean(labReportSummary),
      hasPreviousLabReportSummary: Boolean(previousLabReportSummary),
      hasFormSummary: Boolean(formSummary),
      hasInterviewGuidance: Boolean(interviewGuidance),
    });
  }
  
  const response = await fetch("/api/interview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chiefComplaint,
      patientProfile: profile,
      transcript,
      imageSummary: imageSummary ?? undefined,
      labReportSummary: labReportSummary ?? undefined,
      previousLabReportSummary: previousLabReportSummary ?? undefined,
      formSummary: formSummary ?? undefined,
      interviewGuidance: interviewGuidance ?? undefined,
      medPmhSummary: medPmhSummary ?? undefined,
      patientBackground: patientBackground ?? undefined,
      patientEmail,
      physicianId,
      language,
      deferredIntentHint: deferredIntentHint ?? undefined,
      detectedComplaints: detectedComplaints.length > 0 ? detectedComplaints : undefined,
      forceSummary,
    }),
  });

  if (!response.ok) {
    let errorPayload: {
      error?: string;
      message?: string;
      details?: unknown;
    } = {};
    
    try {
      const text = await response.text();
      if (text) {
        try {
          errorPayload = JSON.parse(text);
        } catch (parseErr) {
          // If response isn't JSON, use the text as error message
          errorPayload = { error: text || response.statusText || "Unknown error" };
        }
      }
    } catch {
      // If reading fails, use status text
      errorPayload = { error: response.statusText || "Unknown error" };
    }
    
    // Check for quota/rate limit errors
    const errorText = (errorPayload.message ?? errorPayload.error ?? "").toLowerCase();
    const isQuotaError = response.status === 429 || 
      errorText.includes("quota") || 
      errorText.includes("rate limit") ||
      errorText.includes("too many requests") ||
      errorText.includes("429");
    
    // Prefer the formatted message if available, otherwise use error, otherwise default
    let errorMessage: string;
    if (isQuotaError) {
      errorMessage = "The AI service has reached its daily request limit. Please try again later or contact your physician for assistance.";
    } else {
      errorMessage = errorPayload.message 
        ?? errorPayload.error 
        ?? "Unable to continue the interview right now.";
    }
    
    // Log error details in development
    if (process.env.NODE_ENV === "development") {
      console.error("[requestTurn] Error response:", {
        status: response.status,
        statusText: response.statusText,
        isQuotaError,
      });
    }
    
    throw new Error(errorMessage);
  }

  let responseData: InterviewResponse;
  try {
    responseData = await response.json() as InterviewResponse;
  } catch (jsonError) {
    console.error("[requestTurn] Failed to parse response JSON:", jsonError);
    // Try to get the response text for better error reporting
    let responseText = "";
    try {
      const clonedResponse = response.clone();
      responseText = await clonedResponse.text();
    } catch (textError) {
      console.error("[requestTurn] Could not read response text:", textError);
    }
    
    // Provide a more helpful error message
    const errorMessage = responseText.includes("invalid JSON") || responseText.includes("JSON")
      ? "The AI service returned an invalid response. Please try submitting your answer again."
      : "Unable to process the AI response. Please try again.";
    
    throw new Error(errorMessage);
  }

  return responseData;
}











