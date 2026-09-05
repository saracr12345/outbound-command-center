type JsonSchema = Record<string, unknown>;

type ResponseContentItem = {
  type?: string;
  text?: string;
};

type ResponseOutputItem = {
  type?: string;
  content?: ResponseContentItem[];
};

type ResponsesApiResult = {
  id?: string;
  status?: string;
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
  output?: ResponseOutputItem[];
};

export function getOutboundModel(): string {
  return process.env.OPENAI_OUTBOUND_MODEL?.trim() || "gpt-5.6-luna";
}

function outputText(result: ResponsesApiResult): string {
  const parts: string[] = [];

  for (const item of result.output ?? []) {
    if (item.type !== "message") continue;

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

export async function createStructuredResponse(params: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: JsonSchema;
}): Promise<{ text: string; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getOutboundModel();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      instructions: params.instructions,
      input: params.input,
      text: {
        format: {
          type: "json_schema",
          name: params.schemaName,
          strict: true,
          schema: params.schema,
        },
      },
    }),
    cache: "no-store",
  });

  const result = (await response.json()) as ResponsesApiResult;

  if (!response.ok) {
    throw new Error(
      result.error?.message || `OpenAI request failed with HTTP ${response.status}.`,
    );
  }

  if (result.status && result.status !== "completed") {
    throw new Error(
      result.error?.message || `OpenAI response ended with status ${result.status}.`,
    );
  }

  const text = outputText(result);

  if (!text) {
    throw new Error("OpenAI returned no structured text output.");
  }

  return { text, model };
}
