"use client";

import { useState } from "react";
import type { PwdSectionE6FResults } from "@/lib/history-schema";

const ACTIVITIES = [
  "Personal self care",
  "Meal preparation",
  "Management of medications",
  "Basic housework",
  "Daily shopping",
  "Mobility inside the home",
  "Mobility outside the home",
  "Use of transportation",
  "Management of finances",
  "Social functioning (daily decision making; interacting, relating and communicating with others — applies for persons with an identified mental impairment or brain injury)",
];

type YNU = "yes" | "no" | "unknown";
type RestrictionType = "continuous" | "periodic" | null;

interface ActivityRow {
  restricted: YNU | null;
  restrictionType: RestrictionType;
}

interface PwdSectionE6FFormProps {
  onSubmit: (results: PwdSectionE6FResults) => void;
}

export default function PwdSectionE6FForm({ onSubmit }: PwdSectionE6FFormProps) {
  // Section E6
  const [hasDeficits, setHasDeficits] = useState<YNU | null>(null);
  const [deficitAreas, setDeficitAreas] = useState({
    consciousness: false,
    executive: false,
    language: false,
    memory: false,
    perceptualPsychomotor: false,
    psychoticSymptoms: false,
    emotionalDisturbance: false,
    motivation: false,
    impulseControl: false,
    motorActivity: false,
    attentionConcentration: false,
  });
  const [otherSpecify, setOtherSpecify] = useState("");
  const [otherChecked, setOtherChecked] = useState(false);
  const [functionalSkillsComments, setFunctionalSkillsComments] = useState("");

  // Section F
  const [isRestricted, setIsRestricted] = useState<YNU | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>(
    ACTIVITIES.map(() => ({ restricted: null, restrictionType: null }))
  );
  const [periodicExplanation, setPeriodicExplanation] = useState("");
  const [socialFunctioningExplanation, setSocialFunctioningExplanation] = useState("");
  const [additionalComments, setAdditionalComments] = useState("");
  const [assistanceNeeded, setAssistanceNeeded] = useState("");

  const [showValidation, setShowValidation] = useState(false);

  function setActivity(index: number, field: keyof ActivityRow, value: YNU | RestrictionType) {
    setActivities((prev) => {
      const next = [...prev];
      if (field === "restricted") {
        next[index] = { ...next[index], restricted: value as YNU, restrictionType: value !== "yes" ? null : next[index].restrictionType };
      } else {
        next[index] = { ...next[index], restrictionType: value as RestrictionType };
      }
      return next;
    });
  }

  function validate(): boolean {
    if (!hasDeficits) return false;
    if (!isRestricted) return false;
    if (isRestricted === "yes") {
      if (activities.some((a) => a.restricted === null)) return false;
    }
    return true;
  }

  function handleSubmit() {
    if (!validate()) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);

    const results: PwdSectionE6FResults = {
      sectionE6: {
        hasDeficits: hasDeficits!,
        deficitAreas: {
          ...deficitAreas,
          otherSpecify: otherChecked ? otherSpecify.trim() : "",
        },
        functionalSkillsComments: functionalSkillsComments.trim(),
      },
      sectionF: {
        isRestricted: isRestricted!,
        activities: ACTIVITIES.map((name, i) => ({
          activity: name,
          restricted: activities[i].restricted ?? "unknown",
          restrictionType: activities[i].restrictionType,
        })),
        periodicExplanation: periodicExplanation.trim(),
        socialFunctioningExplanation: socialFunctioningExplanation.trim(),
        additionalComments: additionalComments.trim(),
        assistanceNeeded: assistanceNeeded.trim(),
      },
      completedAt: new Date().toISOString(),
    };

    onSubmit(results);
  }

  const ynuOptions: { label: string; value: YNU }[] = [
    { label: "Yes", value: "yes" },
    { label: "No", value: "no" },
    { label: "Unknown", value: "unknown" },
  ];

  function YNURadio({ name, value, onChange }: { name: string; value: YNU | null; onChange: (v: YNU) => void }) {
    return (
      <div className="flex gap-4">
        {ynuOptions.map((opt) => (
          <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="accent-blue-600"
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }

  const deficitAreaLabels: { key: keyof typeof deficitAreas; label: string }[] = [
    { key: "consciousness", label: "Consciousness (orientation, confusion)" },
    { key: "executive", label: "Executive (planning, organizing, sequencing, calculations, judgement)" },
    { key: "language", label: "Language (oral, auditory, written comprehension or expression)" },
    { key: "memory", label: "Memory (ability to learn and recall information)" },
    { key: "perceptualPsychomotor", label: "Perceptual psychomotor (visual spatial)" },
    { key: "psychoticSymptoms", label: "Psychotic symptoms (delusions, hallucinations, thought disorders)" },
    { key: "emotionalDisturbance", label: "Emotional disturbance (e.g. depression, anxiety)" },
    { key: "motivation", label: "Motivation (loss of initiative or interest)" },
    { key: "impulseControl", label: "Impulse control" },
    { key: "motorActivity", label: "Motor activity (goal oriented activity, agitation, repetitive behaviour)" },
    { key: "attentionConcentration", label: "Attention or sustained concentration" },
  ];

  const hasPeriodic = activities.some((a) => a.restrictionType === "periodic");

  return (
    <div className="w-full max-w-2xl mx-auto py-6 px-4 space-y-8">
      <div>
        <h2 className="text-base font-bold text-slate-900 mb-1">PWD Medical Report — Section E6</h2>
        <p className="text-xs text-slate-500 mb-4">Functional Skills: Cognitive and Emotional Function</p>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-800 mb-2">
              6. Are there any significant deficits with <strong>cognitive and emotional function</strong>?
            </p>
            <YNURadio name="hasDeficits" value={hasDeficits} onChange={setHasDeficits} />
          </div>

          {hasDeficits === "yes" && (
            <div className="mt-3">
              <p className="text-xs text-slate-600 mb-2">
                If yes, check those areas where the deficits are evident:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {deficitAreaLabels.map(({ key, label }) => (
                  <label key={key} className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={deficitAreas[key]}
                      onChange={(e) => setDeficitAreas((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="mt-0.5 accent-blue-600 shrink-0"
                    />
                    {label}
                  </label>
                ))}
                <label className="flex items-start gap-2 cursor-pointer text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={otherChecked}
                    onChange={(e) => setOtherChecked(e.target.checked)}
                    className="mt-0.5 accent-blue-600 shrink-0"
                  />
                  <span>Other — Specify:</span>
                </label>
                {otherChecked && (
                  <input
                    type="text"
                    value={otherSpecify}
                    onChange={(e) => setOtherSpecify(e.target.value)}
                    placeholder="Please specify"
                    className="col-span-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-300"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Functional Skills Comments <span className="text-slate-400 font-normal">(regarding questions 1 to 6 above)</span>
          </label>
          <textarea
            value={functionalSkillsComments}
            onChange={(e) => setFunctionalSkillsComments(e.target.value)}
            rows={3}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
            placeholder="Optional comments…"
          />
        </div>
      </div>

      {/* Section F */}
      <div>
        <h2 className="text-base font-bold text-slate-900 mb-1">PWD Medical Report — Section F</h2>
        <p className="text-xs text-slate-500 mb-4">Daily Living Activities</p>

        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-800 mb-2">
              Does the impairment directly restrict the person's ability to perform Daily Living Activities?
            </p>
            <YNURadio name="isRestricted" value={isRestricted} onChange={setIsRestricted} />
          </div>

          {isRestricted === "yes" && (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-2 py-1.5 text-left font-semibold text-slate-700 w-1/3">
                      Daily Living Activity
                    </th>
                    <th className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-slate-700" colSpan={3}>
                      Is activity restricted? (check one)
                    </th>
                    <th className="border border-slate-300 px-2 py-1.5 text-center font-semibold text-slate-700" colSpan={2}>
                      If yes, restriction is: (check one)
                    </th>
                  </tr>
                  <tr className="bg-slate-50">
                    <th className="border border-slate-300 px-2 py-1" />
                    <th className="border border-slate-300 px-2 py-1 text-center font-medium text-slate-600">Yes</th>
                    <th className="border border-slate-300 px-2 py-1 text-center font-medium text-slate-600">No</th>
                    <th className="border border-slate-300 px-2 py-1 text-center font-medium text-slate-600">Unknown</th>
                    <th className="border border-slate-300 px-2 py-1 text-center font-medium text-slate-600">Continuous</th>
                    <th className="border border-slate-300 px-2 py-1 text-center font-medium text-slate-600">Periodic</th>
                  </tr>
                </thead>
                <tbody>
                  {ACTIVITIES.map((name, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                      <td className="border border-slate-300 px-2 py-1.5 text-slate-700">{name}</td>
                      {(["yes", "no", "unknown"] as YNU[]).map((v) => (
                        <td key={v} className="border border-slate-300 px-2 py-1.5 text-center">
                          <input
                            type="radio"
                            name={`activity-restricted-${i}`}
                            checked={activities[i].restricted === v}
                            onChange={() => setActivity(i, "restricted", v)}
                            className="accent-blue-600"
                          />
                        </td>
                      ))}
                      {(["continuous", "periodic"] as const).map((v) => (
                        <td key={v} className="border border-slate-300 px-2 py-1.5 text-center">
                          <input
                            type="radio"
                            name={`activity-restriction-${i}`}
                            checked={activities[i].restrictionType === v}
                            disabled={activities[i].restricted !== "yes"}
                            onChange={() => setActivity(i, "restrictionType", v)}
                            className="accent-blue-600 disabled:opacity-30"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {isRestricted === "yes" && (
          <div className="mt-4 space-y-3">
            {hasPeriodic && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  * If &ldquo;Periodic&rdquo;, please explain:
                </label>
                <textarea
                  value={periodicExplanation}
                  onChange={(e) => setPeriodicExplanation(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
            )}

            {activities[ACTIVITIES.length - 1].restricted === "yes" && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  ** If Social Functioning is impacted, please explain:
                </label>
                <textarea
                  value={socialFunctioningExplanation}
                  onChange={(e) => setSocialFunctioningExplanation(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Please provide additional comments regarding the degree of restriction:
              </label>
              <textarea
                value={additionalComments}
                onChange={(e) => setAdditionalComments(e.target.value)}
                rows={2}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                What assistance does your patient need with Daily Living Activities?{" "}
                <span className="text-slate-400 font-normal text-xs">
                  (&ldquo;Assistance&rdquo; includes help from another person, equipment and assistance animals.)
                </span>
              </label>
              <textarea
                value={assistanceNeeded}
                onChange={(e) => setAssistanceNeeded(e.target.value)}
                rows={3}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                placeholder="Please be specific regarding the nature and extent of assistance required…"
              />
            </div>
          </div>
        )}
      </div>

      {showValidation && (
        <p className="text-sm text-red-600">
          Please answer all required questions before submitting.
        </p>
      )}

      <button
        onClick={handleSubmit}
        className="w-full rounded-xl bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-900"
      >
        Submit
      </button>
    </div>
  );
}
