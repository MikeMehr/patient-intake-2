"use client";

import type { HistoryResponse } from "@/lib/history-schema";
import type {
  InterviewMessage,
  InterviewResponse,
  PatientProfile,
} from "@/lib/interview-schema";
import { useEffect, useRef, useState } from "react";

type Status = "idle" | "awaitingAi" | "awaitingPatient" | "complete";

const statusCopy: Record<Status, string> = {
  idle: "Enter the chief complaint and baseline history to begin.",
  awaitingAi: "Aurora is composing the next question...",
  awaitingPatient: "Answer the assistant's latest question below.",
  complete: "Interview complete. Review the summary on the right.",
};

type ChatMessage = InterviewMessage;

export default function Home() {
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [patientResponse, setPatientResponse] = useState("");
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sex, setSex] = useState<PatientProfile["sex"]>("female");
  const [ageInput, setAgeInput] = useState("");
  const [pmh, setPmh] = useState("");
  const [familyHistory, setFamilyHistory] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [allergies, setAllergies] = useState("");
  const [familyDoctor, setFamilyDoctor] = useState("");
  const [pharmacyNameInput, setPharmacyNameInput] = useState("");
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
  const chatRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function handleStart(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (status === "awaitingAi") {
      return;
    }

    const trimmed = chiefComplaint.trim();
    if (trimmed.length < 3) {
      setError("Please describe the complaint in a few words.");
      return;
    }

    const ageValue = Number(ageInput);
    if (!Number.isFinite(ageValue) || ageValue <= 0) {
      setError("Please enter a valid age in years.");
      return;
    }

    const pmhTrimmed = pmh.trim();
    const familyTrimmed = familyHistory.trim();
    const medsTrimmed = currentMedications.trim();
    const allergiesTrimmed = allergies.trim();
    const familyDoctorTrimmed = familyDoctor.trim();

    if (pmhTrimmed.length < 3) {
      setError("Add at least a short phrase for past medical history.");
      return;
    }

    if (familyTrimmed.length < 3) {
      setError("Add at least a short phrase for family history.");
      return;
    }

    if (allergiesTrimmed.length < 3) {
      setError("Add at least a short phrase for drug allergies (use 'None').");
      return;
    }
    if (medsTrimmed.length < 3) {
      setError("Enter the patient's current medication list (use 'None').");
      return;
    }
    if (familyDoctorTrimmed.length < 3) {
      setError("Please enter the primary care/family doctor (use 'Unknown').");
      return;
    }

    const profile: PatientProfile = {
      sex,
      age: ageValue,
      pmh: pmhTrimmed,
      familyHistory: familyTrimmed,
      familyDoctor: familyDoctorTrimmed,
      currentMedications: medsTrimmed,
      allergies: allergiesTrimmed,
    };

    setPmh(pmhTrimmed);
    setFamilyHistory(familyTrimmed);
    setFamilyDoctor(familyDoctorTrimmed);
    setCurrentMedications(medsTrimmed);
    setAllergies(allergiesTrimmed);
    setAgeInput(String(ageValue));
    setLockedProfile(profile);

    setChiefComplaint(trimmed);
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setError(null);
    setStatus("awaitingAi");

    try {
      const turn = await requestTurn(trimmed, profile, [], null);
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
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (status !== "awaitingPatient") {
      return;
    }
    const profile = lockedProfile;
    if (!profile) {
      setError("Please start the interview before responding.");
      return;
    }
    const trimmed = patientResponse.trim();
    if (!trimmed) {
      return;
    }

    if (trimmed.length > 1000) {
      setError("Your response is too long. Please keep it under 1000 characters.");
      return;
    }

    const patientMessage: ChatMessage = {
      role: "patient",
      content: trimmed,
    };
    const optimisticTranscript = [...messages, patientMessage];
    setMessages(optimisticTranscript);
    setPatientResponse("");
    setStatus("awaitingAi");
    setError(null);

    try {
      const turn = await requestTurn(
        chiefComplaint,
        profile,
        optimisticTranscript,
        imageSummary,
      );
      processTurn(turn);
    } catch (err) {
      console.error(err);
      setMessages((current) => current.slice(0, -1));
      setPatientResponse(trimmed);
      setStatus("awaitingPatient");
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't deliver that message. Please retry.",
      );
    }
  }

  function resetConversation() {
    setStatus("idle");
    setMessages([]);
    setResult(null);
    setPatientResponse("");
    setError(null);
    setChiefComplaint("");
    setLockedProfile(null);
    setFamilyDoctor("");
    setCurrentMedications("");
    setPharmacyNameInput("");
    setPharmacyAddressInput("");
    setPharmacyCityInput("");
    setPharmacyInfo(null);
    setShowImagePrompt(false);
    setWantsToUploadImage(null);
    setImageSummary(null);
    setAnalyzingImage(false);
    if (selectedImagePreview) {
      URL.revokeObjectURL(selectedImagePreview);
    }
    setSelectedImage(null);
    setSelectedImagePreview(null);
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

      // Handle 404 (not found) as a normal case - use manual entry
      if (response.status === 404) {
        setPharmacyInfo({
          name: formattedName || "Pharmacy",
          address: fallbackAddress,
          phone: undefined,
          fax: undefined,
        });
        return;
      }

      // For other errors, try to get error message but still allow manual entry
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        console.warn("Pharmacy search error:", errorPayload.error);
        // Still create manual entry as fallback
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
      // If search fails, create a basic entry from the input (manual entry fallback)
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

  function processTurn(turn: InterviewResponse) {
    if (turn.type === "question") {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: turn.question },
      ]);
      setStatus("awaitingPatient");
      return;
    }

    setResult({
      positives: turn.positives,
      negatives: turn.negatives,
      summary: turn.summary,
      investigations: turn.investigations,
      assessment: turn.assessment,
      plan: turn.plan,
    });
    setMessages((current) => [
      ...current,
      { role: "assistant", content: turn.summary },
    ]);
    setStatus("complete");
  }

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
            <form onSubmit={handleStart} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="chief-complaint"
                  className="text-sm font-medium text-slate-800"
                >
                  Chief complaint
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
                    Sex
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
                    Age
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
                  htmlFor="pmh"
                  className="text-sm font-medium text-slate-800"
                >
                  Pertinent past medical history
                </label>
                <textarea
                  id="pmh"
                  name="pmh"
                  rows={2}
                  value={pmh}
                  disabled={status !== "idle"}
                  onChange={(event) => setPmh(event.target.value)}
                  placeholder="e.g., asthma, hypertension on lisinopril"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="family-history"
                  className="text-sm font-medium text-slate-800"
                >
                  Family history
                </label>
                <textarea
                  id="family-history"
                  name="familyHistory"
                  rows={2}
                  value={familyHistory}
                  disabled={status !== "idle"}
                  onChange={(event) => setFamilyHistory(event.target.value)}
                  placeholder="e.g., mother with HTN, father with type 2 diabetes"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="current-medications"
                  className="text-sm font-medium text-slate-800"
                >
                  Current medications
                </label>
                <textarea
                  id="current-medications"
                  name="currentMedications"
                  rows={2}
                  value={currentMedications}
                  disabled={status !== "idle"}
                  onChange={(event) => setCurrentMedications(event.target.value)}
                  placeholder="e.g., amlodipine 5 mg daily, metformin 500 mg BID"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
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
                  placeholder='e.g., penicillin (rash) or type "None"'
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="family-doctor"
                  className="text-sm font-medium text-slate-800"
                >
                  Family doctor
                </label>
                <input
                  id="family-doctor"
                  name="familyDoctor"
                  type="text"
                  value={familyDoctor}
                  disabled={status !== "idle"}
                  onChange={(event) => setFamilyDoctor(event.target.value)}
                  placeholder='e.g., Dr. Kim Lee or type "Unknown"'
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  required
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="pharmacy-name"
                    className="text-sm font-medium text-slate-800"
                  >
                    Pharmacy name
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
                  disabled={status !== "idle" || chiefComplaint.length < 3}
                >
                  Start interview
                </button>
                {status !== "idle" && (
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-5 py-3 text-base font-semibold text-slate-600 transition hover:text-slate-900"
                  >
                    Reset conversation
                  </button>
                )}
              </div>
            </form>

            <section className="rounded-3xl border border-slate-100 bg-white/80 px-5 py-6 shadow-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Chat
                  </p>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    Guided interview
                  </h2>
                </div>
                {status === "awaitingAi" && (
                  <span className="text-sm text-slate-500">Thinking…</span>
                )}
              </div>

              <div
                ref={chatRef}
                className="mt-5 space-y-4 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-800 max-h-[360px]"
              >
                {messages.length === 0 ? (
                  <p className="text-slate-500">
                    Once you start the interview, the assistant will ask targeted
                    questions here.
                  </p>
                ) : (
                  messages.map((message, index) => (
                    <article
                      key={`${message.role}-${index}-${message.content.slice(0, 8)}`}
                      className={`flex ${
                        message.role === "assistant"
                          ? "justify-start"
                          : "justify-end"
                      }`}
                    >
                      <p
                        className={`max-w-xs rounded-2xl px-4 py-2 ${
                          message.role === "assistant"
                            ? "bg-white text-slate-900 shadow"
                            : "bg-slate-900 text-white"
                        }`}
                      >
                        {message.content}
                      </p>
                    </article>
                  ))
                )}
              </div>

              <form
                onSubmit={handlePatientSubmit}
                className="mt-5 flex flex-col gap-3"
              >
                <label
                  htmlFor="patient-response"
                  className="text-sm font-medium text-slate-700"
                >
                  Your response
                </label>
                <textarea
                  id="patient-response"
                  name="patientResponse"
                  rows={3}
                  maxLength={1000}
                  placeholder={
                    status === "awaitingPatient"
                      ? "Type your answer to the latest question..."
                      : status === "complete"
                        ? "Interview complete."
                        : "Start the interview to respond."
                  }
                  value={patientResponse}
                  onChange={(event) => setPatientResponse(event.target.value)}
                  disabled={status !== "awaitingPatient"}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                />
                {patientResponse.length > 800 && (
                  <p className="text-xs text-slate-500">
                    {1000 - patientResponse.length} characters remaining
                  </p>
                )}
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-emerald-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  disabled={
                    status !== "awaitingPatient" || patientResponse.trim() === ""
                  }
                >
                  Send response
                </button>
                {showImagePrompt && wantsToUploadImage === null && (
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-700">
                    <p className="font-medium text-slate-800">
                      For skin concerns, a photo can sometimes help with assessment.
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
                          alt="Uploaded skin photo preview"
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
                      This photo is optional. A brief description of the visible skin findings will
                      be shared with the assistant to support its assessment and with your clinician.
                    </p>
                  </div>
                )}
              </form>
            </section>
          </div>

          <section className="space-y-5 rounded-3xl border border-slate-100 bg-white/70 px-5 py-6 shadow-slate-100">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Output
              </p>
              <h2 className="text-2xl font-semibold text-slate-900">
                Pertinent findings
              </h2>
            </div>

            {result ? (
              <div className="space-y-6 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                    Positives
                  </p>
                  <ul className="mt-2 space-y-2 text-slate-700">
                    {result.positives.map((positive) => (
                      <li
                        key={positive}
                        className="rounded-2xl bg-emerald-50 px-3 py-2"
                      >
                        {positive}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Negatives
                  </p>
                  <ul className="mt-2 space-y-2 text-slate-700">
                    {result.negatives.map((negative) => (
                      <li
                        key={negative}
                        className="rounded-2xl bg-slate-100 px-3 py-2"
                      >
                        {negative}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Summary
                  </p>
                  <p className="mt-2 rounded-2xl bg-slate-50 px-4 py-3 text-slate-800">
                    {result.summary}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Recommended investigations
                  </p>
                  {result.investigations.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-slate-700">
                      {result.investigations.map((test) => (
                        <li
                          key={test}
                          className="rounded-2xl bg-slate-50 px-3 py-2 text-slate-800"
                        >
                          {test}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-slate-500">
                      No immediate investigations recommended.
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Assessment
                  </p>
                  <p className="mt-2 rounded-2xl bg-slate-50 px-4 py-3 text-slate-800">
                    {result.assessment}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Plan
                  </p>
                  <ul className="mt-2 space-y-2 text-slate-700">
                    {result.plan.map((planItem) => (
                      <li
                        key={planItem}
                        className="rounded-2xl bg-emerald-50 px-3 py-2"
                      >
                        {planItem}
                      </li>
                    ))}
                  </ul>
                </div>

                {pharmacyInfo && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Pharmacy Information
                    </p>
                    <div className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm">
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
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-sm text-slate-500">
                The AI summary will populate here once the interview reaches the
                final stage.
              </p>
            )}
          </section>
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
): Promise<InterviewResponse> {
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
    }),
  });

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      details?: unknown;
    };
    // Prefer the formatted message if available, otherwise use error, otherwise default
    const errorMessage = errorPayload.message 
      ?? errorPayload.error 
      ?? "Unable to continue the interview right now.";
    throw new Error(errorMessage);
  }

  return (await response.json()) as InterviewResponse;
}
