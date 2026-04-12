"use client";

import { useState, useEffect } from "react";
import type { PhqGadResults } from "@/lib/history-schema";

const PHQ9_QUESTIONS_EN = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "Trouble concentrating on things, such as reading the newspaper or watching television",
  "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
  "Thoughts that you would be better off dead or of hurting yourself in some way",
];

const GAD7_QUESTIONS_EN = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];

const ANSWER_OPTIONS_EN = ["Not at all", "Several days", "More than half the days", "Nearly every day"];
const PREAMBLE_EN = "Over the last 2 weeks, how often have you been bothered by the following problems?";
const PHQ9_HEADER_EN = "PHQ-9 — Depression Screening";
const GAD7_HEADER_EN = "GAD-7 — Anxiety Screening";
const SUBMIT_EN = "Submit";
const VALIDATION_EN = "Please answer all questions before submitting.";

interface PhqGadFormProps {
  language: string;
  onSubmit: (results: PhqGadResults) => void;
}

function getPhq9Severity(total: number): PhqGadResults["phq9"]["severity"] {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  if (total <= 19) return "moderately_severe";
  return "severe";
}

function getGad7Severity(total: number): PhqGadResults["gad7"]["severity"] {
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  return "severe";
}

async function translateText(text: string, language: string): Promise<string> {
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
    });
    const data = await res.json();
    return (data as { translation?: string }).translation || text;
  } catch {
    return text;
  }
}

export default function PhqGadForm({ language, onSubmit }: PhqGadFormProps) {
  const [phq9Answers, setPhq9Answers] = useState<(number | null)[]>(Array(9).fill(null));
  const [gad7Answers, setGad7Answers] = useState<(number | null)[]>(Array(7).fill(null));
  const [showValidation, setShowValidation] = useState(false);

  const [translating, setTranslating] = useState(false);
  const [preamble, setPreamble] = useState(PREAMBLE_EN);
  const [phq9Header, setPhq9Header] = useState(PHQ9_HEADER_EN);
  const [gad7Header, setGad7Header] = useState(GAD7_HEADER_EN);
  const [phq9Questions, setPhq9Questions] = useState(PHQ9_QUESTIONS_EN);
  const [gad7Questions, setGad7Questions] = useState(GAD7_QUESTIONS_EN);
  const [answerOptions, setAnswerOptions] = useState(ANSWER_OPTIONS_EN);
  const [submitLabel, setSubmitLabel] = useState(SUBMIT_EN);
  const [validationLabel, setValidationLabel] = useState(VALIDATION_EN);

  useEffect(() => {
    if (!language || language === "en") return;

    setTranslating(true);
    const allStrings = [
      PREAMBLE_EN,
      PHQ9_HEADER_EN,
      GAD7_HEADER_EN,
      ...PHQ9_QUESTIONS_EN,
      ...GAD7_QUESTIONS_EN,
      ...ANSWER_OPTIONS_EN,
      SUBMIT_EN,
      VALIDATION_EN,
    ];

    Promise.all(allStrings.map((s) => translateText(s, language)))
      .then((results) => {
        let i = 0;
        setPreamble(results[i++]);
        setPhq9Header(results[i++]);
        setGad7Header(results[i++]);
        setPhq9Questions(results.slice(i, i + 9));
        i += 9;
        setGad7Questions(results.slice(i, i + 7));
        i += 7;
        setAnswerOptions(results.slice(i, i + 4));
        i += 4;
        setSubmitLabel(results[i++]);
        setValidationLabel(results[i++]);
      })
      .catch(() => {
        // fall back to English on error
      })
      .finally(() => setTranslating(false));
  }, [language]);

  function handleSubmit() {
    if (phq9Answers.some((a) => a === null) || gad7Answers.some((a) => a === null)) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);

    const phq9Total = phq9Answers.reduce<number>((sum, v) => sum + (v ?? 0), 0);
    const gad7Total = gad7Answers.reduce<number>((sum, v) => sum + (v ?? 0), 0);

    const results: PhqGadResults = {
      phq9: {
        items: phq9Answers.map((score, i) => ({
          question: PHQ9_QUESTIONS_EN[i],
          score: score!,
        })),
        total: phq9Total,
        severity: getPhq9Severity(phq9Total),
      },
      gad7: {
        items: gad7Answers.map((score, i) => ({
          question: GAD7_QUESTIONS_EN[i],
          score: score!,
        })),
        total: gad7Total,
        severity: getGad7Severity(gad7Total),
      },
      completedAt: new Date().toISOString(),
    };

    onSubmit(results);
  }

  if (translating) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
        <svg className="animate-spin mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Loading...
      </div>
    );
  }

  const allAnswered =
    phq9Answers.every((a) => a !== null) && gad7Answers.every((a) => a !== null);

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-4">
      <p className="text-base text-slate-700 mb-6 leading-relaxed">{preamble}</p>

      {/* PHQ-9 */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-slate-900 mb-4">{phq9Header}</h3>
        <div className="space-y-4">
          {phq9Questions.map((question, i) => {
            const isQ9 = i === 8;
            const answered = phq9Answers[i] !== null;
            const isQ9Alert = isQ9 && answered && phq9Answers[i]! > 0;
            return (
              <div
                key={i}
                className={`rounded-xl border px-4 py-3 ${
                  isQ9Alert
                    ? "border-red-300 bg-red-50"
                    : "border-slate-200 bg-slate-50/60"
                }`}
              >
                <p className={`text-sm font-medium mb-3 ${isQ9Alert ? "text-red-700" : "text-slate-800"}`}>
                  {i + 1}. {question}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                  {answerOptions.map((label, score) => (
                    <label
                      key={score}
                      className={`flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 text-sm transition select-none ${
                        phq9Answers[i] === score
                          ? isQ9Alert
                            ? "border-red-500 bg-red-100 text-red-800 font-medium"
                            : "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`phq9-q${i}`}
                        value={score}
                        checked={phq9Answers[i] === score}
                        onChange={() => {
                          const next = [...phq9Answers];
                          next[i] = score;
                          setPhq9Answers(next);
                          if (showValidation) setShowValidation(false);
                        }}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* GAD-7 */}
      <div className="mb-8">
        <h3 className="text-base font-semibold text-slate-900 mb-4">{gad7Header}</h3>
        <div className="space-y-4">
          {gad7Questions.map((question, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3"
            >
              <p className="text-sm font-medium text-slate-800 mb-3">
                {i + 1}. {question}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                {answerOptions.map((label, score) => (
                  <label
                    key={score}
                    className={`flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 text-sm transition select-none ${
                      gad7Answers[i] === score
                        ? "border-blue-500 bg-blue-50 text-blue-800 font-medium"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`gad7-q${i}`}
                      value={score}
                      checked={gad7Answers[i] === score}
                      onChange={() => {
                        const next = [...gad7Answers];
                        next[i] = score;
                        setGad7Answers(next);
                        if (showValidation) setShowValidation(false);
                      }}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showValidation && (
        <p className="text-sm text-red-600 mb-4">{validationLabel}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="w-full rounded-xl bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}
