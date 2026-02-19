"use client";

import type { HistoryResponse } from "@/lib/history-schema";
import type {
  InterviewMessage,
  InterviewResponse,
  PatientProfile,
} from "@/lib/interview-schema";
import { detectBodyParts, getPrimaryBodyPart } from "@/lib/body-parts";
import {
  getSpeechLocale,
  languageOptions,
  normalizeLanguageCode,
} from "@/lib/speech-language";
import BodyPartDiagram from "@/components/BodyPartDiagram";
import { useEffect, useRef, useState } from "react";
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

type Status = "idle" | "awaitingAi" | "awaitingPatient" | "complete" | "paused";

const statusCopy: Record<Status, string> = {
  idle: "Enter the chief complaint and baseline history to begin.",
  awaitingAi: "Aurora is composing the next question...",
  awaitingPatient: "Answer the assistant's latest question below.",
  complete: "Interview complete. Review the summary on the right.",
  paused: "Interview paused. Click Resume to continue.",
};

const closingMessageEnglish =
  "We have reached the end of this interview. Thank you for taking the time to answer my questions. You will soon be contacted by your physician to discuss the diagnosis and management.";

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

type ChatMessage = InterviewMessage;

export default function Home() {
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
        const res = await fetch("/api/runtime-config", { method: "GET" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (cancelled) return;
        if (typeof (data as any)?.useAzureStt === "boolean") setUseAzureStt((data as any).useAzureStt);
        if (typeof (data as any)?.useAzureTts === "boolean") setUseAzureTts((data as any).useAzureTts);
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

      // Mix down to mono
      const mono = decoded.numberOfChannels === 1
        ? decoded.getChannelData(0)
        : (() => {
            const ch0 = decoded.getChannelData(0);
            const ch1 = decoded.getChannelData(1);
            const mixed = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i++) {
              mixed[i] = (ch0[i] + ch1[i]) / 2;
            }
            return mixed;
          })();

      // Resample if decodeAudioData didn't honour sampleRate hint
      let samples = mono;
      if (decoded.sampleRate !== 16000) {
        const ratio = 16000 / decoded.sampleRate;
        const newLen = Math.round(mono.length * ratio);
        const resampled = new Float32Array(newLen);
        for (let i = 0; i < newLen; i++) {
          resampled[i] = mono[Math.round(i / ratio)] ?? 0;
        }
        samples = resampled;
      }

      // Encode as 16-bit PCM WAV
      const numSamples = samples.length;
      const buffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(buffer);

      const writeStr = (off: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
      };

      writeStr(0, "RIFF");
      view.setUint32(4, 36 + numSamples * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);          // PCM sub-chunk size
      view.setUint16(20, 1, true);           // PCM format
      view.setUint16(22, 1, true);           // mono
      view.setUint32(24, 16000, true);       // sample rate
      view.setUint32(28, 16000 * 2, true);   // byte rate
      view.setUint16(32, 2, true);           // block align
      view.setUint16(34, 16, true);          // bits per sample
      writeStr(36, "data");
      view.setUint32(40, numSamples * 2, true);

      for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }

      return new Blob([buffer], { type: "audio/wav" });
    } finally {
      await audioCtx.close();
    }
  }

  async function transcribeAudio(audioBlob: Blob, lang: string): Promise<string> {
    try {
      // Convert to WAV for Azure Speech REST API compatibility
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
        console.error("[transcribeAudio] STT request failed:", res.status);
        return "";
      }
      const data = await res.json();
      const parsed = sttSchema.safeParse(data);
      if (!parsed.success) {
        console.error("[transcribeAudio] Invalid STT response:", data);
        return "";
      }
      return parsed.data.text.trim();
    } catch (err) {
      console.error("[transcribeAudio] Error:", err);
      return "";
    }
  }
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [patientResponse, setPatientResponse] = useState("");
  
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
  const updateSelectionRef = (target: HTMLTextAreaElement | null) => {
    if (!target) {
      return;
    }
    selectionRef.current = {
      start: target.selectionStart,
      end: target.selectionEnd,
    };
  };

  const normalizePunctuation = (text: string) => {
    let t = text.trim();
    // Ensure space after sentence-ending punctuation (e.g. "cough.No" → "cough. No")
    t = t.replace(/([.!?])([A-Z])/g, "$1 $2");
    // Add sentence breaks before capitalized pronouns if missing punctuation
    t = t.replace(/([a-z]) (I|He|She|They|We|You) /g, "$1. $2 ");
    // Ensure ending punctuation
    if (t.length && !/[.!?]$/.test(t)) {
      t = t + ".";
    }
    return t;
  };
  const lightCleanupTranscript = (text: string) => {
    let t = text.trim();
    t = t.replace(/\s+/g, " ");
    // Remove obvious filler tokens when isolated
    t = t.replace(/\b(um+|uh+|erm+|ah+)\b/gi, "");
    // Clean up punctuation artifacts left after filler removal
    t = t.replace(/,\s*,/g, ",");          // ", ," → ","
    t = t.replace(/\.\s*,\s*/g, ". ");     // ". , " → ". "
    t = t.replace(/,\s*\./g, ".");          // ", ." → "."
    t = t.replace(/\s+/g, " ").trim();
    // Normalize common number words (1-10)
    const numberMap: Record<string, string> = {
      zero: "0",
      one: "1",
      two: "2",
      three: "3",
      four: "4",
      five: "5",
      six: "6",
      seven: "7",
      eight: "8",
      nine: "9",
      ten: "10",
    };
    t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (match) => {
      const key = match.toLowerCase();
      return numberMap[key] ?? match;
    });
    // Normalize common units
    t = t.replace(/\bmilligrams?\b/gi, "mg");
    t = t.replace(/\bmilliliters?\b/gi, "ml");
    t = t.replace(/\bmicrograms?\b/gi, "mcg");
    return t;
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
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [pendingHistoryResult, setPendingHistoryResult] = useState<HistoryResponse | null>(null);
  const [awaitingFinalComments, setAwaitingFinalComments] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);
  const [isInvitedFlow, setIsInvitedFlow] = useState(false);
  const [physicianIdValue, setPhysicianIdValue] = useState<string | null>(null);
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [showShareLink, setShowShareLink] = useState(false);
  const [sex, setSex] = useState<PatientProfile["sex"]>("female");
  const [language, setLanguage] = useState<string>("en");
  const [ageInput, setAgeInput] = useState("");
  const [pmh, setPmh] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [familyDoctor, setFamilyDoctor] = useState("");
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
  const [pauseCountdownSeconds, setPauseCountdownSeconds] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [cleaningTranscript, setCleaningTranscript] = useState(false);
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [lastSubmittedDraft, setLastSubmittedDraft] = useState<string | null>(null);
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false);
  const [showSubmitToast, setShowSubmitToast] = useState(false);
  const [draftTranscript, setDraftTranscript] = useState<string>("");
  const [draftTranscriptRaw, setDraftTranscriptRaw] = useState<string>("");
  const [showReview, setShowReview] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const [micWarning, setMicWarning] = useState<string | null>(null);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [isSmallWidth, setIsSmallWidth] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  // Note: short "no" auto-submit removed (per request)
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);
  const hasUnlockedSpeechRef = useRef(false);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const audioPlaybackUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const chatRef = useRef<HTMLDivElement | null>(null);
  const patientResponseInputRef = useRef<HTMLTextAreaElement | null>(null);
  const patientResponseRef = useRef<string>("");
  const pendingHistoryResultRef = useRef<HistoryResponse | null>(null);
  const draftTranscriptRef = useRef<string>("");
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
  
  const [hasPhysicianId, setHasPhysicianId] = useState<boolean>(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [addingToMessageIndex, setAddingToMessageIndex] = useState<number | null>(null);
  const [addingContent, setAddingContent] = useState<string>("");
  const [showBodyDiagram, setShowBodyDiagram] = useState(false);
  const [selectedBodyParts, setSelectedBodyParts] = useState<Array<{ part: string; side?: "left" | "right" | "both" }>>([]);
  const [selectedDiagramArea, setSelectedDiagramArea] = useState<number | null>(null);
  const [hasAutoShownBodyDiagram, setHasAutoShownBodyDiagram] = useState(false);
  const [endedEarly, setEndedEarly] = useState(false);
  const [interviewStartTime, setInterviewStartTime] = useState<number | null>(null);
  const interviewStartTimeRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
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
  }, [draftTranscript]);

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
    if (isMuted) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        if (window.speechSynthesis.speaking) {
          mutedWhileSpeakingRef.current = true;
        }
        window.speechSynthesis.cancel();
      }
      if (audioPlaybackRef.current && !audioPlaybackRef.current.paused) {
        mutedWhileSpeakingRef.current = true;
      }
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
        audioPlaybackRef.current.currentTime = 0;
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
  const showReviewActions =
    (showReview || hasPendingSubmission) &&
    (draftTranscript.trim().length > 0 || hasPendingSubmission);
  const minPatientBubbleRows = isSmallWidth ? 3 : 2;
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
    const key = `${trimmed.length}|${showReview}|${status}|${isEditingDraft}`;
    if (key === typingStateLogRef.current) {
      return;
    }
    typingStateLogRef.current = key;
  }, [draftTranscript, showReview, status, isEditingDraft]);
  useEffect(() => {
    const nextLength = draftTranscript.trim().length;
    if (draftLengthLogRef.current === nextLength) {
      return;
    }
    draftLengthLogRef.current = nextLength;
  }, [draftTranscript, showReview, status, isEditingDraft]);
  useEffect(() => {
  }, [showReview, draftTranscript, status, isEditingDraft]);
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
    if (!navigator.mediaDevices?.getUserMedia) return;

    hasRequestedMicPermissionRef.current = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
          // Ignore expected denials/unsupported cases here; on-demand mic start
          // still shows proper UI messaging when user presses and holds.
          if (
            error instanceof DOMException &&
            (error.name === "NotAllowedError" ||
              error.name === "NotFoundError" ||
              error.name === "NotReadableError")
          ) {
            return;
          }
          console.warn("[speech] Initial microphone permission preflight failed:", error);
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, []);

  const getMedPmhSummary = () => {
    const parts = [medListExtracted, pmhExtracted]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);
    return parts.length ? parts.join("\n") : null;
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
      setIsInvitedFlow(invitedFlow);
      if (invitedFlow) {
        if (invitePatientName) {
          setPatientName(invitePatientName);
        }
        if (invitePatientEmail) {
          setPatientEmail(invitePatientEmail);
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
          })
          .catch((err) => {
            console.error("[page.tsx] Failed to fetch lab report summary:", err);
            // Don't show error to user - lab report is optional
          });
    }
  }, [patientEmail]);
  const statusRef = useRef<"idle" | "awaitingPatient" | "awaitingAi" | "complete" | "paused">("idle");

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
  
  // Hide diagram when interview is complete
  useEffect(() => {
    if (status === "complete") {
      setShowBodyDiagram(false);
      setSelectedBodyParts([]);
      setSelectedDiagramArea(null);
      setHasAutoShownBodyDiagram(false);
    }
  }, [status]);

  // Update timer every second when interview is active
  useEffect(() => {
    if (interviewStartTime && status !== "idle" && status !== "complete") {
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
    // Stop HTML Audio element if used (desktop fallback)
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.src = "";
      audioPlaybackRef.current = null;
    }
    if (audioPlaybackUrlRef.current) {
      URL.revokeObjectURL(audioPlaybackUrlRef.current);
      audioPlaybackUrlRef.current = null;
    }
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
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      speechSynthesisRef.current = null;
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (!isCancellingRef.current && event.error !== "interrupted") {
        console.error("Speech synthesis error:", event.error, event);
      }
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
      throw new Error(`Azure TTS request failed (${response.status})`);
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

    // Prefer Web Audio API (AudioContext) — it stays unlocked on iOS once
    // resume() is called during a user gesture (see unlockAudioPlayback).
    // HTMLAudioElement.play() would require a fresh user-gesture on iOS each
    // time, which fails when TTS is triggered from a useEffect.
    const ctx = audioContextRef.current;
    if (ctx) {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      audioSourceNodeRef.current = source;

      setIsSpeaking(true);
      source.onended = () => {
        setIsSpeaking(false);
        audioSourceNodeRef.current = null;
      };
      source.start(0);
      return;
    }

    // Fallback: HTMLAudioElement (desktop browsers where AudioContext wasn't created)
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audioPlaybackRef.current = audio;
    audioPlaybackUrlRef.current = audioUrl;

    audio.onplay = () => setIsSpeaking(true);
    audio.onended = () => {
      setIsSpeaking(false);
      clearAzureAudioPlayback();
    };
    audio.onerror = () => {
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
        console.warn("[speech] Azure TTS failed, falling back to browser TTS:", error);
        speakWithBrowserTts(text);
      }
    })();
  };

  /** Create / resume an AudioContext on a user gesture so iOS allows later
   *  Web Audio API playback from async code (useEffect, fetch callbacks, etc.). */
  const unlockAudioPlayback = () => {
    if (typeof window === "undefined") return;
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume();
      }
    } catch (error) {
      console.warn("[speech] Unable to unlock AudioContext:", error);
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
            isListeningRef.current = false;
          } else if (event.error === "network") {
            // Network error
            console.error("Speech recognition error: Network issue");
            setIsListening(false);
            isListeningRef.current = false;
            setError("Network error. Please check your connection and try again.");
          } else if (event.error === "audio-capture") {
            // Audio capture error
            console.error("Speech recognition error: Audio capture failed");
            setIsListening(false);
            isListeningRef.current = false;
            setError("Audio capture failed. Please check your microphone.");
          } else {
            // Other errors - log but don't show to user unless critical
            console.warn("Speech recognition warning:", event.error);
            // Don't stop listening for minor errors - let it continue
            if (event.error === "service-not-allowed" || event.error === "bad-grammar") {
              setIsListening(false);
              isListeningRef.current = false;
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
              speechRecognitionRef.current?.start();
              isListeningRef.current = true;
              setIsListening(true);
            } catch {
              setIsListening(false);
              isListeningRef.current = false;
            }
            return;
          }
          setIsListening(false);
          isListeningRef.current = false;
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

  const startListening = async (options?: { allowDuringReview?: boolean }) => {
    // Capture current selection before we start listening (in case focus shifts)
    updateSelectionRef(patientResponseInputRef.current);
    const allowDuringReview = options?.allowDuringReview ?? false;
    if (isSpeaking) return; // Don't allow listening while AI is speaking
    if (cleaningTranscript) return;
    if (showReview && !allowDuringReview) return;
    if (useAzureStt && status === "awaitingPatient") {
      try {
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
          setError("Audio capture failed. Please check your microphone.");
        };

        recorder.onstop = async () => {
          setIsListening(false);
          isListeningRef.current = false;
          const shouldFinalize = finalizeMediaOnStopRef.current;
          finalizeMediaOnStopRef.current = false;
          const chunks = [...mediaChunksRef.current];
          mediaChunksRef.current = [];

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }

          if (!shouldFinalize) {
            return;
          }

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
        };

        recorder.start(250);
        setIsHolding(true);
        isHoldingRef.current = true;
        setIsListening(true);
        isListeningRef.current = true;
        return;
      } catch (error) {
        setIsListening(false);
        isListeningRef.current = false;
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
      } catch (error) {
        // Check if error is because recognition is already started
        if (error instanceof Error && error.name === "InvalidStateError") {
          console.log("[Speech Recognition] Recognition already started");
          setIsListening(true);
          isListeningRef.current = true;
        } else {
          console.error("Error starting speech recognition:", error);
          setError("Unable to start voice input. Please try again.");
        }
      }
    }
  };

  const stopListening = (finalizeDraft = false) => {
    setIsHolding(false);
    isHoldingRef.current = false;
    if (useAzureStt) {
      finalizeMediaOnStopRef.current = finalizeDraft;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore recorder stop errors
        }
      } else if (finalizeDraft) {
        setMicWarning("No speech detected. Please try again.");
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
    if (isHoldingRef.current || isListeningRef.current) {
      stopListening(true);
      return;
    }
    void startListening(options);
  };

  const commitDraftToResponse = (mode: "use" | "edit", autoSubmit = false) => {
    const draft = draftTranscript.trim();
    if (!draft) {
      return;
    }
    if (mode === "edit") {
      setIsEditingDraft(true);
      setShowReview(true);
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
      setIsEditingDraft(false);
    }
    setIsEditingDraft(false);
    setPatientResponseWithRef(draft);
    if (patientResponseInputRef.current) {
      requestAnimationFrame(() => {
        patientResponseInputRef.current?.focus();
        const pos = draft.length;
        patientResponseInputRef.current?.setSelectionRange(pos, pos);
      });
    }
    if (mode === "use") {
      setInterimTranscript("");
      interimTranscriptRef.current = "";
    }
    const shouldAutoSubmit = autoSubmit && statusRef.current === "awaitingPatient";
    if (shouldAutoSubmit) {
      void handlePatientSubmit();
    } else if (autoSubmit) {
    }
  };

  const toggleDraftEditing = () => {
    if (isEditingDraft) {
      // Exit edit mode without altering the current draft text.
      setIsEditingDraft(false);
      return;
    }
    commitDraftToResponse("edit");
  };

  const redoDraftTranscript = () => {
    resetDraftTranscript("redo");
  };

  async function handleStart(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    unlockSpeechSynthesis();
    if (status === "awaitingAi") {
      return;
    }

    // Check for physician ID before starting
    if (typeof window !== "undefined") {
      const physicianId = sessionStorage.getItem("physicianId");
      if (!physicianId) {
        setError("Physician information not found. Please click on the invitation link provided by your physician again, or contact your physician's office for assistance.");
        return;
      }
      setPhysicianIdValue(physicianId);
    }

    if (!hasConsented) {
      setError("Please confirm the acknowledgement/consent checkbox to proceed.");
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
    if (!Number.isFinite(ageValue) || ageValue <= 0) {
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
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setError(null);
    
    // Fetch lab report summaries and form summary if not already fetched (in case useEffect didn't complete)
    let finalLabReportSummary = labReportSummary;
    let finalPreviousLabReportSummary = previousLabReportSummary;
    let finalFormSummary = formSummary;
    console.log("[page.tsx] handleStart - Current labReportSummary state:", finalLabReportSummary ? `${finalLabReportSummary.substring(0, 50)}...` : "null");
    console.log("[page.tsx] handleStart - Current previousLabReportSummary state:", finalPreviousLabReportSummary ? `${finalPreviousLabReportSummary.substring(0, 50)}...` : "null");
    console.log("[page.tsx] handleStart - Current formSummary state:", finalFormSummary ? `${finalFormSummary.substring(0, 50)}...` : "null");
    
    if ((!finalLabReportSummary || !finalPreviousLabReportSummary || !finalFormSummary) && typeof window !== "undefined") {
      const physicianId = sessionStorage.getItem("physicianId");
      console.log("[page.tsx] handleStart - Fetching lab report summaries, physicianId:", physicianId, "patientEmail:", patientEmail);
      
      if (physicianId && patientEmail && patientEmail.includes("@")) {
        try {
          const response = await fetch(`/api/invitations/lab-report`);
          console.log("[page.tsx] handleStart - Lab report fetch response status:", response.status);
          
          if (response.ok) {
            const data = await response.json();
            console.log("[page.tsx] handleStart - Lab report fetch response data:", data);
            
            if (data.labReportSummary) {
              finalLabReportSummary = data.labReportSummary;
              setLabReportSummary(data.labReportSummary);
              console.log("[page.tsx] handleStart - Fetched lab report summary:", data.labReportSummary.substring(0, 100));
            } else {
              console.log("[page.tsx] handleStart - No lab report summary in response");
            }
            
            if (data.previousLabReportSummary) {
              finalPreviousLabReportSummary = data.previousLabReportSummary;
              setPreviousLabReportSummary(data.previousLabReportSummary);
              console.log("[page.tsx] handleStart - Fetched previous lab report summary:", data.previousLabReportSummary.substring(0, 100));
            } else {
              console.log("[page.tsx] handleStart - No previous lab report summary in response");
            }
            
            if (data.formSummary) {
              finalFormSummary = data.formSummary;
              setFormSummary(data.formSummary);
              console.log("[page.tsx] handleStart - Fetched form summary:", data.formSummary.substring(0, 100));
            } else {
              console.log("[page.tsx] handleStart - No form summary in response");
            }
          } else {
            const errorText = await response.text();
            console.error("[page.tsx] handleStart - Lab report fetch failed:", response.status, errorText);
          }
        } catch (err) {
          console.error("[page.tsx] handleStart - Failed to fetch lab report summaries:", err);
          // Continue without lab report summaries - they're optional
        }
      } else {
        console.log("[page.tsx] handleStart - Missing physicianId or patientEmail, skipping lab report fetch");
      }
    }
    
    console.log("[page.tsx] handleStart - Final labReportSummary to send:", finalLabReportSummary ? `${finalLabReportSummary.substring(0, 50)}...` : "null");
    console.log("[page.tsx] handleStart - Final previousLabReportSummary to send:", finalPreviousLabReportSummary ? `${finalPreviousLabReportSummary.substring(0, 50)}...` : "null");
    console.log("[page.tsx] handleStart - Final formSummary to send:", finalFormSummary ? `${finalFormSummary.substring(0, 50)}...` : "null");
    
    // Start timer when interview begins
    const startTime = Date.now();
    setInterviewStartTime(startTime);
    interviewStartTimeRef.current = startTime;
    setStatus("awaitingAi");

    try {
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
      setShowImagePrompt(shouldOfferImage);
      setWantsToUploadImage(null);
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
  ): Promise<void> {
    if (event) {
      event.preventDefault();
    }
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
    if (!currentResponse) {
      console.log("[handlePatientSubmit] No response text");
      setIsSubmittingResponse(false);
      setShowSubmitToast(false);
      return;
    }
    setLastSubmittedDraft(currentResponse);
    let trimmed = currentResponse;

    // If a diagram area is selected, append it to the response
    if (selectedDiagramArea && selectedBodyParts.length > 0) {
      trimmed = trimmed.trim();
      if (trimmed) {
        trimmed += ` (Area ${selectedDiagramArea} on diagram)`;
      } else {
        trimmed = `Area ${selectedDiagramArea} on diagram`;
      }
      // Clear diagram selection after including it (but keep diagram visible)
      setSelectedDiagramArea(null);
      // Don't hide the diagram - keep it visible for reference
    }

    if (trimmed.length > 1000) {
      setError("Your response is too long. Please keep it under 1000 characters.");
      return;
    }

    const lastMessage = messagesRef.current[messagesRef.current.length - 1];
    const isFinalCommentsTurn =
      awaitingFinalComments ||
      (lastMessage?.role === "assistant" && isFinalCommentsPrompt(lastMessage.content));

    // Final clinician-facing comment: capture and save without calling the AI.
    if (isFinalCommentsTurn) {
      const baseHistory = pendingHistoryResultRef.current;
      if (!baseHistory) {
        setError("Unable to save your final comment. Please try again.");
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
        return;
      }

      const patientMessage: ChatMessage = { role: "patient", content: trimmed };
      const updatedMessages = [...messagesRef.current, patientMessage];
      messagesRef.current = updatedMessages;
      setMessages(updatedMessages);

      setPatientResponse("");
      setInterimTranscript("");
      interimTranscriptRef.current = "";

      const historyWithFinal = {
        ...baseHistory,
        patientFinalQuestionsComments: trimmed,
      } satisfies HistoryResponse;

      setResult(historyWithFinal);
      setPendingHistoryResult(null);
      pendingHistoryResultRef.current = null;
      setAwaitingFinalComments(false);

      setStatus("complete");
      statusRef.current = "complete";

      try {
        await saveSession(historyWithFinal);
      } catch (err) {
        console.error("Failed to save session with final comment:", err);
        setError("Failed to save your final comment. Please try again.");
      } finally {
        setIsSubmittingResponse(false);
        setShowSubmitToast(false);
      }
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
      );
      processTurn(turn);
      submittedSuccessfully = true;
    } catch (err) {
      console.error(err);
      setMessages((current) => current.slice(0, -1));
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

  async function saveSession(historyResult: HistoryResponse) {
    if (!lockedProfile) {
      console.warn("[saveSession] Cannot save session: lockedProfile is missing");
      return;
    }

    const physicianId = typeof window !== "undefined" ? sessionStorage.getItem("physicianId") || "" : "";
    
    if (!physicianId) {
      setError("Physician ID not found. Please access this form through the invitation link provided by your physician.");
      return;
    }

    // Use provided patientName/patientEmail, or fall back to defaults if missing
    // This ensures sessions are saved even if patient ended early
    const finalPatientName = patientName?.trim() || "Patient";
    const finalPatientEmail = patientEmail?.trim() || `patient-${Date.now()}@unknown.com`;
    
    if (!patientName || !patientEmail) {
      console.warn("[saveSession] Patient name or email missing, using defaults:", {
        patientName: finalPatientName,
        patientEmail: finalPatientEmail
      });
    }

    // Calculate interview duration in seconds
    const duration = interviewStartTimeRef.current ? Math.round((Date.now() - interviewStartTimeRef.current) / 1000) : 0;

    // Use messages state directly as the source of truth
    // messagesRef.current is synced via useEffect, but messages is the authoritative source
    // Prefer messagesRef.current if it has more items (includes edits), otherwise use messages
    const finalTranscript = (messagesRef.current.length >= messages.length && messagesRef.current.length > 0) 
      ? messagesRef.current 
      : (messages.length > 0 ? messages : []);
    
    // CRITICAL: Use messagesRef.current as the primary source since it's updated synchronously
    // Fallback to messages state if ref is empty (shouldn't happen, but defensive)
    const sourceMessages = messagesRef.current.length > 0 ? messagesRef.current : messages;
    
    // Ensure transcript is always an array (even if empty)
    const transcriptToSave: InterviewMessage[] = Array.isArray(sourceMessages) ? sourceMessages : [];
    
    // CRITICAL: Log detailed information about transcript state
    console.log("[saveSession] Saving session with transcript:", {
      transcriptLength: transcriptToSave.length,
      messagesLength: messages.length,
      messagesRefLength: messagesRef.current.length,
      sourceMessagesLength: sourceMessages.length,
      transcriptSample: transcriptToSave.length > 0 ? transcriptToSave[0] : null,
      messagesSample: messages.length > 0 ? messages[0] : null,
      messagesRefSample: messagesRef.current.length > 0 ? messagesRef.current[0] : null,
      allMessages: messages.map(m => ({ role: m.role, contentLength: m.content.length })),
      allMessagesRef: messagesRef.current.map(m => ({ role: m.role, contentLength: m.content.length })),
      sourceMessages: sourceMessages.map(m => ({ role: m.role, contentLength: m.content.length })),
    });
    
    // If transcript is empty, this is a problem - log warning
    if (transcriptToSave.length === 0) {
      console.error("[saveSession] ERROR: Transcript is empty! This should not happen if interview completed.", {
        messagesCount: messages.length,
        messagesRefCount: messagesRef.current.length,
        sourceMessagesCount: sourceMessages.length,
        status: statusRef.current,
        messages: messages,
        messagesRef: messagesRef.current,
        sourceMessages: sourceMessages,
      });
    }

    try {
      const medPmhSummary = getMedPmhSummary();
      // Convert image to base64 if available
      let imageUrl: string | undefined;
      if (selectedImagePreview) {
        imageUrl = selectedImagePreview; // Already a data URL
      } else if (selectedImage) {
        // Convert file to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64String = reader.result as string;
          // Re-read transcript at this point to ensure we have the latest
          const latestTranscript = messagesRef.current.length > 0 ? messagesRef.current : messages;
          const finalTranscriptToSave: InterviewMessage[] = Array.isArray(latestTranscript) ? latestTranscript : [];
          
          const requestBody = {
            physicianId,
            patientName: finalPatientName,
            patientEmail: finalPatientEmail,
            chiefComplaint,
            patientProfile: lockedProfile,
            history: { ...historyResult, labReportSummary: labReportSummary || undefined, previousLabReportSummary: previousLabReportSummary || undefined, formSummary: formSummary || undefined, medPmhSummary: medPmhSummary || undefined },
            imageSummary: imageSummary || undefined,
            imageUrl: base64String,
            imageName: selectedImage.name,
            duration,
            transcript: finalTranscriptToSave,
          };
          
          console.log("[saveSession] Sending POST request (with image) with body:", {
            hasTranscript: !!requestBody.transcript,
            transcriptLength: requestBody.transcript?.length || 0,
            transcriptType: Array.isArray(requestBody.transcript) ? "array" : typeof requestBody.transcript,
            transcriptSample: requestBody.transcript && requestBody.transcript.length > 0 ? requestBody.transcript[0] : null,
            bodyKeys: Object.keys(requestBody),
            latestTranscriptLength: latestTranscript.length,
            messagesRefLength: messagesRef.current.length,
            messagesLength: messages.length,
          });
          
          fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          }).then((res) => {
            if (res.ok) {
              return res.json();
            } else {
              return res.json().then(err => {
                throw new Error(err.error || "Failed to save session");
              });
            }
          }).then((data) => {
            if (data) {
              setSessionCode(data.sessionCode);
              setShowShareLink(true);
            }
          }).catch((err) => {
            console.error("Failed to save session:", err);
            setError(err.message || "Failed to save session. Please try again.");
          });
        };
        reader.readAsDataURL(selectedImage);
        return; // Async operation, return early
      }

      // Calculate interview duration in seconds
      const duration = interviewStartTimeRef.current ? Math.round((Date.now() - interviewStartTimeRef.current) / 1000) : 0;

      // No image, save without it
      const requestBody = {
        physicianId,
        patientName: finalPatientName,
        patientEmail: finalPatientEmail,
        chiefComplaint,
        patientProfile: lockedProfile,
        history: { ...historyResult, labReportSummary: labReportSummary || undefined, previousLabReportSummary: previousLabReportSummary || undefined, formSummary: formSummary || undefined, medPmhSummary: medPmhSummary || undefined },
        imageSummary: imageSummary || undefined,
        imageUrl: undefined,
        imageName: undefined,
        duration,
        transcript: transcriptToSave,
      };
      
      console.log("[saveSession] Sending POST request (no image) with body:", {
        hasTranscript: !!requestBody.transcript,
        transcriptLength: requestBody.transcript?.length || 0,
        transcriptType: Array.isArray(requestBody.transcript) ? "array" : typeof requestBody.transcript,
        transcriptSample: requestBody.transcript && requestBody.transcript.length > 0 ? requestBody.transcript[0] : null,
        bodyKeys: Object.keys(requestBody),
      });
      
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data = await response.json();
        setSessionCode(data.sessionCode);
        setShowShareLink(true);
      } else {
        const errorData = await response.json();
        setError(errorData.error || "Failed to save session. Please try again.");
      }
    } catch (err) {
      console.error("Failed to save session:", err);
      setError(err instanceof Error ? err.message : "Failed to save session. Please try again.");
    }
  }

  async function endInterview() {
    clearPauseTimers();
    stopListening();
    stopSpeaking();
    
    // If there are messages, generate a summary with what we have
    if (messages.length > 0 && lockedProfile && chiefComplaint) {
      const endRequestMessage: ChatMessage = {
        role: "patient",
        content:
          "I would like to end the interview now. Please provide a summary of what we've discussed.",
      };
      try {
        setStatus("awaitingAi");
        
        // Create a special request that forces a summary
        const finalMessages = [...messages, endRequestMessage];
        
        // Call the API with a flag to force summary generation
        const response = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: finalMessages,
            patientProfile: lockedProfile,
            chiefComplaint,
            ...(imageSummary ? { imageSummary } : {}), // Only include if it exists
            ...(labReportSummary ? { labReportSummary } : {}), // Only include if it exists
            ...(previousLabReportSummary ? { previousLabReportSummary } : {}), // Only include if it exists
            ...(formSummary ? { formSummary } : {}), // Only include if it exists
            forceSummary: true, // Flag to force summary
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const turn = await response.json() as InterviewResponse;
        
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
    pausedStatusRef.current = null;
    setStatus("idle");
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setError(null);
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
    setSelectedDiagramArea(null);
    setHasAutoShownBodyDiagram(false);
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
    if (turn.type === "question") {
      // Use the AI question as-is (no added greeting)
      const questionContent = turn.question;
      
      setMessages((current) => {
        const assistantMessage: ChatMessage = { role: "assistant", content: questionContent };
        const updated: ChatMessage[] = [...current, assistantMessage];
        messagesRef.current = updated; // Update ref immediately
        return updated;
      });
      
      // Check if the AI is asking for a photo
      const questionLower = turn.question.toLowerCase();
      const photoKeywords = [
        "upload a photo",
        "share a photo",
        "send a photo",
        "take a photo",
        "upload a picture",
        "share a picture",
        "send a picture",
        "take a picture",
        "upload an image",
        "share an image",
        "send an image",
        "photo would be helpful",
        "picture would be helpful",
        "image would be helpful",
        "can you upload",
        "would you like to upload",
      ];
      const isRequestingPhoto = photoKeywords.some((keyword) =>
        questionLower.includes(keyword),
      );
      
      // Show image prompt if AI is requesting a photo and no image has been uploaded yet
      if (isRequestingPhoto && !selectedImage && !imageSummary) {
        setShowImagePrompt(true);
        setWantsToUploadImage(null);
      }
      
      // Check if the AI is asking about pain location with numbered areas
      const locationKeywords = [
        "numbered area",
        "number",
        "which area",
        "diagram",
        "which number",
        "where exactly",
        "where is the pain",
        "point to",
        "site of pain",
        "pain location",
      ];
      const isAskingLocation = locationKeywords.some((keyword) =>
        questionLower.includes(keyword),
      );

      // First try to detect body parts from question text, then chief complaint.
      let bodyParts = detectBodyParts(turn.question);
      if (bodyParts.length === 0) {
        bodyParts = detectBodyParts(chiefComplaint);
      }
      const isMskBodyPart = bodyParts.some((bp) =>
        [
          "wrist",
          "hand",
          "elbow",
          "shoulder",
          "neck",
          "back",
          "lower_back",
          "upper_back",
          "knee",
          "ankle",
          "foot",
          "hip",
        ].includes(bp.part),
      );
      const assistantTurnsSoFar = messagesRef.current.filter((m) => m.role === "assistant").length;
      const shouldAutoShowForMsk =
        !isAskingLocation &&
        !hasAutoShownBodyDiagram &&
        isMskBodyPart &&
        assistantTurnsSoFar <= 3;

      // Show body diagram if location prompt is detected OR early MSK fallback applies.
      if (bodyParts.length > 0 && (isAskingLocation || shouldAutoShowForMsk)) {
        const partsToShow = bodyParts.map((bp) => ({
          part: bp.part,
          side: bp.side,
        }));
        setSelectedBodyParts(partsToShow);
        setShowBodyDiagram(true);
        setSelectedDiagramArea(null);
        if (shouldAutoShowForMsk) {
          setHasAutoShownBodyDiagram(true);
        }
      } else {
        // Hide diagram if no explicit location prompt and no MSK auto-fallback condition.
        setShowBodyDiagram(false);
        setSelectedBodyParts([]);
      }
      
      setStatus("awaitingPatient");
      return;
    }

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
    const summaryMessage: ChatMessage = { role: "assistant", content: turn.summary };
    const endMessage: ChatMessage = { role: "assistant", content: closingMessageEnglish };
    const finalCommentsPromptMessage: ChatMessage = {
      role: "assistant",
      content: finalCommentsPromptEnglish,
    };
    const updatedMessages: ChatMessage[] = [
      ...messages,
      summaryMessage,
      endMessage,
      finalCommentsPromptMessage,
    ];
    
    messagesRef.current = updatedMessages;
    
    setMessages(updatedMessages);
    
    setPendingHistoryResult(historyResult);
    pendingHistoryResultRef.current = historyResult;
    setAwaitingFinalComments(true);
    setStatus("awaitingPatient");
    statusRef.current = "awaitingPatient";
  }

  const microphoneBlocked =
    typeof error === "string" && error.toLowerCase().includes("microphone access denied");
  const micStatusText = isHolding
    ? "Listening..."
    : cleaningTranscript
      ? "Processing transcript..."
      : microphoneBlocked
        ? "Microphone blocked. Please allow access in browser settings."
        : "Microphone ready";
  const micStatusClassName = microphoneBlocked ? "text-amber-600" : "text-slate-500";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <main className="w-full max-w-5xl rounded-3xl border border-slate-200 bg-white/90 shadow-xl shadow-slate-100 backdrop-blur">
        <header className="border-b border-slate-100 px-8 py-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            MyMD Medical Intake Form
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Conversational history taking
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Capture a structured illness narrative without replacing clinical
            judgment.
          </p>
        </header>

        <section className="grid gap-8 px-8 py-8 lg:grid-cols-[1.2fr_0.8fr]">
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
            <form onSubmit={handleStart} className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-800">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={hasConsented}
                    disabled={status !== "idle"}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setHasConsented(next);
                      if (next && error?.toLowerCase().includes("consent")) {
                        setError(null);
                      }
                    }}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:cursor-not-allowed"
                  />
                  <span>
                    I understand this AI interview does not provide medical advice and does not replace a physician’s
                    assessment. If this is a medical emergency, I will seek immediate care. I understand my information
                    will be kept confidential and secure. I agree to the{" "}
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
                    </a>{" "}
                    and consent to proceed.
                  </span>
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                <label
                  htmlFor="patient-name"
                  className="text-sm font-medium text-slate-800"
                >
                  Your Name (Required)
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>

                <div className="space-y-2">
                <label
                  htmlFor="patient-email"
                  className="text-sm font-medium text-slate-800"
                >
                  Your Email (Required)
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>
              </div>
              {isInvitedFlow && (
                <p className="text-xs text-slate-600">
                  Name and email are prefilled from your invitation and cannot be changed.
                </p>
              )}

              <div className="space-y-2">
                <label
                  htmlFor="chief-complaint"
                  className="text-sm font-medium text-slate-800"
                >
                  Chief complaint (Required)
                </label>
                <textarea
                  id="chief-complaint"
                  name="chiefComplaint"
                  rows={3}
                  placeholder="e.g., 3 days of sore throat with fevers and swollen glands"
                  value={chiefComplaint}
                  disabled={status !== "idle"}
                  onChange={(event) => setChiefComplaint(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                <label
                  htmlFor="sex"
                  className="text-sm font-medium text-slate-800"
                >
                  Sex (Required)
                </label>
                  <select
                    id="sex"
                    name="sex"
                    value={sex}
                    disabled={status !== "idle"}
                    onChange={(event) =>
                      setSex(event.target.value as PatientProfile["sex"])
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                  Age (Required)
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="language"
                  className="text-sm font-medium text-slate-800"
                >
                  Interview language
                </label>
                <select
                  id="language"
                  name="language"
                  value={language}
                  disabled={status !== "idle"}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {languageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Assistant questions and patient-facing text will use this language (fallback to English if translation fails).
                </p>
              </div>

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
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="pmh"
                      className="text-sm font-medium text-slate-800"
                    >
                      Past Medical History (Optional)
                    </label>
                    <p className="text-xs text-slate-500">
                      Type it in, or upload a photo/PDF and we’ll extract it below.
                    </p>
                  </div>
                  {pmhPreview && (
                    <img
                      src={pmhPreview}
                      alt="PMH preview"
                      className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                    />
                  )}
                </div>
                <textarea
                  id="pmh"
                  name="pmh"
                  rows={2}
                  value={pmh}
                  disabled={status !== "idle"}
                  onChange={(event) => setPmh(event.target.value)}
                  placeholder="e.g., asthma, hypertension on lisinopril (leave blank for 'None')"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={status !== "idle"}
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
                        setError("File too large (max 6MB). Please choose a smaller/clearer image or PDF.");
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
                        const response = await fetch("/api/analyze-med-pmh", {
                          method: "POST",
                          body: formData,
                        });
                        if (!response.ok) {
                          const errJson = await response.json().catch(() => ({}));
                          throw new Error(errJson.error || errJson.details || "Failed to analyze photo.");
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
                  {analyzingPmh && (
                    <p className="text-xs text-slate-500">Analyzing file…</p>
                  )}
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

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <label
                      htmlFor="current-medications"
                      className="text-sm font-medium text-slate-800"
                    >
                      Current medications (Optional)
                    </label>
                    <p className="text-xs text-slate-500">
                      Type them in, or upload a photo/PDF and we’ll extract them below.
                    </p>
                  </div>
                  {medListPreview && (
                    <img
                      src={medListPreview}
                      alt="Medication list preview"
                      className="h-12 w-12 rounded-lg object-cover border border-slate-200"
                    />
                  )}
                </div>
                <textarea
                  id="current-medications"
                  name="currentMedications"
                  rows={2}
                  value={currentMedications}
                  disabled={status !== "idle"}
                  onChange={(event) => setCurrentMedications(event.target.value)}
                  placeholder="e.g., amlodipine 5 mg daily, metformin 500 mg BID (leave blank for 'None')"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                />
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={status !== "idle"}
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
                        setError("File too large (max 6MB). Please choose a smaller/clearer image or PDF.");
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
                        const response = await fetch("/api/analyze-med-pmh", {
                          method: "POST",
                          body: formData,
                        });
                        if (!response.ok) {
                          const errJson = await response.json().catch(() => ({}));
                          throw new Error(errJson.error || errJson.details || "Failed to analyze photo.");
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
                  {analyzingMedList && (
                    <p className="text-xs text-slate-500">Analyzing file…</p>
                  )}
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
                  placeholder="e.g., mother with HTN, father with type 2 diabetes (leave blank for 'None')"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                  placeholder='e.g., Dr. Kim Lee (leave blank for "Unknown")'
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                />
              </div>

              <div className="space-y-4">
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
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
                      <p className="mt-1 text-xs text-slate-500 italic">
                        Phone number not available from search
                      </p>
                    )}
                    {pharmacyInfo.fax ? (
                      <p className="mt-1 text-emerald-700">
                        <span className="font-medium">Fax:</span> {pharmacyInfo.fax}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500 italic">
                        Fax number not available from search
                      </p>
                    )}
                  </div>
                )}
                {!pharmacyInfo &&
                  !searchingPharmacy &&
                  (pharmacyNameInput.trim() !== "" ||
                    pharmacyAddressInput.trim() !== "") && (
                  <p className="text-xs text-slate-500 italic">
                    Pharmacy information will appear here after search. If not found, you can manually enter the details.
                  </p>
                )}
              </div>

              <div
                className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-5 py-4 text-sm text-slate-600"
                aria-live="polite"
              >
                <p className="font-medium text-slate-700">Status</p>
                <p className="mt-1 text-slate-500">{statusCopy[status]}</p>
                {interviewStartTime && status !== "idle" && (
                  <p className="mt-2 text-xs font-medium text-slate-600">
                    ⏱️ {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, "0")}
                  </p>
                )}
                {error && (
                  <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
                    {error}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex flex-1 items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-base font-semibold text-white transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={status !== "idle" || chiefComplaint.length < 3 || !hasConsented}
                >
                  Start interview
                </button>
                {status !== "idle" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to reset the conversation? All progress will be lost.")) {
                        resetConversation();
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-5 py-3 text-base font-semibold text-slate-600 transition hover:text-slate-900"
                  >
                    Reset conversation
                  </button>
                )}
              </div>
            </form>

            <section className="rounded-3xl border border-slate-100 bg-white/80 px-5 py-6 shadow-slate-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {interviewMode === "conversation" ? "Conversation" : "Chat"}
                    </p>
                    {status === "idle" && (
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => setInterviewMode("conversation")}
                          className={`px-3 py-1 text-xs font-medium rounded transition ${
                            interviewMode === "conversation"
                              ? "bg-emerald-600 text-white"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Conversation
                        </button>
                        <button
                          type="button"
                          onClick={() => setInterviewMode("chatbot")}
                          className={`px-3 py-1 text-xs font-medium rounded transition ${
                            interviewMode === "chatbot"
                              ? "bg-emerald-600 text-white"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          Chatbot
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <h2 className="text-2xl font-semibold text-slate-900">
                      Guided interview
                    </h2>
                    <div className="ml-3 flex items-center gap-2">
                      <button
                        onClick={() => {
                          setIsMuted(!isMuted);
                        }}
                        className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                          isMuted
                            ? "bg-red-100 text-red-700 hover:bg-red-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                        title={isMuted ? "Unmute AI voice" : "Mute AI voice"}
                      >
                        {isMuted ? (
                          <>
                            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipPath="url(#clip0)" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                            </svg>
                            Muted
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 9l-6 6H4a1 1 0 01-1-1v-4a1 1 0 011-1h2l6-6v14z" />
                            </svg>
                            Sound On
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                {isSpeaking && !isPaused && language.toLowerCase().startsWith("en") && (
                  <video
                    className="w-40 h-24 rounded-xl object-cover border border-slate-200 shadow-sm"
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="auto"
                  >
                    <source src="/Confident_Busines_woman.mp4" type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                )}
              </div>
              <div
                ref={chatRef}
                className={`mt-5 space-y-4 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-800 max-h-[360px] ${
                  interviewMode === "conversation" ? "conversation-mode" : ""
                }`}
              >
                {messages.length === 0 ? (
                  <p className="text-slate-500">
                    {interviewMode === "conversation"
                      ? "Once you start the interview, we'll have a natural conversation about your health concern."
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
                        {message.role === "assistant" && (
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-emerald-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                              />
                            </svg>
                          </div>
                        )}
                        <div
                          className={`flex-1 ${
                            message.role === "assistant"
                              ? "max-w-[85%]"
                              : "max-w-[85%] text-right"
                          }`}
                        >
                          {message.role === "assistant" ? (
                            <>
                              <div className="bg-white rounded-2xl rounded-tl-sm px-5 py-3 shadow-sm border border-slate-200">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-slate-900 leading-relaxed whitespace-pre-wrap flex-1">
                                    {getDisplayMessageContent(message)}
                                  </p>
                                  {index === messages.length - 1 && isSpeaking && (
                                    <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center mt-1">
                                      <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" title="Reading question aloud"></div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div
                              className={[
                                "bg-emerald-600 rounded-2xl rounded-tr-sm px-5 py-3 text-white ml-auto relative group max-w-full",
                                // When editing/adding, expand the bubble so the textarea isn't cramped on desktop/tablet.
                                addingToMessageIndex === index || editingMessageIndex === index
                                  ? "block w-full"
                                  : "inline-block",
                                // Visual affordance: make it obvious when provider is editing a patient message.
                                editingMessageIndex === index
                                  ? "ring-4 ring-red-300 ring-offset-2 ring-offset-slate-50 bg-emerald-700/90 shadow-sm"
                                  : "",
                              ].join(" ")}
                            >
                              {addingToMessageIndex === index ? (
                                <div className="space-y-2 w-full">
                                  <p className="text-sm text-emerald-50 mb-2">Original: {message.content}</p>
                                  <textarea
                                    value={addingContent}
                                    onChange={(e) => setAddingContent(e.target.value)}
                                    className="w-full bg-white text-slate-900 rounded-lg px-3 py-2 text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none min-h-[60px]"
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
                              ) : editingMessageIndex === index ? (
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
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageIndex(index);
                                      setEditingContent(message.content);
                                    }}
                                    className="absolute -bottom-2.5 right-3 px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm border-2 border-white"
                                    title="Edit this message"
                                  >
                                    Edit
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {message.role === "patient" && (
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                            <svg
                              className="w-5 h-5 text-slate-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                          </div>
                        )}
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
                            ? "bg-white text-slate-900 shadow"
                            : "bg-slate-900 text-white"
                        }`}
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

              <form
                onSubmit={handlePatientSubmit}
                className={`mt-5 flex flex-col gap-3 ${
                  interviewMode === "conversation" ? "conversation-input" : ""
                }`}
              >
                {interviewMode === "conversation" ? (
                  <>
                    {showResponseBox && (
                      <div className="group flex flex-col items-center">
                        <div
                          className={[
                            "w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-800 transition",
                            isEditingDraft
                              ? "border-red-400 ring-2 ring-red-200"
                              : "border-slate-200",
                          ].join(" ")}
                        >
                        {draftTranscript.trim().length > 0 && !isEditingDraft ? (
                          <p className="mt-1 whitespace-pre-wrap">{draftTranscript}</p>
                        ) : (
                          <textarea
                            rows={4}
                            maxLength={1000}
                            placeholder="Tap mic to start/stop or type your response."
                            value={draftTranscript}
                            autoFocus={isEditingDraft}
                            disabled={isSubmittingResponse}
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
                            }}
                            className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          />
                        )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            toggleListening({ allowDuringReview: true });
                          }}
                          disabled={status !== "awaitingPatient" || isPaused || isSpeaking || cleaningTranscript}
                          style={{ touchAction: "manipulation", WebkitUserSelect: "none", userSelect: "none" }}
                          className={`mt-2 inline-flex items-center gap-2 rounded-full px-5 py-2 text-base font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 select-none ${
                            isHolding
                              ? "bg-red-500 text-white border border-red-500 focus-visible:outline-red-500"
                              : "border border-slate-200 bg-white text-slate-700 focus-visible:outline-emerald-600"
                          } ${isCoarsePointer ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                          title={isHolding ? "Stop listening" : "Start listening"}
                        >
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 00-3 3v6a3 3 0 006 0V4a3 3 0 00-3-3z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 01-14 0v-2" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19v4m-4 0h8" />
                          </svg>
                          {isHolding ? "Stop listening" : "Start listening"}
                        </button>
                        <div className="mt-2 min-h-[20px] w-full text-xs">
                          {micWarning ? (
                            <p className="text-amber-600">{micWarning}</p>
                          ) : (
                            <p className={micStatusClassName}>{micStatusText}</p>
                          )}
                        </div>
                      </div>
                    )}
                    {showReviewActions && (
                      <div className="mt-6 flex flex-wrap gap-3">
                        <button
                          type="button"
                          disabled={isSubmittingResponse || hasPendingSubmission}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            if (!isSubmittingResponse && !hasPendingSubmission) {
                              commitDraftToResponse("use", true);
                            }
                          }}
                          onPointerUp={() => {
                          }}
                          onClick={() => {
                            if (!isSubmittingResponse && !hasPendingSubmission) {
                              commitDraftToResponse("use", true);
                            }
                          }}
                          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                        >
                          Use this
                        </button>
                        <button
                          type="button"
                          disabled={isSubmittingResponse || hasPendingSubmission || isEditingDraft}
                          onClick={() => {
                            commitDraftToResponse("edit");
                          }}
                          className={[
                            "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition",
                            "select-none active:scale-[0.98] active:opacity-90",
                            isEditingDraft
                              ? "bg-red-600 text-white border border-red-600"
                              : "border border-slate-200 text-slate-700 hover:bg-slate-100",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                          ].join(" ")}
                        >
                          {isEditingDraft ? "Editing" : "Edit"}
                        </button>
                        <button
                          type="button"
                          disabled={isSubmittingResponse || hasPendingSubmission}
                          onClick={() => {
                            redoDraftTranscript();
                          }}
                          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Redo
                        </button>
                      </div>
                    )}
                    {/* Pause/Resume, End buttons and Thinking indicator - moved below Listening box */}
                    <div className="flex items-center justify-between gap-3 mt-8 relative z-0">
                      <div className="flex items-center gap-3">
                        {/* Pause/Resume and End buttons */}
                        {(status === "awaitingPatient" || status === "awaitingAi" || status === "paused") && (
                          <>
                            {isPaused ? (
                              <button
                                type="button"
                                onClick={resumeInterview}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition whitespace-nowrap"
                                title="Resume interview"
                              >
                                <svg
                                  className="w-4 h-4 flex-shrink-0"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                                <span>Resume</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={pauseInterview}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition whitespace-nowrap"
                                title="Pause interview"
                              >
                                <svg
                                  className="w-4 h-4 flex-shrink-0"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                                <span>Pause</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm("Are you sure you want to end the interview? Your responses will be saved and a summary will be generated for your doctor.")) {
                                  endInterview();
                                }
                              }}
                              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition whitespace-nowrap"
                              title="End interview and generate summary"
                            >
                              <svg
                                className="w-4 h-4 flex-shrink-0"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                              </svg>
                              <span>End</span>
                            </button>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Thinking indicator and Paused status */}
                        {status === "awaitingAi" && !isPaused && (
                          <span className="text-sm text-slate-500">Thinking…</span>
                        )}
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
                    </div>
                    {/* Body part diagrams - shown below buttons, side by side if multiple */}
                    {showBodyDiagram && selectedBodyParts.length > 0 && status !== "complete" && (
                      <div className="mt-4 mb-4 flex flex-wrap justify-center gap-4 z-10 relative">
                        {selectedBodyParts.map((bodyPart, index) => {
                          const safeSide = bodyPart.side === "both" ? undefined : bodyPart.side;
                          return (
                          <BodyPartDiagram
                            key={`${bodyPart.part}-${bodyPart.side || 'none'}-${index}`}
                            bodyPart={bodyPart.part as any}
                            side={safeSide}
                            selectedArea={selectedDiagramArea || undefined}
                            onAreaSelect={(area) => {
                              setSelectedDiagramArea(area);
                              // Auto-fill the response with the area number
                              const areaResponse = `Area ${area}`;
                              setPatientResponse(areaResponse);
                              patientResponseRef.current = areaResponse;
                              // Auto-submit after a brief delay to allow state to update
                              setTimeout(() => {
                                const currentStatus = statusRef.current;
                                if (currentStatus === "awaitingPatient") {
                                  handlePatientSubmit();
                                }
                              }, 300);
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
                            : status === "complete"
                              ? "Interview complete."
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
                        className={`w-full rounded-2xl border bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:bg-white disabled:cursor-not-allowed disabled:opacity-70 ${
                          isListening
                            ? "border-emerald-500 ring-2 ring-emerald-200"
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
                          isSpeaking ||
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
                          isHolding
                            ? "bg-red-500 text-white hover:bg-red-600"
                            : "bg-emerald-600 text-white hover:bg-emerald-500"
                        } appearance-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:text-emerald-600`}
                        title={isHolding ? "Stop listening" : "Start listening"}
                      >
                        {isHolding ? "Stop listening" : "Start listening"}
                      </button>
                    </div>
                    <div className="min-h-[20px] text-xs">
                      {micWarning ? (
                        <p className="text-amber-600">{micWarning}</p>
                      ) : (
                        <p className={micStatusClassName}>{micStatusText}</p>
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
                            disabled={isSubmittingResponse}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              if (!isSubmittingResponse && !hasPendingSubmission) {
                                commitDraftToResponse("use");
                              }
                            }}
                            onPointerUp={() => {
                            }}
                            onClick={() => {
                              if (!isSubmittingResponse && !hasPendingSubmission) {
                                commitDraftToResponse("use");
                              }
                            }}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                          >
                            {isSubmittingResponse ? "Sending..." : "Use this"}
                          </button>
                          <button
                            type="button"
                            disabled={isSubmittingResponse}
                            onClick={() => commitDraftToResponse("edit")}
                            className={[
                              "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition",
                              "select-none active:scale-[0.98] active:opacity-90",
                              isEditingDraft
                                ? "bg-red-600 text-white border border-red-600"
                                : "border border-slate-200 text-slate-700 hover:bg-slate-100",
                              "disabled:cursor-not-allowed disabled:opacity-60",
                            ].join(" ")}
                          >
                            {isEditingDraft ? "Editing" : "Edit"}
                          </button>
                          <button
                            type="button"
                            disabled={isSubmittingResponse}
                            onClick={redoDraftTranscript}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
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

                {showImagePrompt && wantsToUploadImage === true && (
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
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (selectedImagePreview) {
                          URL.revokeObjectURL(selectedImagePreview);
                        }
                        if (file) {
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
                    <p className="mt-1 text-[11px] text-slate-500">
                      This photo is optional. A brief description of the visible findings will
                      be shared with the assistant to support its assessment and with your clinician.
                    </p>
                  </div>
                )}
              </form>
            </section>
          </div>

        </section>
      </main>
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
): Promise<InterviewResponse> {
  console.log("[requestTurn] Sending request with labReportSummary:", labReportSummary ? `${labReportSummary.substring(0, 50)}...` : "null");
  console.log("[requestTurn] Sending request with previousLabReportSummary:", previousLabReportSummary ? `${previousLabReportSummary.substring(0, 50)}...` : "null");
  console.log("[requestTurn] Sending request with formSummary:", formSummary ? `${formSummary.substring(0, 50)}...` : "null");
  console.log("[requestTurn] Sending request with interviewGuidance:", interviewGuidance ? `${interviewGuidance.substring(0, 50)}...` : "null");
  
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
        errorPayload,
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
      console.error("[requestTurn] Response text:", responseText.substring(0, 500));
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











