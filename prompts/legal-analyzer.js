const { SchemaType } = require("@google/generative-ai");

// Supported platform specializations — used both to constrain Gemini output
// and to query matching lawyers in MongoDB.
const SUPPORTED_CATEGORIES = [
  "Criminal Law",
  "Corporate Law",
  "Family Law",
  "Property Law",
  "Civil Law",
  "Consumer Law",
  "Labor Law",
];

const SYSTEM_PROMPT = `You are LegalEase's Legal Issue Analyzer, an expert legal triage assistant.
Your job is to help a non-expert describe their legal situation and point them to the right area of law.

YOU ARE NOT A LAWYER AND MUST NEVER GIVE BINDING LEGAL ADVICE.
Always keep advice general and informational.

Follow these rules strictly:
1. Classify the user's issue into EXACTLY ONE category from this allowed list:
   ${SUPPORTED_CATEGORIES.join(", ")}.
   If none fit, use "Consumer Law".
2. summary: A concise 2-3 sentence plain-language recap of the user's situation.
3. urgency: One of "low", "medium", or "high".
   - high = deadlines, court dates, eviction, criminal charges, threats, losing money daily
   - medium = ongoing dispute, no immediate legal deadline
   - low = general question, planning, or curiosity
4. nextSteps: Exactly 3 short, actionable, general first steps the user can take.
   Never invent specific statutes, dollar amounts, or deadlines.
5. matchedSpecialization: The single category string you chose, used to find a lawyer.
6. disclaimer: Always the fixed string: "AI-generated guidance is for information only and is not legal advice."

Respond ONLY with valid JSON. No markdown, no code fences, no extra text.`;

function buildUserPrompt(issueText) {
  return `Analyze the following legal issue described by a user. Distill it into the structured JSON specified.

USER'S ISSUE DESCRIPTION:
"""
${issueText}
"""`;
}

// Gemini structured-output schema. Mirrors the fields above so the model
// returns strict, machine-parseable JSON every time.
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    category: {
      type: SchemaType.STRING,
      description: "One of: " + SUPPORTED_CATEGORIES.join(", "),
      nullable: false,
    },
    summary: {
      type: SchemaType.STRING,
      description: "Concise 2-3 sentence plain-language recap of the issue.",
      nullable: false,
    },
    urgency: {
      type: SchemaType.STRING,
      description: "One of: low, medium, high",
      nullable: false,
    },
    nextSteps: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Exactly three short actionable general first steps.",
      nullable: false,
    },
    matchedSpecialization: {
      type: SchemaType.STRING,
      description: "The matched category string used to find a lawyer.",
      nullable: false,
    },
    disclaimer: {
      type: SchemaType.STRING,
      description: "Fixed informational disclaimer string.",
      nullable: false,
    },
  },
  required: [
    "category",
    "summary",
    "urgency",
    "nextSteps",
    "matchedSpecialization",
    "disclaimer",
  ],
};

module.exports = {
  SUPPORTED_CATEGORIES,
  SYSTEM_PROMPT,
  buildUserPrompt,
  RESPONSE_SCHEMA,
};