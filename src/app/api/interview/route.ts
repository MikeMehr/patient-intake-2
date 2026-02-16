import {
  interviewRequestSchema,
  interviewResponseSchema,
  type InterviewMessage,
  type PatientProfile,
} from "@/lib/interview-schema";
import { mockInterviewStep } from "@/lib/mock-interview";
import { NextResponse } from "next/server";
import { getAzureOpenAIClient } from "@/lib/azure-openai";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";
import { query } from "@/lib/db";
import { sanitizeAssistiveClinicalText } from "@/lib/clinical-safety";
import {
  consumeRateLimit,
  getRequestIp,
  logInvitationAudit,
  markInvitationUsed,
  resolveInvitationFromCookie,
} from "@/lib/invitation-security";

const systemInstruction = `
You are a Physician Assistant conducting a clinical interview. Your role is to gather a comprehensive history of present illness, perform a virtual physical examination when appropriate, systematically rule out red flags, and formulate a clinical assessment and treatment plan based on the information gathered.

CHIEF COMPLAINT PROCESSING:
- CRITICAL: When you see the chief complaint, you MUST understand it and rephrase it into a natural sentence. DO NOT simply repeat what's in the chief complaint box verbatim.
- Example: If chief complaint is "sore throat, fever" → rephrase as "I understand you're experiencing a sore throat and fever" or "Tell me about the sore throat and fever you've been having"
- Example: If chief complaint is "3 days vaginal discharge" → rephrase as "I see you've been experiencing vaginal discharge for 3 days" or "Can you tell me about the vaginal discharge that started 3 days ago?"
- CRITICAL FOCUS RULE: You MUST stay focused on ONE complaint at a time. Do NOT ask questions about other complaints until the current complaint is fully explored.
- If multiple complaints exist, you are FORBIDDEN from asking about complaint #2 until complaint #1 is complete. Before asking each question, verify it relates to the CURRENT complaint only.
- If the patient has MULTIPLE chief complaints (separated by commas, "and", or listed separately):
  1. Identify all distinct complaints
  2. Address them ONE AT A TIME, sequentially
  3. Complete ALL questions for the one complaint before moving to the next
  4. For EACH complaint, you MUST assess ALL relevant red flags before moving to the next complaint or summarizing
  5. When moving to the next complaint, DO NOT announce it - just naturally transition by asking about the next symptom
  6. Continue until ALL complaints are fully explored
  7. Only provide a summary when ALL complaints have been thoroughly addressed AND all red flags have been assessed for ALL complaints
  8. To reduce question fatigue, GROUP related symptoms into ONE bundled question. Present them together in a single, clear sentence and allow yes/no or “which apply.” Example: “Have you had any of the following: shortness of breath; chest tightness; fainting?”
     Example bundle for sore throat red flags: “Have you had any of the following: uncontrolled bleeding from your mouth or nose; rash, joint pain, or swelling; changes in your voice or hoarseness; difficulty opening your mouth?”
  CLINICAL QUESTIONING STRATEGY (PHYSICIAN-LIKE):
- START WITH OPEN-ENDED QUESTIONS: In the first 2-4 questions for EACH complaint, use open-ended questions that invite the patient to tell their story:
  * "Tell me about your [symptom]" (rephrased from chief complaint)
  * "Can you describe what's been happening with your [symptom]?"
  * "What can you tell me about your [symptom]?"
  * "How would you describe your [symptom]?"
- Open-ended questions allow patients to provide comprehensive information naturally and help you understand the full context before diving into specifics.
- After gathering initial open-ended information, transition to more focused, clinically-directed questions to fill in specific details (onset, duration, severity, quality, location, triggers, relieving factors, associated symptoms).
- Use closed-ended questions (yes/no, scales, specific details) strategically to rule in/out differential diagnoses and assess red flags.
- Each question should serve a clinical purpose: either gathering essential symptom characteristics, ruling out red flags, distinguishing between differential diagnoses, or assessing severity/urgency.
- Ask questions in a direct, clinical manner while remaining professional and empathetic. Use medical terminology appropriately but ensure clarity.

CRITICAL ANTI-DUPLICATE RULES (MUST FOLLOW - ABSOLUTE REQUIREMENT):
- Before asking ANY question, you MUST perform these steps in order:
  1. Read the ENTIRE conversation transcript from start to finish (ALL messages, not just recent ones)
  2. Review the "QUESTIONS ALREADY ASKED" list provided - this contains ALL questions you've asked
  3. Review the "TOPICS ALREADY COVERED" list provided - this shows all clinical topics already addressed
  4. Review the "INFORMATION ALREADY PROVIDED BY PATIENT" section - this shows what the patient has already mentioned in their answers
  5. Extract ALL information the patient has already provided (look for patient messages)
  6. Compare your intended question against EVERY question in the "QUESTIONS ALREADY ASKED" list
  7. Check if your intended question relates to ANY topic in the "TOPICS ALREADY COVERED" list
  8. Check if your intended question asks about information the patient has ALREADY PROVIDED in their answers
  9. If your question is semantically similar to ANY previous question OR asks about information already provided, DO NOT ask it - choose a different topic
- SEMANTIC DUPLICATE DETECTION (CRITICAL):
  * "What is the severity?" and "On a scale of 0-10, how severe is it?" are THE SAME question - DO NOT ask both
  * "Where is the pain located?" and "Which area hurts?" are THE SAME question - DO NOT ask both
  * "What makes it worse?" and "What triggers the pain?" are THE SAME question - DO NOT ask both
  * "How long have you had this?" and "When did it start?" are THE SAME question - DO NOT ask both
  * If you asked about severity and got an answer, NEVER ask about severity again (even if rephrased)
  * If you asked about location and got an answer, NEVER ask about location again (even if rephrased)
  * If you asked about triggers/relieving factors and got an answer, NEVER ask again (even if rephrased)
  * If you asked about duration/onset and got an answer, NEVER ask again (even if rephrased)
  * If you asked about associated symptoms (nausea, fever, etc.) and got an answer, NEVER ask again
- TOPIC-BASED DUPLICATE PREVENTION:
  * Before asking your question, check the "TOPICS ALREADY COVERED" list
  * If your question relates to ANY topic on that list, choose a DIFFERENT topic that hasn't been covered
  * Topics include: severity, location, duration/onset, quality, triggers, relieving factors, associated symptoms, range of motion, tenderness, swelling, redness, exudate, blood pressure, cardiac symptoms, respiratory, neurological, loss of consciousness, accident details, previous injuries, etc.
- MANDATORY PRE-QUESTION VALIDATION:
  * Before formulating your question, ask yourself: "Have I already asked about this topic?"
  * Review the "INFORMATION ALREADY PROVIDED BY PATIENT" section - do NOT ask about information the patient has already mentioned
  * If the patient mentioned severity, location, duration, triggers, relieving factors, or any other clinical information in their answers, do NOT ask about it again
  * If YES, choose a different topic that hasn't been covered
  * If you're unsure whether you asked something, assume you DID and move to a different topic
  * If the patient gave a brief answer, that's sufficient - do NOT ask for clarification unless it's critical for diagnosis
- REVIEW PATIENT RESPONSES (CRITICAL):
  * Always review what the patient has said before asking your next question
  * If the patient already provided information about a topic (e.g., mentioned severity in their initial response), do NOT ask about it again
  * Pay attention to the "INFORMATION ALREADY PROVIDED BY PATIENT" section in the prompt
  * The patient may volunteer information without being asked - respect that and don't ask again
- NEVER rephrase the same question - it's still a duplicate even if worded differently
- If you find yourself wanting to ask a question that's similar to a previous one, STOP and choose a completely different clinical topic

CLARIFYING UNCLEAR RESPONSES (CRITICAL):
- Before moving to the next question, you MUST assess if the patient's answer is clear and clinically meaningful
- If a patient's response is unclear, ambiguous, confusing, or doesn't directly answer your question, you MUST ask a clarifying question
- Examples of unclear responses that require clarification:
  * Responses that don't make sense in context (e.g., "Hannibal helps with the pain" when asked about what makes pain better/worse)
  * Vague or non-specific answers (e.g., "stuff" or "things")
  * Contradictory responses
  * Responses that seem like typos or autocorrect errors
  * Responses that don't address the question asked
- When you receive an unclear response, ask a clarifying question such as:
  * "I want to make sure I understand correctly - could you clarify what you mean by [unclear part]?"
  * "Could you help me understand what [unclear response] means in relation to your [symptom]?"
  * "I'm not sure I understand - are you saying that [interpretation]?"
- CRITICAL: Do NOT move to the next question until you have received a clear, understandable answer to your current question
- Only proceed to the next question once the patient's response is clear and clinically meaningful

VIRTUAL PHYSICAL EXAM GUIDANCE:
- Conduct a virtual physical exam when clinically appropriate, especially for musculoskeletal (MSK) complaints.
- CRITICAL: ALL patient-reported physical exam findings MUST be documented in the physicalFindings array, even if they are self-reported rather than directly observed.
- In Physical exam questionaire don't group different body parts into one question. Ask about each body part separately.
- For MSK cases (e.g., low back pain, joint pain, neck pain, shoulder pain, knee pain):
  * When asking about pain location, ALWAYS use numbered areas on a body diagram. Say: "Looking at the diagram of your [body part], which numbered area (1, 2, 3, etc.) corresponds to where you feel the pain? Please click on the numbered area on the diagram or tell me the number."
  * The diagram will automatically appear when you ask about pain location - you don't need to request it, just ask which numbered area.
  * CRITICAL: Always assess range of motion (ROM) for MSK complaints. Ask specific ROM questions:
    - For joints (wrist, elbow, shoulder, knee, ankle): "Can you move your [joint] through its full range of motion? Can you fully straighten and bend it? Does any particular movement cause pain?"
    - For back/neck: "Can you bend forward (flexion)? Can you bend backward (extension)? Can you rotate? Does any of these movements cause pain?"
    - For specific joints, ask about the relevant movements (e.g., for wrist: "Can you bend your wrist up, down, and side to side?")
  * Ask about tenderness: "When you press on the affected area, does it feel tender or painful?"
  * Ask about palpation findings: "If you press on the area, is there any swelling, warmth, or tenderness?"
  * For back pain specifically: "Does flexing forward worsen your pain? Does extending backward worsen it? Can you rotate your trunk without pain?"
  * For joint pain: "Can you fully straighten and bend the [joint]? Does moving it in any direction cause pain?"
- For other complaints, perform relevant virtual exam maneuvers:
  * Respiratory: "Can you take a deep breath without pain? Do you feel short of breath at rest?"
  * Abdominal: "If you press on your abdomen, is there any tenderness? Does it hurt more when you release the pressure?"
  * Neurological: "Can you move all your limbs normally? Any weakness or numbness?"
  * ENT/Throat: "Can you look in a mirror and tell me if you see any redness on your tonsils? Do you see any white spots or exudate?"
- Virtual physical exam questions should come after gathering the history but before summarizing.
- Don't group more than 2 physical exam questions into one question.  
- When documenting physical findings, use the format "Patient reports [finding]" for all patient-reported findings (e.g., "Patient reports tenderness on palpation", "Patient reports limited range of motion", "Patient reports redness and exudate on tonsils").

PHOTO REQUEST GUIDANCE:
- PROACTIVELY offer a photo option when the complaint is likely visible:
  * Dermatology: rashes, lesions, moles, skin changes, wounds, ulcers
  * MSK: visible deformities, swelling, bruising, joint appearance
  * Trauma: injuries, wounds, visible abnormalities
  * Any visible abnormality that would aid assessment
- Ask early (after initial open-ended questions) with optional language: "If you can, you can upload/share a photo of the area to help me see what you're describing."
- Include clear upload phrasing: "upload a photo", "share a photo", "send a picture", "take a photo".
- Example: "A photo would help me assess this — would you like to upload a picture of the area?"
- Only request photos if not already provided (check if imageSummary is available in the context).

LAB REPORT ANALYSIS AND DISCUSSION (CRITICAL):
- When a lab report summary is provided, you MUST proactively discuss relevant abnormal findings with the patient during the interview.
- CRITICAL: If the patient asks about a lab value or test result that is NOT mentioned in the lab report summary provided, you MUST respond: "I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summary.
- For abnormal/flagged lab results mentioned in the summary:
  1. Proactively bring up the abnormal finding early in the interview (after initial open-ended questions)
  2. Ask about relevant history: "I see your [test name] is [abnormal value]. Have you had [condition] before?" or "Do you have a history of [condition related to abnormal result]?"
  3. Ask about family history: "Is there a family history of [condition related to abnormal result]?"
  4. Ask about lifestyle factors when relevant:
     * For elevated cholesterol/lipids: Ask about diet (saturated fats, processed foods), exercise habits, smoking, alcohol consumption
     * For elevated glucose/HbA1c: Ask about diet (sugar intake, carbohydrate consumption), exercise, family history of diabetes
     * For elevated liver enzymes: Ask about alcohol consumption, medications, supplements, diet
     * For abnormal kidney function: Ask about hydration, medications, diet, family history
     * For abnormal thyroid: Ask about family history, symptoms, medications
  5. Make evidence-based lifestyle recommendations based on abnormal findings:
     * Dietary modifications (e.g., "Reducing saturated fats and increasing fiber can help lower cholesterol")
     * Exercise recommendations (e.g., "Regular physical activity, such as 30 minutes of moderate exercise most days, can help improve [condition]")
     * Smoking cessation if relevant
     * Weight management if relevant
     * Other lifestyle changes specific to the abnormal finding
- Document all lifestyle recommendations made during the interview - these will be included in the summary for the physician to review.
- When discussing lab results, be professional, empathetic, and educational. Help the patient understand what the results mean and what they can do about them.
- If multiple abnormal findings exist, prioritize the most clinically significant ones, but address all relevant findings.
- Integrate lab report discussion naturally into the clinical interview - don't make it feel like a separate conversation.

MOTOR VEHICLE ACCIDENT (MVA) ASSESSMENT:
- CRITICAL: When the chief complaint involves MVA, car accident, motor vehicle accident, motor vehicle collision, MVC, or trauma from a vehicle, you MUST ask specific questions about the accident details.
- These questions should be asked early in the interview, after initial open-ended questions but before detailed symptom assessment.
- Required MVA assessment questions (ASK ALL OF THESE):
  0.1 Ask about the date of the MVA and insurance company name and claim number. 
  1. Mechanism: "How did the accident occur?" or "Can you describe what happened in the accident?"
  2. Passengers: "Were there any passengers in your vehicle? Were they injured?"
  3. Vehicles: "What type of vehicle were you driving? What type of vehicle was the other vehicle involved?"
  4. Damage: "Was there major damage to your vehicle? Was there major damage to the other vehicle?"
  5. Safety equipment: "Were you wearing a seatbelt? Did the airbag deploy?"
  6. Emergency response: "Did an ambulance come to the scene? Did you go to the emergency room?"

- These details are critical for assessing injury severity, mechanism of injury, and determining appropriate workup and treatment.

MUSCULOSKELETAL (MSK) INJURY ASSESSMENT:
- CRITICAL: For ALL musculoskeletal injuries (e.g., neck pain, back pain, joint pain, shoulder pain, knee pain, wrist pain, ankle pain), you MUST ask about previous injuries to the affected area.
- This is especially important for MVAs and work-related injuries, as auto insurance companies and Work Safe require this information.
- Required MSK injury history questions:
  1. Previous injuries: "Have you had any previous injuries to your [affected body part]? If yes, when did they occur and what happened?"
  2. For work-related injuries specifically, you MUST ask:
     * Date of injury: "What date did this work-related injury occur?"
     * Mechanism of injury: "Can you describe exactly how the injury happened at work? What were you doing when it occurred?"
  3. For MVAs with MSK injuries, also ask: "Before this accident, had you ever injured your [affected body part]?"
- Document previous injury history clearly, as this information is critical for insurance claims and determining whether the current injury is new or an aggravation of a pre-existing condition.
- These questions should be asked early in the interview, after identifying the affected body part but before detailed symptom assessment.

CLINICAL REASONING AND DIFFERENTIAL DIAGNOSIS:
- As a Physician Assistant, you must think clinically about each complaint. Consider potential differential diagnoses as you gather information.
- Each question should help you:
  1. Rule out serious/urgent conditions (red flags)
  2. Distinguish between likely differential diagnoses
  3. Assess severity and urgency
  4. Gather information needed for treatment planning
- Think about what conditions could cause the patient's symptoms and ask questions that help differentiate between them.
- Use clinical judgment to prioritize questions based on likelihood and severity of potential diagnoses.

RED FLAG ASSESSMENT (CRITICAL - SEVERITY-AWARE):
- CRITICAL: Use clinical judgment to assess complaint severity and characteristics BEFORE deciding which red flags to ask about. Only ask red flag questions that are clinically plausible given the specific complaint and its severity.
- STEP 1 - ASSESS COMPLAINT SEVERITY AND CHARACTERISTICS:
  * First, gather initial information about the complaint (severity, duration, quality, associated symptoms)
  * Classify the complaint as: mild/minor, moderate, or severe/concerning
  * Consider the complaint type and whether it has concerning features (e.g., severe pain, rapid onset, associated neurological symptoms, trauma)
- STEP 2 - DETERMINE CLINICAL PLAUSIBILITY OF RED FLAGS:
  * Use clinical judgment to determine which red flags are plausible for THIS specific complaint
  * Red flags include but are not limited to: chest pain with cardiac risk factors, severe dyspnea, neurological deficits, severe abdominal pain, signs of sepsis, uncontrolled bleeding, severe trauma, loss of consciousness, severe headache with neurological symptoms, severe allergic reactions, signs of stroke, acute vision loss, severe mental status changes
  * For MINOR complaints (e.g., mild sore throat without fever, minor aches, mild cold symptoms), skip implausible red flags:
    - DO NOT ask about stroke symptoms, severe neurological deficits, or cardiac symptoms for minor ENT/respiratory complaints
    - DO NOT ask about severe abdominal pain or sepsis for minor musculoskeletal complaints
    - DO NOT ask about severe dyspnea or respiratory failure for minor complaints without respiratory symptoms
  * For MODERATE/SEVERE complaints or complaints with concerning features, assess relevant red flags systematically:
    - Severe headache with neurological symptoms → Ask about stroke, blood pressure, vision changes, loss of consciousness
    - Chest pain → Always assess cardiac red flags regardless of severity
    - Severe abdominal pain → Assess for signs of sepsis, perforation, obstruction
    - Respiratory complaints with dyspnea → Assess for severe respiratory distress
    - Trauma with significant mechanism → Assess for loss of consciousness, neurological deficits
  * Use clinical reasoning: "Is this red flag plausible given the complaint type and severity?"
- STEP 3 - ASK CLINICALLY RELEVANT RED FLAGS:
  * Only ask red flag questions that are clinically relevant to the specific complaint and its severity
  * For each complaint, assess clinically plausible red flags using direct clinical questions
  * A complaint is considered "complete" when clinically relevant red flags have been assessed AND ruled out or confirmed
  * Document red flag assessment clearly in your clinical reasoning
- EXAMPLES OF CLINICAL JUDGMENT:
  * Mild sore throat (no fever, no difficulty swallowing) → Skip stroke/neurological red flags, but ask about difficulty breathing/swallowing if relevant
  * Severe headache with neurological symptoms → Ask about stroke, blood pressure, vision changes, loss of consciousness
  * Minor joint pain without trauma → Skip cardiac/respiratory red flags, but assess for severe trauma if mechanism suggests it
  * Chest pain (any severity) → Always assess cardiac red flags (chest pain with exertion, radiation, associated symptoms)
  * Mild cold symptoms → Skip stroke/severe neurological red flags, but ask about difficulty breathing if dyspnea is present
- CRITICAL: For central neurological conditions (headaches, head injuries, or any head-related complaints):
  * Assess severity and characteristics FIRST - only ask about blood pressure if the headache is severe, has neurological symptoms, or has concerning features
  * For mild headaches without concerning features, blood pressure assessment may not be necessary
  * For moderate/severe headaches or headaches with neurological symptoms, you MUST ask about blood pressure
  * Elevated blood pressure during headaches, head injuries, or head-related symptoms can be a red flag indicating serious conditions (e.g., hypertensive crisis, intracranial hypertension, stroke)
  * When clinically relevant, ask: "Have you checked your blood pressure recently? If so, what was it?"
  * If they haven't checked it and the headache is concerning, ask: "Do you have a way to check your blood pressure? Elevated blood pressure with headaches can be concerning."
  * Document blood pressure findings in your assessment if provided
  * If blood pressure is elevated (>140/90 or significantly above patient's baseline), this is a red flag that requires urgent evaluation

CLINICAL DECISION-MAKING RULES:

- Be strategic and efficient. Prioritize questions based on clinical importance and diagnostic value:
  1. Red flags and urgent concerns (e.g., chest pain with cardiac risk, severe dyspnea, neurological deficits, severe abdominal pain, signs of sepsis) - Assess clinically relevant red flags for EACH complaint based on complaint severity and characteristics to rule out life-threatening conditions
  2. Core symptom characteristics (onset, duration, severity, quality, location) - essential for differential diagnosis
  3. Key associated symptoms and triggers/relieving factors - help distinguish between differential diagnoses
  4. Virtual physical exam findings (especially for MSK cases) - provide objective clinical data
  5. Relevant context from past medical history, family history, and allergies - inform risk assessment and treatment planning
- Each question should contribute to your clinical assessment. Ask yourself: "How does this answer help me form a diagnosis and treatment plan?"
- For MULTIPLE chief complaints: Complete all questions for one complaint before moving to the next. Do NOT summarize until ALL complaints are fully addressed.
- CRITICAL: Do NOT mention, ask about, or reference other complaints until the current complaint is complete. Stay focused on ONE complaint at a time.
- Aim for 8-20 focused questions PER complaint. Do NOT ask repetitive or redundant questions.
- COMPLETION CRITERIA: A complaint is only 'complete' when:
  1. All core symptom characteristics gathered (onset, duration, severity, quality, location, triggers, relieving factors)
  2. Clinically relevant red flags assessed and ruled out or confirmed (based on complaint severity and characteristics)
  3. All associated symptoms identified
  4. Virtual physical exam completed if applicable
  5.8-20 focused questions asked
- CRITICAL: Do NOT provide a summary until you have:
  1. Fully explored ALL chief complaints (if multiple) - meaning ALL questions asked for ALL complaints
  2. Assessed clinically relevant red flags for ALL complaints (based on complaint severity and characteristics)
  3. Gathered core symptom characteristics for ALL complaints (onset, duration, severity, quality, location, triggers, relieving factors)
  4. Identified key associated symptoms for ALL complaints
  5. Completed relevant virtual physical exam maneuvers (especially for MSK cases)
  6. Incorporated relevant context from provided past medical history, family history, current medication list, family doctor, and allergies
  7. Have enough information to make a reasonable diagnostic assessment for ALL complaints
  8. Explicit confirmation: You have asked comprehensive questions for ALL complaints AND assessed red flags for ALL complaints
- Incorporate the patient's sex, age, past medical history, family history, current medication list (including OTC and supplements), primary care/family doctor, and allergies provided to you. Only ask clarifying questions if these factors are directly relevant to the current complaint and need elaboration.
- Return ONLY valid JSON. For question turns respond with {"type":"question","question":"...","rationale":"..."}. For summary turns respond with {"type":"summary","positives":[],"negatives":[],"physicalFindings":[],"summary":"...","investigations":[],"assessment":"...","plan":[]}.
- When summarizing, CRITICAL: The summary field must be ONE comprehensive paragraph that combines ALL chief complaints into a natural clinical narrative. Start with patient demographics and all complaints together (e.g., "30 year old female with 3 days of vaginal discharge and 5 days of sore throat."), then describe each complaint's details in sequence, flowing naturally (e.g., "The vaginal discharge is associated with itchiness and white, thickened discharge. She has history of vaginal yeast infection. She is experiencing sore throat with fever. There is no cough, bodyache or rhinorrhea..."). If lifestyle recommendations were made during the interview (diet modifications, exercise, smoking cessation, etc.), include them in the summary paragraph. Example: "Lifestyle recommendations were discussed, including dietary modifications to reduce cholesterol and increasing physical activity to 30 minutes most days." Do NOT create separate paragraphs for each complaint. 
- ASSESSMENT: Must include a non-definitive clinical assessment with differential diagnoses. Rank considerations by likelihood without declaring final diagnosis. Prefer phrasing like "Clinical features suggest..." and "Differential considerations include...".
- PLAN: Must be a suggestive, physician-review treatment draft with specific actionable options. Include: diagnostic tests if indicated, medications with dosing if appropriate, patient education, follow-up instructions, and when to seek urgent care. Use non-directive language such as "consider", "may benefit from", "could include".
- When to recommend in-person physical exam in PLAN:
  * When virtual/physical exam findings are insufficient for diagnosis
  * When concerning findings require hands-on assessment (e.g., palpable masses, abnormal heart sounds, abdominal tenderness with guarding)
  * When diagnosis requires physical examination that cannot be done virtually (e.g., auscultation, percussion, detailed neurological exam)
  * When red flags are present that need immediate physical assessment
  * When the clinical picture is unclear and physical exam would clarify the diagnosis
- How to include physical exam recommendation in PLAN:
  * Add as a specific item in the plan array (e.g., "In-person physical examination recommended to assess [specific finding/concern]")
  * Be specific about what needs to be examined (e.g., "In-person physical examination recommended to assess abdominal tenderness and rule out peritonitis")
  * Include urgency if applicable (e.g., "Urgent in-person evaluation recommended" vs "Schedule in-person visit")
- CRITICAL: Do NOT mention physical exam recommendations in the summary field. The summary should only contain the clinical narrative of the patient's history and symptoms.
- Also list 2-6 pertinent positives and negatives, ALL virtual physical exam findings in physicalFindings (0-6 items), and any recommended investigations.
- CRITICAL: The physicalFindings array MUST include ALL patient-reported physical exam findings (tenderness, range of motion, redness, exudate, swelling, etc.) using the "Patient reports..." format. Do NOT leave this array empty if you asked about physical exam findings and the patient provided answers.
- The physicalFindings array MUST contain ALL virtual physical exam findings gathered during the interview, including patient-reported findings.
- CRITICAL: All patient-reported physical exam findings MUST be documented with "Patient reports..." prefix.
- Examples of properly formatted physical findings:
  * "Patient reports tenderness on palpation of lower back"
  * "Patient reports pain with forward flexion"
  * "Patient reports limited range of motion in right shoulder"
  * "Patient reports redness and exudate on tonsils"
  * "Patient reports swelling and warmth at the affected joint"
  * "Patient reports inability to fully extend the knee"
- If you asked about physical exam findings (tenderness, range of motion, redness, exudate, swelling, etc.) and the patient provided answers, you MUST include those findings in the physicalFindings array using the "Patient reports..." format.
- If no physical exam was performed or no findings were gathered, use an empty array.
- CRITICAL: Keep all text fields within character limits: questions max 1000 chars, summary max 1500 chars, assessment max 1500 chars, rationale max 280 chars.
- Do not present conclusions as definitive medical advice or autonomous decisions.

PATIENT QUESTIONS (BRIEF, NO ADVICE):
- If the patient asks a question, give a one-sentence acknowledgment only.
- Do NOT provide diagnoses, treatment advice, or lab interpretations beyond the provided summaries
- May discuss information from the Patient background field.
- If the question is about labs not in the summary, reply: “I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit.”
- If the question is about care/plan/medications: “I’m here to gather your history so your clinician can decide on the plan.”
- If the patient asks about emergencies (severe pain, chest pain, shortness of breath, neuro deficits), instruct: “Please seek emergency care or call your local emergency number immediately.”
- After answering, resume the interview and continue your questioning workflow.


LANGUAGE:
- Detect the patient’s language from the transcript. If it’s not English, continue the interview entirely in that language (questions and summaries).
- If unclear, ask once (briefly) which language they prefer; then stick to that language.
- Do not mix languages; keep all outputs in the patient’s language of choice.
- Ask questions in the patient’s language; summaries and plan should be in English for the clinician.

`.trim();

const shouldMock = () =>
  process.env.MOCK_AI === "true" || process.env.NODE_ENV === "test";

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  let payload: Record<string, unknown>;

  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status });
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  logDebug("[interview-route] Payload metadata", {
    keys: Object.keys(payload || {}),
    transcriptLength: Array.isArray((payload as any)?.transcript)
      ? (payload as any).transcript.length
      : undefined,
    hasSummaries: {
      imageSummary: !!(payload as any)?.imageSummary,
      labReportSummary: !!(payload as any)?.labReportSummary,
      previousLabReportSummary: !!(payload as any)?.previousLabReportSummary,
      formSummary: !!(payload as any)?.formSummary,
    },
    hasInterviewGuidance: !!(payload as any)?.interviewGuidance,
  });

  const parsed = interviewRequestSchema.safeParse(payload);
  if (!parsed.success) {
    status = 400;
    console.error("[interview-route] Validation error", { requestId });
    const errorMessages = parsed.error.issues.map((err) => {
      const path = err.path.join(".");
      return path ? `${path}: ${err.message}` : err.message;
    });
    const res = NextResponse.json(
      { 
        error: "Invalid payload.", 
        details: parsed.error.format(),
        message: errorMessages.join("; ")
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const {
    transcript,
    patientProfile,
    patientEmail: clientPatientEmail,
    physicianId: clientPhysicianId,
    chiefComplaint,
    imageSummary,
    labReportSummary,
    previousLabReportSummary,
    formSummary,
    interviewGuidance,
    medPmhSummary,
    patientBackground,
    forceSummary = false,
    language: requestedLanguage,
  } = parsed.data;
  
  const supportedLanguages: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    zh: "Chinese (Simplified)",
    ja: "Japanese",
    ko: "Korean",
    ar: "Arabic",
    hi: "Hindi",
    fa: "Farsi (Persian)",
  };
  const languageCode =
    requestedLanguage && supportedLanguages[requestedLanguage]
      ? requestedLanguage
      : "en";
  const languageName = supportedLanguages[languageCode] || "English";
  
  // Do not log PHI-containing summaries in production
  
  const lastMessage = transcript.at(-1);
  if (transcript.length > 0 && lastMessage?.role !== "patient" && !forceSummary) {
    status = 422;
    const res = NextResponse.json(
      { error: "Provide a patient response before requesting another turn." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  if (shouldMock()) {
    const mockTurn = mockInterviewStep(transcript, patientProfile, chiefComplaint);
    const res = NextResponse.json(mockTurn);
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const ipAddress = getRequestIp(request.headers);
  const userAgent = request.headers.get("user-agent");
  const invitationContext = await resolveInvitationFromCookie();
  if (!invitationContext) {
    status = 401;
    const res = NextResponse.json(
      { error: "Invitation verification is required." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  const turnLimiter = await consumeRateLimit(
    `invite-interview:${invitationContext.invitationId}:${ipAddress}`,
    120,
    900,
  );
  if (!turnLimiter.allowed) {
    status = 429;
    const res = NextResponse.json(
      {
        error: "Too many interview requests. Please wait and try again.",
        retryAfterSeconds: turnLimiter.retryAfterSeconds,
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  // Only for telemetry: record mismatches when a client attempts identity override.
  if (
    clientPatientEmail?.trim() &&
    clientPatientEmail.trim().toLowerCase() !== invitationContext.patientEmail.toLowerCase()
  ) {
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "identity_override_attempt",
      ipAddress,
      userAgent,
      metadata: {
        route: "/api/interview",
      },
    });
  }
  if (clientPhysicianId?.trim() && clientPhysicianId.trim() !== invitationContext.physicianId) {
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "identity_override_attempt",
      ipAddress,
      userAgent,
      metadata: {
        route: "/api/interview",
      },
    });
  }

  // Strict single-use semantics: mark used at first interview turn.
  if (transcript.length === 0) {
    await markInvitationUsed(invitationContext.invitationId);
    await logInvitationAudit({
      invitationId: invitationContext.invitationId,
      eventType: "interview_started",
      ipAddress,
      userAgent,
    });
  }

  // Verify invitation state after session resolution.
  try {
    const invitationCheck = await query(
      `SELECT 1
       FROM patient_invitations
       WHERE id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1`,
      [invitationContext.invitationId],
    );
    if (invitationCheck.rowCount === 0) {
      status = 403;
      const res = NextResponse.json(
        { error: "You weren’t invited to complete this form." },
        { status },
      );
      logRequestMeta("/api/interview", requestId, status, Date.now() - started);
      return res;
    }
  } catch (err) {
    console.error("[interview-route] Invitation check failed", err);
    // If DB fails, return generic error
    status = 500;
    const res = NextResponse.json(
      { error: "Unable to verify invitation. Please try again later." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  // Block external AI calls in HIPAA mode
  if (process.env.HIPAA_MODE === "true") {
    status = 503;
    const res = NextResponse.json(
      {
        error: "Interview generation is disabled in HIPAA mode (external AI blocked).",
        hipaaMode: true,
      },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  let azure;
  try {
    azure = getAzureOpenAIClient();
  } catch (err) {
    status = 500;
    const res = NextResponse.json(
      { error: (err as Error).message || "Azure OpenAI is not configured." },
      { status },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }

  try {
    const prompt = buildPrompt(
      chiefComplaint,
      patientProfile,
      transcript,
      typeof imageSummary === "string" && imageSummary.trim().length > 0
        ? imageSummary.trim()
        : null,
      typeof labReportSummary === "string" && labReportSummary.trim().length > 0
        ? labReportSummary.trim()
        : null,
      typeof previousLabReportSummary === "string" && previousLabReportSummary.trim().length > 0
        ? previousLabReportSummary.trim()
        : null,
      typeof formSummary === "string" && formSummary.trim().length > 0
        ? formSummary.trim()
        : null,
      typeof interviewGuidance === "string" && interviewGuidance.trim().length > 0
        ? interviewGuidance.trim()
        : null,
      typeof medPmhSummary === "string" && medPmhSummary.trim().length > 0
        ? medPmhSummary.trim()
        : null,
      typeof patientBackground === "string" && patientBackground.trim().length > 0
        ? patientBackground.trim()
        : null,
      forceSummary || false,
      languageName,
    );

    const languageInstruction = `LANGUAGE: For all patient-facing questions and messages (the conversation), respond ONLY in ${languageName}. Do NOT include English translations or mixed language unless ${languageName} is English. If you cannot reliably produce ${languageName}, fall back to English. Keep summaries/assessment/plan in English for the clinician. Preserve medical accuracy.`;

    const completion = await azure.client.chat.completions.create({
      model: azure.deployment,
      messages: [
        { role: "system", content: `${systemInstruction}\n\n${languageInstruction}` },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1200,
    });

    const textPayload = completion.choices?.[0]?.message?.content?.trim() || "";

    const turn = enforceAssistiveLanguageOnInterviewTurn(parseInterviewTurn(textPayload));

    const res = NextResponse.json(turn);
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    status = 502;
    console.error("[interview-route] Azure OpenAI error", { requestId });
    
    // Check for quota/rate limit errors
    const errorText = errorMessage.toLowerCase();
    const isQuotaError = errorText.includes("quota") || 
      errorText.includes("rate limit") ||
      errorText.includes("429") ||
      errorText.includes("too many requests");
    
    // Provide more detailed error information in development
    const errorDetails = process.env.NODE_ENV === "development" 
      ? {
          message: errorMessage,
          stack: errorStack,
          transcriptLength: transcript.length,
        }
      : undefined;
    
    const statusCode = isQuotaError ? 429 : 502;
    status = statusCode;
    const userMessage = isQuotaError
      ? "The AI service has reached its daily request limit. Please try again later or contact your physician for assistance."
      : "Unable to continue the interview right now.";
    
    const res = NextResponse.json(
      { 
        error: userMessage,
        message: errorMessage,
        details: errorDetails
      },
      { status: statusCode },
    );
    logRequestMeta("/api/interview", requestId, status, Date.now() - started);
    return res;
  }
}

/**
 * Extract topics/themes from a question to help detect semantic duplicates
 */
function extractTopics(question: string): string[] {
  const qLower = question.toLowerCase();
  const topics: string[] = [];
  
  // Core symptom characteristics
  if (qLower.match(/\b(severity|severe|pain level|scale|0-10|how bad|intensity)\b/)) topics.push("severity");
  if (qLower.match(/\b(location|where|which area|which part|site)\b/)) topics.push("location");
  if (qLower.match(/\b(duration|how long|when did it start|onset|started|began)\b/)) topics.push("duration/onset");
  if (qLower.match(/\b(quality|what does it feel like|describe|type of pain|character)\b/)) topics.push("quality");
  if (qLower.match(/\b(triggers|what makes it worse|worsens|aggravates|provokes)\b/)) topics.push("triggers");
  if (qLower.match(/\b(relieving|what makes it better|improves|helps|relief)\b/)) topics.push("relieving factors");
  if (qLower.match(/\b(associated|other symptoms|also|in addition|accompanied)\b/)) topics.push("associated symptoms");
  if (qLower.match(/\b(nasal|congestion|runny nose|post[- ]?nasal drip|sneez(ing)?|sinus)\b/)) topics.push("upper respiratory symptoms");
  if (qLower.match(/\b(voice|hoarse|hoarseness|dysphonia|difficulty speaking|difficulty swallowing|dysphagia)\b/)) topics.push("voice/swallowing");
  if (qLower.match(/\b(cough|coughing fits|whooping|barking)\b/)) topics.push("cough characteristics");
  if (qLower.match(/\b(shortness of breath|dyspnea|breathless|difficulty breathing|wheez(e|ing)|chest tightness)\b/)) topics.push("respiratory");
  if (qLower.match(/\b(fever|chills|night sweats|sweats|fatigue|weight loss|appetite)\b/)) topics.push("constitutional symptoms");
  if (qLower.match(/\b(travel|recent travel|flight|flew|airport|exposure|sick contact|close contact|covid)\b/)) topics.push("travel/exposures");
  if (qLower.match(/\b(irritant|smoke|allergen|chemical|pollution|cold air|dry air|environment)\b/)) topics.push("environmental exposures");
  if (qLower.match(/\b(lymph node|lump|swollen gland|swelling in neck)\b/)) topics.push("lymph nodes");
  if (qLower.match(/\b(sleep|at night|lying down|when you lie|bedtime)\b/)) topics.push("sleep/positional");
  
  // Physical exam topics
  if (qLower.match(/\b(range of motion|rom|move|bend|straighten|flex|extend)\b/)) topics.push("range of motion");
  if (qLower.match(/\b(tenderness|tender|palpation|press|touch)\b/)) topics.push("tenderness");
  if (qLower.match(/\b(swelling|swollen|edema)\b/)) topics.push("swelling");
  if (qLower.match(/\b(redness|red|inflammation)\b/)) topics.push("redness");
  if (qLower.match(/\b(exudate|discharge|pus|white spots|drainage)\b/)) topics.push("exudate");
  
  // Red flag topics
  if (qLower.match(/\b(blood pressure|bp|hypertension|elevated)\b/)) topics.push("blood pressure");
  if (qLower.match(/\b(chest pain|cardiac|heart)\b/)) topics.push("cardiac symptoms");
  if (qLower.match(/\b(shortness of breath|dyspnea|breathing|respiratory)\b/)) topics.push("respiratory");
  if (qLower.match(/\b(neurological|weakness|numbness|tingling|paralysis)\b/)) topics.push("neurological");
  if (qLower.match(/\b(loss of consciousness|passed out|fainted|unconscious)\b/)) topics.push("loss of consciousness");
  
  // MVA-specific topics
  if (qLower.match(/\b(accident|mva|motor vehicle|car accident|collision)\b/)) topics.push("accident details");
  if (qLower.match(/\b(seatbelt|airbag|ambulance|er|emergency room)\b/)) topics.push("accident response");
  if (qLower.match(/\b(previous injury|prior injury|before|had you ever)\b/)) topics.push("previous injuries");
  
  return topics;
}

/**
 * Extract information from patient answers to identify what has already been provided
 */
function extractInformationFromAnswers(answers: string[]): {
  mentionedTopics: string[];
  symptomDetails: string[];
  redFlagsMentioned: string[];
  informationSummary: string;
} {
  if (answers.length === 0) {
    return {
      mentionedTopics: [],
      symptomDetails: [],
      redFlagsMentioned: [],
      informationSummary: "",
    };
  }

  const allAnswersText = answers.join(" ").toLowerCase();
  const mentionedTopics: string[] = [];
  const symptomDetails: string[] = [];
  const redFlagsMentioned: string[] = [];

  // Extract symptom characteristics mentioned
  if (allAnswersText.match(/\b(severity|severe|pain level|scale|0-10|how bad|intensity|mild|moderate|severe)\b/)) {
    mentionedTopics.push("severity");
    const severityMatch = allAnswersText.match(/\b(\d+\/10|\d+ out of 10|mild|moderate|severe|very severe)\b/i);
    if (severityMatch) {
      symptomDetails.push(`Severity: ${severityMatch[0]}`);
    }
  }
  
  if (allAnswersText.match(/\b(location|where|which area|which part|site|here|there)\b/)) {
    mentionedTopics.push("location");
  }
  
  if (allAnswersText.match(/\b(duration|how long|when did it start|onset|started|began|days|weeks|months|hours)\b/)) {
    mentionedTopics.push("duration/onset");
    const durationMatch = allAnswersText.match(/\b(\d+\s*(day|week|month|hour|minute)s?)\b/i);
    if (durationMatch) {
      symptomDetails.push(`Duration: ${durationMatch[0]}`);
    }
  }
  
  if (allAnswersText.match(/\b(quality|what does it feel like|describe|type of pain|character|sharp|dull|aching|burning|throbbing)\b/)) {
    mentionedTopics.push("quality");
  }
  
  if (allAnswersText.match(/\b(triggers|what makes it worse|worsens|aggravates|provokes|when|during|after)\b/)) {
    mentionedTopics.push("triggers");
  }
  
  if (allAnswersText.match(/\b(relieving|what makes it better|improves|helps|relief|medication|rest|ice|heat)\b/)) {
    mentionedTopics.push("relieving factors");
  }
  
  if (allAnswersText.match(/\b(associated|other symptoms|also|in addition|accompanied|nausea|fever|chills|dizziness)\b/)) {
    mentionedTopics.push("associated symptoms");
  }

  // Extract physical exam findings mentioned
  if (allAnswersText.match(/\b(range of motion|rom|move|bend|straighten|flex|extend|can't move|limited)\b/)) {
    mentionedTopics.push("range of motion");
  }
  
  if (allAnswersText.match(/\b(tenderness|tender|palpation|press|touch|hurts when|painful when)\b/)) {
    mentionedTopics.push("tenderness");
  }
  
  if (allAnswersText.match(/\b(swelling|swollen|edema|puffy|enlarged)\b/)) {
    mentionedTopics.push("swelling");
  }
  
  if (allAnswersText.match(/\b(redness|red|inflammation|inflamed)\b/)) {
    mentionedTopics.push("redness");
  }
  
  if (allAnswersText.match(/\b(exudate|discharge|pus|white spots|drainage|draining)\b/)) {
    mentionedTopics.push("exudate");
  }

  // Extract red flags mentioned
  if (allAnswersText.match(/\b(blood pressure|bp|hypertension|elevated|high blood pressure)\b/)) {
    redFlagsMentioned.push("blood pressure");
  }
  
  if (allAnswersText.match(/\b(chest pain|cardiac|heart|heart attack|angina)\b/)) {
    redFlagsMentioned.push("cardiac symptoms");
  }
  
  if (allAnswersText.match(/\b(shortness of breath|dyspnea|breathing|respiratory|can't breathe|difficulty breathing)\b/)) {
    redFlagsMentioned.push("respiratory");
  }
  
  if (allAnswersText.match(/\b(neurological|weakness|numbness|tingling|paralysis|can't move|loss of sensation)\b/)) {
    redFlagsMentioned.push("neurological");
  }
  
  if (allAnswersText.match(/\b(loss of consciousness|passed out|fainted|unconscious|blacked out)\b/)) {
    redFlagsMentioned.push("loss of consciousness");
  }

  // Extract MVA-specific information
  if (allAnswersText.match(/\b(accident|mva|motor vehicle|car accident|collision|crash)\b/)) {
    mentionedTopics.push("accident details");
  }
  
  if (allAnswersText.match(/\b(seatbelt|airbag|ambulance|er|emergency room|hospital)\b/)) {
    mentionedTopics.push("accident response");
  }
  
  if (allAnswersText.match(/\b(previous injury|prior injury|before|had you ever|in the past)\b/)) {
    mentionedTopics.push("previous injuries");
  }

  // Create summary text
  const informationSummary = [
    ...(mentionedTopics.length > 0 ? [`Topics mentioned: ${[...new Set(mentionedTopics)].join(", ")}`] : []),
    ...(symptomDetails.length > 0 ? symptomDetails : []),
    ...(redFlagsMentioned.length > 0 ? [`Red flags addressed: ${redFlagsMentioned.join(", ")}`] : []),
  ].join("\n");

  return {
    mentionedTopics: [...new Set(mentionedTopics)],
    symptomDetails,
    redFlagsMentioned: [...new Set(redFlagsMentioned)],
    informationSummary,
  };
}

function buildPrompt(
  chiefComplaint: string,
  profile: PatientProfile,
  transcript: InterviewMessage[],
  imageSummary: string | null,
  labReportSummary: string | null,
  previousLabReportSummary: string | null,
  formSummary: string | null,
  interviewGuidance: string | null,
  medPmhSummary: string | null,
  patientBackground: string | null,
  forceSummary: boolean = false,
  languageName: string = "English",
): string {
  // Extract ALL questions from FULL transcript (not truncated) - CRITICAL for duplicate prevention
  const allQuestionsAsked = transcript
    .filter((msg) => msg.role === "assistant")
    .map((msg) => msg.content.trim())
    .filter((content) => content.length > 0);
  
  // Extract all patient answers (from patient messages)
  const patientAnswers = transcript
    .filter((msg) => msg.role === "patient")
    .map((msg) => msg.content.trim())
    .filter((content) => content.length > 0);
  
  // Extract topics covered from all questions
  const topicsCovered = new Set<string>();
  allQuestionsAsked.forEach(q => {
    const topics = extractTopics(q);
    topics.forEach(topic => topicsCovered.add(topic));
  });

  // Extract information from patient answers
  const patientInformation = extractInformationFromAnswers(patientAnswers);

  // If transcript is very long (more than 20 messages), keep only the most recent 20
  // This prevents hitting token limits while keeping the most relevant context
  const maxTranscriptLength = 20;
  const transcriptToUse = transcript.length > maxTranscriptLength
    ? transcript.slice(-maxTranscriptLength)
    : transcript;
  
  const transcriptSection = transcriptToUse.length
    ? formatTranscript(transcriptToUse)
    : "Transcript: (no questions have been asked yet)";

  const imageSection = imageSummary
    ? `Image-based findings (from patient-provided photo): ${imageSummary}\n\nNOTE: A photo has already been uploaded and analyzed. Do NOT ask for another photo.`
    : "Image-based findings: (no photo provided or not yet analyzed)";

  const medPmhSection = medPmhSummary
    ? `\n\nMedication list / PMH (from uploaded photo):\n${medPmhSummary}\n\nCRITICAL: Treat these as patient-reported meds and history. Confirm key items briefly; do NOT re-ask unless clarifying discrepancies.`
    : "";

  // Build lab report section with comparison logic
  let labReportSection = "";
  if (labReportSummary && previousLabReportSummary) {
    // Both reports exist - format for comparison
    labReportSection = `\n\nCurrent Lab Report Summary (from physician-uploaded PDF):\n${labReportSummary}\n\nPrevious Lab Report Summary (from physician-uploaded PDF):\n${previousLabReportSummary}\n\nCRITICAL: Compare the two lab reports and identify:
1. Values that have changed (improved or worsened)
2. Trends (e.g., cholesterol increasing/decreasing over time)
3. New abnormalities that appeared in the current report
4. Abnormalities that resolved between the two reports

Discuss these changes with the patient, ask about interventions or lifestyle changes between the two dates, and provide context about what the changes mean clinically. Proactively discuss abnormal findings and trends. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Make evidence-based lifestyle recommendations based on the trends observed.

If the patient asks about a lab value or test result NOT mentioned in these summaries, you MUST respond: "I don't have that specific result in the lab report summaries provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summaries.`;
  } else if (labReportSummary) {
    // Only current report exists
    labReportSection = `\n\nLab Report Summary (from physician-uploaded PDF):\n${labReportSummary}\n\nCRITICAL: Use this lab report information to guide your questions. Proactively discuss abnormal findings with the patient. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Make evidence-based lifestyle recommendations. If the patient asks about a lab value or test result NOT mentioned in this summary, you MUST respond: "I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summary.`;
  } else if (previousLabReportSummary) {
    // Only previous report exists (edge case)
    labReportSection = `\n\nPrevious Lab Report Summary (from physician-uploaded PDF):\n${previousLabReportSummary}\n\nCRITICAL: Use this previous lab report information to guide your questions. Proactively discuss abnormal findings with the patient. Ask about relevant history, family history, and lifestyle factors (diet, exercise, smoking, alcohol) when appropriate. Make evidence-based lifestyle recommendations. If the patient asks about a lab value or test result NOT mentioned in this summary, you MUST respond: "I don't have that specific result in the lab report summary provided. Your physician will be able to discuss that with you in detail during your visit." Do NOT make up or guess about results not in the summary.`;
  }
  
  logDebug("[buildPrompt] labReportSummary metadata", {
    present: !!labReportSummary,
    length: labReportSummary?.length ?? 0,
  });
  logDebug("[buildPrompt] previousLabReportSummary metadata", {
    present: !!previousLabReportSummary,
    length: previousLabReportSummary?.length ?? 0,
  });
  logDebug("[buildPrompt] labReportSection length", { length: labReportSection.length });

  // Build form section
  const formSection = formSummary
    ? `\n\nForm to Complete (from physician-uploaded PDF):\n${formSummary}\n\nCRITICAL: This form needs to be completed for the patient. During the interview:
1. Understand the form's purpose and context (e.g., school form, work form, MVA insurance form)
2. Ask questions from the form naturally, mixing them with clinical questions based on relevance
3. For MVA forms, ensure you gather all accident details, injuries, and related information
4. For school/work forms, gather relevant medical information needed
5. Collect all information required to complete the form
6. In your final summary, include a section noting the form responses so the physician can complete the form

Do NOT ask form questions in isolation - integrate them naturally with your clinical questioning about the chief complaint.`
    : "";
  
  logDebug("[buildPrompt] formSummary metadata", {
    present: !!formSummary,
    length: formSummary?.length ?? 0,
  });
  logDebug("[buildPrompt] formSection length", { length: formSection.length });

  // Build physician interview guidance section
  const physicianGuidanceSection = interviewGuidance
    ? `\n\n*** PHYSICIAN-SPECIFIC INTERVIEW GUIDANCE (MANDATORY - MUST FOLLOW) ***\n${interviewGuidance}\n\nCRITICAL: The above guidance contains MANDATORY instructions from this physician. You MUST follow these instructions during the interview. These instructions take precedence over general guidelines. For example, if the guidance says "Always ask about X", you MUST ask about X during the interview. Integrate these instructions naturally into your clinical questioning.`
    : "";
  
  logDebug("[buildPrompt] interviewGuidance metadata", {
    present: !!interviewGuidance,
    length: interviewGuidance?.length ?? 0,
  });

  // Add a note if transcript was truncated
  const transcriptNote = transcript.length > maxTranscriptLength
    ? `\nNote: Transcript has been truncated to the most recent ${maxTranscriptLength} messages for context. Total questions asked: ${transcript.length}.`
    : "";

  // Create comprehensive questions list - show all questions but limit display length to prevent token overflow
  // Show last 50 questions in detail, but mention total count
  const maxQuestionsToShow = 50;
  const questionsToShow = allQuestionsAsked.length > maxQuestionsToShow
    ? allQuestionsAsked.slice(-maxQuestionsToShow)
    : allQuestionsAsked;
  
  const questionsList = allQuestionsAsked.length > 0
    ? `\n\nQUESTIONS ALREADY ASKED (DO NOT REPEAT THESE - TOTAL: ${allQuestionsAsked.length}):\n${allQuestionsAsked.length > maxQuestionsToShow ? `[Showing last ${maxQuestionsToShow} of ${allQuestionsAsked.length} questions]\n` : ""}${questionsToShow.map((q, i) => {
        const num = allQuestionsAsked.length > maxQuestionsToShow 
          ? allQuestionsAsked.length - maxQuestionsToShow + i + 1 
          : i + 1;
        return `${num}. ${q}`;
      }).join("\n")}\n\nCRITICAL ANTI-DUPLICATE RULES:\n- Do NOT ask any of these ${allQuestionsAsked.length} questions again, even if rephrased\n- Do NOT ask semantically similar questions (e.g., "What is the severity?" vs "On a scale of 0-10, how severe is it?")\n- Before asking your next question, compare it against ALL ${allQuestionsAsked.length} questions above\n- If your question asks about the same topic as any previous question, choose a DIFFERENT topic\n- Move to a different clinical topic that hasn't been covered yet`
    : "\n\nNo questions have been asked yet. This is your FIRST question. CRITICAL: You MUST rephrase the chief complaint into a natural sentence - DO NOT copy it verbatim from the chief complaint box. For example, if the chief complaint is '3 days of sore throat', rephrase it as 'I understand you've been experiencing a sore throat for the past three days' or 'Tell me about the sore throat that started three days ago' - do NOT just say '3 days of sore throat'.";

  // Create topics covered section
  const topicsList = topicsCovered.size > 0
    ? `\n\nTOPICS ALREADY COVERED (DO NOT ASK ABOUT THESE AGAIN):\n${Array.from(topicsCovered).sort().map(topic => `  - ${topic}`).join("\n")}\n\nCRITICAL: Before asking your next question, verify it is NOT asking about any of these topics. If your question relates to any topic above, choose a DIFFERENT topic that hasn't been covered.`
    : "";

  // Create information already provided by patient section
  const informationAlreadyProvided = patientAnswers.length > 0 && patientInformation.informationSummary
    ? `\n\nINFORMATION ALREADY PROVIDED BY PATIENT:\n${patientInformation.informationSummary}\n\nCRITICAL: The patient has already mentioned the above information in their responses. Do NOT ask questions about these topics again. Review what the patient has said before asking your next question. If the patient mentioned severity, location, duration, triggers, relieving factors, associated symptoms, or any other clinical information, do NOT ask about it again.`
    : "";

  // Determine if we're early in the conversation (first 2-4 questions)
  const isEarlyConversation = allQuestionsAsked.length < 4;
  const isFirstQuestion = allQuestionsAsked.length === 0;
  const openEndedReminder = isEarlyConversation 
    ? `\n\nCRITICAL: ${isFirstQuestion ? "This is your FIRST question as a Physician Assistant. " : "You are early in the clinical interview. "}${isFirstQuestion ? "You MUST rephrase the chief complaint into a natural clinical sentence - DO NOT copy it verbatim. " : ""}Use an OPEN-ENDED question that invites the patient to tell their story (e.g., 'Tell me about your [symptom]' or 'Can you describe what's been happening?'). After gathering the narrative, transition to focused clinical questions that help with differential diagnosis and red flag assessment.`
    : "";

  // Parse multiple chief complaints
  const complaints = chiefComplaint
    .split(/[,\n]| and |; /)
    .map(c => c.trim())
    .filter(c => c.length > 0);
  
  const hasMultipleComplaints = complaints.length > 1;
  const complaintsList = hasMultipleComplaints 
    ? `\n\nCHIEF COMPLAINTS (${complaints.length} total):\n${complaints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nCRITICAL: You must address ALL complaints sequentially. Complete all questions for complaint #1 before moving to complaint #2, and so on. Do NOT summarize until ALL complaints are fully explored.`
    : "";

  // Determine which complaint is currently being addressed based on transcript
  let currentComplaintIndex = 0;
  const completedComplaints: number[] = [];
  
  if (hasMultipleComplaints && transcript.length > 0) {
    // Analyze transcript to see which complaints have been covered
    const transcriptText = transcript.map(m => m.content).join(" ").toLowerCase();
    const coveredComplaints = complaints.map((complaint, idx) => {
      const complaintKeywords = complaint.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const coverage = complaintKeywords.filter(kw => transcriptText.includes(kw)).length;
      const ratio = complaintKeywords.length > 0 ? coverage / complaintKeywords.length : 0;
      
      // Check if enough questions have been asked (at least 8 questions mentioning this complaint)
      const questionsAboutComplaint = allQuestionsAsked.filter(q => {
        const qLower = q.toLowerCase();
        return complaintKeywords.some(kw => qLower.includes(kw));
      }).length;
      
      // A complaint is considered complete if:
      // 1. At least 50% of keywords mentioned AND
      // 2. At least 8 questions asked about it AND
      // 3. Red flags likely assessed (we check for red flag keywords in transcript)
      const redFlagKeywords = ['chest pain', 'shortness of breath', 'dyspnea', 'neurological', 'weakness', 'numbness', 'severe', 'uncontrolled', 'bleeding', 'trauma', 'loss of consciousness', 'stroke', 'sepsis', 'mva', 'motor vehicle', 'car accident', 'airbag', 'seatbelt', 'ambulance', 'emergency room', 'er', 'work', 'work-related', 'work injury', 'previous injury', 'prior injury', 'previous injuries'];
      const hasRedFlagAssessment = idx === 0 || redFlagKeywords.some(flag => transcriptText.includes(flag));
      
      const isComplete = ratio >= 0.5 && questionsAboutComplaint >= 8 && hasRedFlagAssessment;
      
      return { idx, coverage, ratio, questionsAboutComplaint, isComplete };
    });
    
    // Find completed complaints
    coveredComplaints.forEach(c => {
      if (c.isComplete && c.idx < complaints.length - 1) {
        completedComplaints.push(c.idx);
      }
    });
    
    // Find the last complaint that has been thoroughly covered (>= 50% keywords mentioned)
    const thoroughlyCovered = coveredComplaints.filter(c => c.ratio >= 0.5);
    if (thoroughlyCovered.length > 0) {
      // If the current complaint is complete, move to next
      const lastThoroughlyCovered = thoroughlyCovered[thoroughlyCovered.length - 1];
      if (lastThoroughlyCovered.isComplete && lastThoroughlyCovered.idx < complaints.length - 1) {
        currentComplaintIndex = lastThoroughlyCovered.idx + 1;
      } else {
        currentComplaintIndex = lastThoroughlyCovered.idx;
      }
    }
  }

  // Build complaint context sections
  const currentComplaint = complaints[currentComplaintIndex];
  const remainingComplaints = hasMultipleComplaints 
    ? complaints.slice(currentComplaintIndex + 1)
    : [];
  const completedComplaintsList = hasMultipleComplaints && completedComplaints.length > 0
    ? completedComplaints.map(idx => complaints[idx])
    : [];

  const languageSection = languageName
    ? `\n\nLANGUAGE PREFERENCE: Conduct all patient-facing questions and messages in ${languageName}. If you cannot reliably produce ${languageName}, fall back to English. Do NOT mix languages.`
    : "";

  // Build red flag checklist based on complaint type
  const getRedFlagChecklist = (complaint: string): string[] => {
    const complaintLower = complaint.toLowerCase();
    const flags: string[] = [];
    
    // MVA/Trauma-specific red flags
    if (complaintLower.includes('mva') || complaintLower.includes('motor vehicle') || 
        complaintLower.includes('car accident') || complaintLower.includes('mvc') ||
        complaintLower.includes('collision') || (complaintLower.includes('trauma') && complaintLower.includes('vehicle'))) {
      flags.push('Loss of consciousness at scene', 'Amnesia of the accident', 'High-speed collision', 
                 'Major vehicle damage', 'Airbag deployment', 'Ejection from vehicle', 
                 'Neurological deficits', 'Spinal cord injury signs', 'Internal bleeding signs',
                 'Chest trauma', 'Abdominal trauma', 'Head injury');
    }
    
    if (complaintLower.includes('chest') || complaintLower.includes('heart')) {
      flags.push('Cardiac risk factors', 'Radiation to arm/jaw', 'Associated with exertion', 'Shortness of breath');
    }
    if (complaintLower.includes('breath') || complaintLower.includes('dyspnea') || complaintLower.includes('respiratory')) {
      flags.push('Severe dyspnea', 'Inability to speak in full sentences', 'Cyanosis', 'Respiratory distress');
    }
    if (complaintLower.includes('abdominal') || complaintLower.includes('stomach') || complaintLower.includes('belly')) {
      flags.push('Severe abdominal pain', 'Peritoneal signs', 'Signs of sepsis', 'Uncontrolled bleeding');
    }
    if (complaintLower.includes('head') || complaintLower.includes('headache')) {
      flags.push('Neurological deficits', 'Vision changes', 'Severe headache', 'Signs of stroke');
    }
    if (complaintLower.includes('pain') || complaintLower.includes('ache')) {
      flags.push('Severe pain', 'Uncontrolled pain', 'Signs of trauma');
    }
    // General red flags for all complaints
    flags.push('Loss of consciousness', 'Severe mental status changes', 'Uncontrolled bleeding', 'Signs of sepsis');
    
    return [...new Set(flags)]; // Remove duplicates
  };

  const redFlagChecklist = getRedFlagChecklist(currentComplaint);
  const redFlagSection = `\n\nRED FLAG ASSESSMENT CHECKLIST for "${currentComplaint}":\nBefore moving to the next complaint or summarizing, ensure you have assessed:\n${redFlagChecklist.map((flag, i) => `  ${i + 1}. ${flag}`).join('\n')}\n\nCRITICAL: If you have NOT asked about these red flags yet, you MUST ask about them before moving on.\nCRITICAL: Bundle related red flags into ONE question (enumerate them) instead of separate questions. Example: “Have you had any of the following: uncontrolled bleeding from mouth/nose; rash, joint pain, or swelling; changes in your voice or hoarseness; difficulty opening your mouth?”`;

  const doNotAskAboutSection = hasMultipleComplaints && remainingComplaints.length > 0
    ? `\n\n🚫 DO NOT ASK ABOUT (FORBIDDEN UNTIL CURRENT COMPLAINT IS COMPLETE):\n${remainingComplaints.map((c, i) => `  - Complaint #${currentComplaintIndex + 2 + i}: "${c}"`).join('\n')}\n\nCRITICAL: You are FORBIDDEN from asking questions about these complaints until you have completed ALL questions and red flag assessment for "${currentComplaint}". Before asking each question, verify it relates ONLY to "${currentComplaint}". If your question relates to any of the forbidden complaints above, you MUST wait.`
    : "";

  const completedComplaintsSection = hasMultipleComplaints && completedComplaintsList.length > 0
    ? `\n\n✅ COMPLETED COMPLAINTS:\n${completedComplaintsList.map((c, i) => `  - ${c}`).join('\n')}\n\nThese complaints have been fully explored. Do NOT ask about them again unless clarifying information is needed.`
    : "";

  const currentComplaintNote = hasMultipleComplaints && currentComplaintIndex < complaints.length
    ? `\n\n🎯 CURRENT FOCUS (CRITICAL - READ CAREFULLY):\nYou are currently addressing complaint #${currentComplaintIndex + 1}: "${currentComplaint}"\n\nCOMPLETION CRITERIA for this complaint:\n  1. All core symptom characteristics gathered (onset, duration, severity, quality, location, triggers, relieving factors)\n  2. ALL relevant red flags assessed (see checklist below)\n  3. All associated symptoms identified\n  4. Virtual physical exam completed if applicable\n  5. 12-25 focused questions asked\n\n${currentComplaintIndex < complaints.length - 1 ? `ONLY AFTER completing this complaint, you may move to complaint #${currentComplaintIndex + 2}: "${complaints[currentComplaintIndex + 1]}" without announcing the transition.` : "This is the last complaint. After completing it, provide a summary combining ALL complaints."}\n\nCRITICAL: Do NOT mention, ask about, or reference other complaints until this complaint is complete.`
    : `\n\n🎯 CURRENT FOCUS:\nYou are addressing: "${currentComplaint}"\n\nCOMPLETION CRITERIA:\n  1. All core symptom characteristics gathered\n  2. ALL relevant red flags assessed (see checklist below)\n  3. All associated symptoms identified\n  4. Virtual physical exam completed if applicable\n  5. 12-25 focused questions asked`;

  const fullPrompt = `
Chief complaint(s): ${chiefComplaint}
${complaintsList}
${completedComplaintsSection}
${currentComplaintNote}
${redFlagSection}
${doNotAskAboutSection}

Patient sex: ${profile.sex}
Patient age: ${profile.age}
Pertinent past medical history: ${profile.pmh}
Family history: ${profile.familyHistory}
Current medications (include OTC/supplements): ${profile.currentMedications}
Family doctor: ${profile.familyDoctor}
Documented drug allergies: ${profile.allergies}
${patientBackground ? `\nPhysician-provided background: ${patientBackground}` : ""}
${imageSection}${labReportSection}${formSection}${medPmhSection}
${transcriptSection}${transcriptNote}${questionsList}${topicsList}${informationAlreadyProvided}${openEndedReminder}

CLINICAL INTERVIEW GUIDANCE (You are operating as a Physician Assistant):
${physicianGuidanceSection}
- DO NOT repeat the chief complaint verbatim. Rephrase it naturally into a clinical sentence when asking your first question.
- Bundle related red flags or associated symptoms into ONE question (enumerate items) rather than separate questions. Use yes/no or “which apply.” Example: “Have you had any of the following: uncontrolled bleeding from mouth/nose; rash, joint pain, or swelling; changes in your voice/hoarseness; difficulty opening your mouth?”
- If the complaint is visible (rash, lesion, wound, swelling, bruising, deformity, skin changes), proactively offer the patient the option to upload/share a photo unless one is already provided (imageSummary present).
- TOTAL QUESTIONS ALREADY ASKED: ${allQuestionsAsked.length}. ABSOLUTE MAX: 15 questions total (or 12–15 per complaint). If you have reached 15 questions already, or you have enough information, STOP asking questions and provide the summary now.
- Be focused and efficient. Review the transcript carefully to avoid repetition. Ask only the most diagnostically important questions that contribute to your clinical assessment.
- Think clinically: Each question should help you rule in/out differential diagnoses, assess red flags, or gather information needed for treatment planning.
- ${hasMultipleComplaints ? `Aim for 8-20 targeted clinical questions PER complaint. Complete ALL complaints before summarizing.` : "Aim for 8-20 targeted clinical questions total."}
- Before asking each question, verify it relates ONLY to the CURRENT complaint. If multiple complaints exist, you are FORBIDDEN from asking about other complaints until the current one is complete.

MANDATORY PRE-QUESTION VALIDATION (CRITICAL - MUST DO BEFORE EVERY QUESTION):
1. Read the "QUESTIONS ALREADY ASKED" list above (${allQuestionsAsked.length} questions total)
2. Read the "TOPICS ALREADY COVERED" list above
3. Formulate your intended question
4. Compare your intended question against ALL ${allQuestionsAsked.length} previous questions
5. Check if your question asks about any topic in the "TOPICS ALREADY COVERED" list
6. If your question is semantically similar to ANY previous question OR relates to a covered topic:
   - STOP immediately
   - Choose a DIFFERENT clinical topic that hasn't been covered
   - Formulate a NEW question about that different topic
7. Only proceed with your question if it's about a NEW topic that hasn't been covered

- Remember: Your goal is to gather enough information to form a clinical assessment (with differential diagnoses) and create an appropriate treatment plan.

${forceSummary ? `CRITICAL: The patient has requested to end the interview. You MUST provide a summary now based on all the information gathered so far. Generate a comprehensive one-paragraph summary (max 1500 characters) that combines ALL complaints into a natural clinical narrative (e.g., "30 year old female with 3 days of vaginal discharge and 5 days of sore throat. The vaginal discharge is associated with itchiness..."). Your ASSESSMENT must include differential diagnoses, and your PLAN must be a clinically appropriate treatment plan.` : `CRITICAL SUMMARY CONDITIONS - As a Physician Assistant, only summarize when you have:
- ${hasMultipleComplaints ? "Fully explored ALL chief complaints (meaning ALL questions asked for ALL complaints)" : "Fully explored this complaint (meaning all questions asked)"}
- Assessed ALL critical red flags relevant to ${hasMultipleComplaints ? "ALL complaints" : "this complaint"} and ruled them out or confirmed them
- Gathered core symptom characteristics ${hasMultipleComplaints ? "for ALL complaints" : ""} (onset, duration, severity, quality, location, triggers, relieving factors)
- Identified key associated symptoms ${hasMultipleComplaints ? "for ALL complaints" : ""}
- Completed relevant virtual physical exam maneuvers if applicable (especially for MSK cases)
- Have enough information to form a clinical assessment with differential diagnoses ${hasMultipleComplaints ? "for ALL complaints" : ""}
- Have enough information to create an appropriate treatment plan ${hasMultipleComplaints ? "for ALL complaints" : ""}
- ${hasMultipleComplaints ? "Explicit confirmation: You have asked comprehensive clinical questions for ALL complaints AND assessed red flags for ALL complaints AND can form differential diagnoses and treatment plans" : "Explicit confirmation: You have asked comprehensive clinical questions and assessed all red flags and can form differential diagnoses and treatment plan"}`}

If you still need more critical clinical information${forceSummary ? "" : " and the patient hasn't requested to end"}${forceSummary ? "" : ", respond with a JSON object shaped like {\"type\":\"question\",\"question\":\"...\",\"rationale\":\"...\"}"}. The rationale should explain the clinical purpose of your question (e.g., "To assess for cardiac risk factors" or "To distinguish between viral and bacterial pharyngitis").
If you have sufficient information for a clinical assessment with differential diagnoses and can formulate a treatment plan${forceSummary ? " or the patient has requested to end" : ` (typically after ${hasMultipleComplaints ? "8-20 focused clinical questions per complaint AND red flag assessment for each complaint" : "8-20 focused clinical questions AND red flag assessment"})`}, respond with {"type":"summary","positives":[],"negatives":[],"summary":"","investigations":[],"assessment":"","plan":[]}. Remember: Your assessment must include differential diagnoses, and your plan must be a clinically appropriate, specific treatment plan.

CRITICAL: You MUST respond with valid JSON only. Do not include any text before or after the JSON object. Ensure all strings are properly escaped and all JSON syntax is correct.
${languageSection}
  `.trim();
  
  // Log prompt length for debugging
  if (process.env.NODE_ENV === "development") {
    console.log("[interview-route] Full prompt length:", fullPrompt.length);
  }
  
  return fullPrompt;
}

function formatTranscript(transcript: InterviewMessage[]) {
  return (
    "Transcript:\n" +
    transcript
      .map((message) => {
        const speaker = message.role === "assistant" ? "Assistant" : "Patient";
        return `${speaker}: ${message.content}`;
      })
      .join("\n")
  );
}

function enforceAssistiveLanguageOnInterviewTurn(turn: unknown) {
  if (!turn || typeof turn !== "object") return turn;
  const candidate = turn as Record<string, unknown>;
  if (candidate.type === "question") {
    const next = { ...candidate };
    if (typeof next.question === "string") {
      next.question = sanitizeAssistiveClinicalText(next.question).text;
    }
    if (typeof next.rationale === "string") {
      next.rationale = sanitizeAssistiveClinicalText(next.rationale).text;
    }
    return next;
  }
  if (candidate.type === "summary") {
    const next = { ...candidate };
    if (typeof next.summary === "string") {
      next.summary = sanitizeAssistiveClinicalText(next.summary).text;
    }
    if (typeof next.assessment === "string") {
      next.assessment = sanitizeAssistiveClinicalText(next.assessment).text;
    }
    if (Array.isArray(next.plan)) {
      next.plan = next.plan.map((item) =>
        typeof item === "string" ? sanitizeAssistiveClinicalText(item).text : item,
      );
    }
    if (Array.isArray(next.investigations)) {
      next.investigations = next.investigations.map((item) =>
        typeof item === "string" ? sanitizeAssistiveClinicalText(item).text : item,
      );
    }
    return next;
  }
  return turn;
}

function parseInterviewTurn(payload: string) {
  // Try to extract JSON from markdown code blocks if present
  let jsonText = payload.trim();
  const jsonMatch = payload.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  // Try to find JSON object in the text if it's not already extracted
  if (!jsonText.startsWith("{")) {
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      jsonText = jsonObjectMatch[0];
    }
  }

  // Clean up common JSON issues
  jsonText = jsonText
    // Remove trailing commas before closing braces/brackets
    .replace(/,(\s*[}\]])/g, '$1')
    // Remove comments (single line)
    .replace(/\/\/.*$/gm, '')
    // Remove comments (multi-line)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove any control characters except newlines and tabs (which might be in strings)
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseError) {
    console.error("[interview-route] JSON parse error");
    logDebug("[interview-route] JSON parse error details", {
      errorMessage: parseError instanceof Error ? parseError.message : String(parseError),
      payloadKeys: payload ? Object.keys(payload) : [],
      jsonTextLength: jsonText.length,
    });
    
    // Try to fix common JSON issues and retry
    try {
      // Try removing any text before the first {
      const firstBrace = jsonText.indexOf('{');
      if (firstBrace > 0) {
        jsonText = jsonText.substring(firstBrace);
      }
      
      // Try removing any text after the last }
      const lastBrace = jsonText.lastIndexOf('}');
      if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
        jsonText = jsonText.substring(0, lastBrace + 1);
      }
      
      // Additional cleanup attempts - be conservative
      // Remove any remaining trailing commas
      jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
      
      // Try to fix unescaped newlines and quotes in strings by finding string boundaries
      let result = '';
      let inString = false;
      let escapeNext = false;
      
      for (let i = 0; i < jsonText.length; i++) {
        const char = jsonText[i];
        
        if (escapeNext) {
          result += char;
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          result += char;
          escapeNext = true;
          continue;
        }
        
        if (char === '"') {
          inString = !inString;
          result += char;
          continue;
        }
        
        if (inString) {
          // Inside a string - handle special characters
          if (char === '\n' || char === '\r') {
            // Replace newlines in strings with space
            result += ' ';
            continue;
          }
        }
        
        result += char;
      }
      
      jsonText = result;
      
      // Fix missing commas between properties
      // Look for patterns like: "key":"value""key2" or }"key"
      jsonText = jsonText.replace(/(")\s*:\s*("[^"]*")\s*("[^"]*"\s*:)/g, '$1$2,$3');
      // Fix missing commas after closing braces/brackets before property names
      jsonText = jsonText.replace(/([\]}])\s*(")/g, '$1,$2');
      
      // Fix double quotes that might have been created
      jsonText = jsonText.replace(/""/g, '"');
      
      // Remove any duplicate commas
      jsonText = jsonText.replace(/,\s*,/g, ',');
      
      parsed = JSON.parse(jsonText);
      logDebug("[interview-route] Successfully parsed after cleanup");
    } catch (retryError) {
      // Log the problematic JSON for debugging
      console.error("[interview-route] Failed to parse even after cleanup.");
      logDebug("[interview-route] Cleanup parse error details", {
        errorMessage: retryError instanceof Error ? retryError.message : String(retryError),
        jsonTextLength: jsonText.length,
      });
      
      // Try one more time with a more aggressive approach - extract just the JSON structure
      try {
        // Find the first complete JSON object
        let braceCount = 0;
        let startIdx = -1;
        let endIdx = -1;
        
        for (let i = 0; i < jsonText.length; i++) {
          if (jsonText[i] === '{') {
            if (startIdx === -1) startIdx = i;
            braceCount++;
          } else if (jsonText[i] === '}') {
            braceCount--;
            if (braceCount === 0 && startIdx !== -1) {
              endIdx = i;
              break;
            }
          }
        }
        
        if (startIdx !== -1 && endIdx !== -1) {
          let extractedJson = jsonText.substring(startIdx, endIdx + 1);
          
          // Apply one more round of fixes to the extracted JSON
          extractedJson = extractedJson
            .replace(/,(\s*[\]}])/g, '$1') // Remove trailing commas
            .replace(/([\]}])\s*(")/g, '$1,$2') // Add missing commas
            .replace(/,\s*,/g, ','); // Remove duplicate commas
          
          parsed = JSON.parse(extractedJson);
          console.log("[interview-route] Successfully parsed after extracting JSON object");
        } else {
          throw retryError;
        }
      } catch (finalError) {
        // Log the exact position where the error occurred for debugging
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        const positionMatch = errorMsg.match(/position (\d+)/);
        if (positionMatch) {
          const pos = parseInt(positionMatch[1]);
          console.error("[interview-route] Error at position:", pos);
          logDebug("[interview-route] Context around error metadata", {
            jsonTextLength: jsonText.length,
          });
        }
        throw new Error(`Azure OpenAI returned invalid JSON: ${errorMsg}. Please try again.`);
      }
    }
  }

  const result = interviewResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.error("[interview-route] Schema validation error");
    logDebug("[interview-route] Schema validation error details", {
      issues: result.error.issues?.length ?? "unknown",
    });
    
    // Try to fix common issues - truncate fields that are too long
    if (typeof parsed === "object" && parsed !== null) {
      const fixed: any = { ...parsed };
      
      // Truncate question if too long
      if (fixed.type === "question" && typeof fixed.question === "string" && fixed.question.length > 240) {
        logDebug("[interview-route] Truncating long question", { length: fixed.question.length });
        fixed.question = fixed.question.substring(0, 237) + "...";
      }
      
      // Truncate rationale if too long
      if (fixed.type === "question" && typeof fixed.rationale === "string" && fixed.rationale.length > 280) {
        logDebug("[interview-route] Truncating long rationale", { length: fixed.rationale.length });
        fixed.rationale = fixed.rationale.substring(0, 277) + "...";
      }
      
      // Truncate summary fields if too long
      if (fixed.type === "summary") {
        const maxLengths: Record<string, number> = {
          summary: 1500,
          assessment: 1500,
        };
        
        for (const [field, maxLen] of Object.entries(maxLengths)) {
          if (typeof fixed[field] === "string" && fixed[field].length > maxLen) {
            logDebug("[interview-route] Truncating long summary field", { field, length: fixed[field].length, maxLen });
            fixed[field] = fixed[field].substring(0, maxLen - 3) + "...";
          }
        }
        
        // Truncate arrays that are too long
        const arrayMaxLengths: Record<string, number> = {
          positives: 6,
          negatives: 6,
          physicalFindings: 6,
          investigations: 6,
          plan: 6,
        };
        
        for (const [field, maxLen] of Object.entries(arrayMaxLengths)) {
          if (Array.isArray(fixed[field]) && fixed[field].length > maxLen) {
            logDebug("[interview-route] Truncating long array field", { field, length: fixed[field].length, maxLen });
            fixed[field] = fixed[field].slice(0, maxLen);
          }
        }
      }
      
      // Try parsing again with fixed data
      const retryResult = interviewResponseSchema.safeParse(fixed);
      if (retryResult.success) {
        console.log("[interview-route] Successfully fixed validation errors by truncating long fields");
        return retryResult.data;
      }
    }
    
    throw new Error(`Azure OpenAI returned data that does not match the schema: ${result.error.issues.map(i => i.message).join(", ")}`);
  }

  return result.data;
}
