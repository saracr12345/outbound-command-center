import {
  createStructuredResponse,
  type OpenAIWebSource,
} from "@/lib/openai/responses";

export const TARGET_ANALYSIS_PROMPT_VERSION = "t3-target-v2-web-research";
export const OUTREACH_PROMPT_VERSION = "t3-outreach-v1";

export type TargetContext = {
  personName: string | null;
  jobTitle: string | null;
  emailAvailable: boolean;
  linkedInAvailable: boolean;
  personLinkedInUrl: string | null;
  location: string | null;
  companyName: string;
  companyDomain: string | null;
  companyWebsite: string | null;
  companyLinkedInUrl: string | null;
  industry: string | null;
  employeeCount: number | null;
  employeeCountRaw: string | null;
  estimatedRevenue: string | null;
  pageUrl: string | null;
  pageTitle: string | null;
  pageViews: number | null;
  repeatVisit: boolean;
  visitCount: number;
  recentPages: string[];
};

type Criterion = {
  score: number;
  evidence: string;
};

export type TargetResearch = {
  identity_match: boolean;
  confidence: "high" | "medium" | "low";
  current_job_title: string | null;
  current_company: string | null;
  seniority: string | null;
  location: string | null;
  profile_summary: string | null;
  evidence_notes: string[];
};

export type TargetAnalysisResult = {
  score: number;
  classification: "strong_target" | "review" | "low_priority";
  summary: string;
  research: TargetResearch;
  researchSources: OpenAIWebSource[];
  criteria: {
    role_fit: Criterion;
    company_fit: Criterion;
    intent_fit: Criterion;
    seniority_fit: Criterion;
    engagement_fit: Criterion;
    contactability: Criterion;
  };
  positive_signals: string[];
  concerns: string[];
  missing_information: string[];
  recommended_angle: string;
  model: string;
  promptVersion: string;
};

export type OutreachResult = {
  email_subject: string;
  email_body: string;
  linkedin_connection_note: string;
  linkedin_followup: string;
  model: string;
  promptVersion: string;
};

const targetAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    research: {
      type: "object",
      additionalProperties: false,
      properties: {
        identity_match: { type: "boolean" },
        confidence: {
          type: "string",
          enum: ["high", "medium", "low"],
        },
        current_job_title: { type: ["string", "null"] },
        current_company: { type: ["string", "null"] },
        seniority: { type: ["string", "null"] },
        location: { type: ["string", "null"] },
        profile_summary: { type: ["string", "null"] },
        evidence_notes: {
          type: "array",
          items: { type: "string" },
          maxItems: 8,
        },
      },
      required: [
        "identity_match",
        "confidence",
        "current_job_title",
        "current_company",
        "seniority",
        "location",
        "profile_summary",
        "evidence_notes",
      ],
    },
    summary: { type: "string" },
    role_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 25 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    company_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 20 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    intent_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 25 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    seniority_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 15 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    engagement_fit: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 10 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    contactability: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "integer", minimum: 0, maximum: 5 },
        evidence: { type: "string" },
      },
      required: ["score", "evidence"],
    },
    positive_signals: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    concerns: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    missing_information: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    recommended_angle: { type: "string" },
  },
  required: [
    "research",
    "summary",
    "role_fit",
    "company_fit",
    "intent_fit",
    "seniority_fit",
    "engagement_fit",
    "contactability",
    "positive_signals",
    "concerns",
    "missing_information",
    "recommended_angle",
  ],
} as const;

const outreachSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    email_subject: { type: "string" },
    email_body: { type: "string" },
    linkedin_connection_note: { type: "string" },
    linkedin_followup: { type: "string" },
  },
  required: [
    "email_subject",
    "email_body",
    "linkedin_connection_note",
    "linkedin_followup",
  ],
} as const;

function parseJson<T>(value: string, label: string): T {
  if (!value.trim()) {
    throw new Error(`${label} returned no text.`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} returned invalid structured JSON.`);
  }
}

function classificationFor(score: number): TargetAnalysisResult["classification"] {
  if (score >= 80) return "strong_target";
  if (score >= 60) return "review";
  return "low_priority";
}

export async function analyseTarget(
  context: TargetContext,
): Promise<TargetAnalysisResult> {
  const response = await createStructuredResponse({
    webSearch: true,
    searchContextSize: "medium",
    instructions: `
You are the targeting analyst for a B2B AI governance and AI assurance consultancy.
Your job has TWO stages: professional web research, then target scoring.

STAGE 1 — PROFESSIONAL WEB RESEARCH
Use web search before scoring.
- If personLinkedInUrl is supplied, start with that exact LinkedIn profile URL and the person's name/company.
- Attempt to use publicly accessible LinkedIn information when available.
- LinkedIn may block direct access. If that happens, use publicly indexed search results plus corroborating professional sources such as company team pages, conference speaker pages, professional biographies, regulatory/company filings, or other credible public business pages.
- Confirm you have the correct person before using researched facts. Prefer at least two matching professional signals where possible, such as name + company, name + title, company + profile URL, or a matching professional biography.
- Research ONLY professional information useful for B2B targeting: current job title, current company, seniority, professional location, and a short role/company summary.
- Do not collect or infer sensitive personal information, private contact details, family information, political views, health information, ethnicity, religion, or other irrelevant personal data.
- If the identity match is uncertain, set identity_match=false or confidence=low and do not use uncertain research to increase the score.
- Never fabricate a role or company simply because the supplied dashboard data is incomplete.

STAGE 2 — TARGET SCORING
Evaluate whether this website visitor is a sensible outbound prospect using the supplied RB2B evidence PLUS professional facts verified in Stage 1.

Scoring rubric (100 total):
- role_fit: 0-25. Reward roles connected to technology, AI, data, risk, compliance, governance, operations, transformation, security, procurement, model risk, innovation, or senior business ownership.
- company_fit: 0-20. Reward plausible enterprise/B2B fit, regulated or technology-intensive sectors, and useful company scale when evidence exists.
- intent_fit: 0-25. Reward visits to pages related to AI governance, assurance, testing, red teaming, EU AI Act, ISO 42001, model risk, AI security, or adjacent services. Intent must come from the supplied website evidence; do not invent browsing intent from web research.
- seniority_fit: 0-15. Use a verified current title/seniority from research when the dashboard title is missing or stale.
- engagement_fit: 0-10. Reward repeat visits, multiple recorded visits, or multiple relevant pages. Engagement must come from the supplied website evidence only.
- contactability: 0-5. Reward an available LinkedIn profile and/or usable business email address.

Classification thresholds:
- 80-100: strong_target
- 60-79: review
- 0-59: low_priority

Important rules:
- Missing information is unknown, not automatically negative evidence.
- A researched title/company can fill a missing dashboard field only when identity_match=true and confidence is high or medium.
- Do not assume budgets, AI deployments, procurement plans, regulation status, internal projects, or buying intent unless clearly supported.
- Explain the evidence for each sub-score in one concise sentence.
- Keep the summary commercially useful.
- The recommended angle should suggest a relevant business conversation, not claim that we tracked the person's browsing.
`,
    input: JSON.stringify(context, null, 2),
    schemaName: "target_analysis_with_web_research",
    schema: targetAnalysisSchema as unknown as Record<string, unknown>,
  });

  const parsed = parseJson<{
    research: TargetResearch;
    summary: string;
    role_fit: Criterion;
    company_fit: Criterion;
    intent_fit: Criterion;
    seniority_fit: Criterion;
    engagement_fit: Criterion;
    contactability: Criterion;
    positive_signals: string[];
    concerns: string[];
    missing_information: string[];
    recommended_angle: string;
  }>(response.text, "Target analysis");

  const score =
    parsed.role_fit.score +
    parsed.company_fit.score +
    parsed.intent_fit.score +
    parsed.seniority_fit.score +
    parsed.engagement_fit.score +
    parsed.contactability.score;

  return {
    score,
    classification: classificationFor(score),
    summary: parsed.summary,
    research: parsed.research,
    researchSources: response.sources,
    criteria: {
      role_fit: parsed.role_fit,
      company_fit: parsed.company_fit,
      intent_fit: parsed.intent_fit,
      seniority_fit: parsed.seniority_fit,
      engagement_fit: parsed.engagement_fit,
      contactability: parsed.contactability,
    },
    positive_signals: parsed.positive_signals,
    concerns: parsed.concerns,
    missing_information: parsed.missing_information,
    recommended_angle: parsed.recommended_angle,
    model: response.model,
    promptVersion: TARGET_ANALYSIS_PROMPT_VERSION,
  };
}

export async function generateOutreach(params: {
  context: TargetContext;
  analysis: Pick<
    TargetAnalysisResult,
    | "score"
    | "classification"
    | "summary"
    | "positive_signals"
    | "concerns"
    | "recommended_angle"
  >;
}): Promise<OutreachResult> {
  const response = await createStructuredResponse({
    instructions: `
You write concise B2B outbound messages for an AI governance and AI assurance consultancy.
Create one email and one LinkedIn outreach path for the supplied prospect.

Rules:
- Use ONLY supplied facts. Never invent personal achievements, company initiatives, budgets, tools, regulations, or projects.
- Never say or imply that we tracked the person's website visit. Do not write phrases such as "I saw you visited our site", "noticed you were on our website", or similar.
- You may use the page topic internally to choose the most relevant outreach angle, but phrase the message as a normal professional introduction.
- Do not overstate familiarity with the recipient.
- Avoid exaggerated praise and generic AI buzzwords.
- Keep the email around 70-120 words with one low-pressure CTA.
- Keep the LinkedIn connection note under 250 characters.
- Keep the LinkedIn follow-up short enough to read comfortably on mobile.
- If the person's name is partial, use the supplied first name when safe; otherwise use a neutral greeting.
- The drafts are for human review and must not claim they have already been sent.
`,
    input: JSON.stringify(params, null, 2),
    schemaName: "outreach_draft",
    schema: outreachSchema as unknown as Record<string, unknown>,
  });

  const parsed = parseJson<{
    email_subject: string;
    email_body: string;
    linkedin_connection_note: string;
    linkedin_followup: string;
  }>(response.text, "Outreach generation");

  return {
    ...parsed,
    model: response.model,
    promptVersion: OUTREACH_PROMPT_VERSION,
  };
}
