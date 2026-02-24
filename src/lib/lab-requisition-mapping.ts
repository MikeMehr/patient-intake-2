export type LabOrderMappingResult = {
  mappedFieldIds: string[];
  mappedTests: string[];
  unmappedTests: string[];
};

const LAB_FIELD_MAP: Array<{ id: string; terms: string[] }> = [
  { id: "HematologyProfile", terms: ["cbc", "complete blood count", "hematology profile"] },
  { id: "Ferritin", terms: ["ferritin"] },
  { id: "PTINR", terms: ["inr", "pt/inr", "pt inr", "prothrombin time"] },
  { id: "GlucoseFasting", terms: ["fasting glucose", "fbs", "fasting blood sugar"] },
  { id: "GlucoseRandom", terms: ["random glucose", "rbs", "random blood sugar"] },
  { id: "A1c", terms: ["a1c", "hba1c", "hemoglobin a1c"] },
  { id: "ACR", terms: ["acr", "albumin creatinine ratio", "urine acr"] },
  { id: "CreatinineGFR", terms: ["creatinine", "egfr", "renal function", "kidney function"] },
  { id: "Sodium", terms: ["sodium", "na"] },
  { id: "Potassium", terms: ["potassium", "k+", "k"] },
  { id: "ALT", terms: ["alt", "alanine aminotransferase"] },
  { id: "AST", terms: ["ast", "aspartate aminotransferase"] },
  { id: "AlkPhos", terms: ["alk phos", "alkaline phosphatase", "alp"] },
  { id: "Bilirubin", terms: ["bilirubin"] },
  { id: "GGT", terms: ["ggt", "gamma gt", "gamma glutamyl transferase"] },
  { id: "TSH", terms: ["tsh", "thyroid stimulating hormone"] },
  { id: "Lipid_full", terms: ["lipid", "lipid panel", "cholesterol", "lipid profile"] },
  { id: "UrineMacroscopicCultureIfPyuriaOrNitrate", terms: ["urinalysis", "urine analysis", "ua"] },
  { id: "Urine_CS", terms: ["urine culture", "c&s urine", "urine c&s", "urine cs"] },
  { id: "Stool", terms: ["stool culture", "stool studies", "stool test"] },
  { id: "Throat", terms: ["covid pcr", "sars-cov-2 pcr", "influenza pcr", "flu pcr", "naat", "respiratory viral pcr"] },
  { id: "HIVNominal", terms: ["hiv", "hiv screen", "hiv test"] },
  { id: "HBsAg", terms: ["hbsag", "hepatitis b surface antigen"] },
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function matchesCandidate(candidate: string, term: string): boolean {
  if (!candidate || !term) return false;
  if (candidate === term) return true;

  const candidateTokens = new Set(candidate.split(" ").filter(Boolean));
  const termTokens = term.split(" ").filter(Boolean);
  if (termTokens.length === 1) {
    const single = termTokens[0];
    if (single.length <= 3) {
      return candidateTokens.has(single);
    }
    return candidate.includes(single);
  }

  // For multi-word terms, avoid reverse substring checks (e.g. candidate "k"
  // matching term "kidney function"), which causes false positives.
  return candidate.includes(term);
}

export function mapLabTestsToEformFields(tests: string[]): LabOrderMappingResult {
  const mappedFieldIds = new Set<string>();
  const mappedTests: string[] = [];
  const unmappedTests: string[] = [];

  for (const original of tests) {
    const candidate = normalize(original);
    if (!candidate) continue;

    const matched = LAB_FIELD_MAP.find((entry) =>
      entry.terms.some((term) => {
        const t = normalize(term);
        return matchesCandidate(candidate, t);
      }),
    );

    if (!matched) {
      unmappedTests.push(original);
      continue;
    }

    mappedFieldIds.add(matched.id);
    mappedTests.push(original);
  }

  return {
    mappedFieldIds: Array.from(mappedFieldIds),
    mappedTests,
    unmappedTests,
  };
}
