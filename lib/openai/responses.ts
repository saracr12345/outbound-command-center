type JsonSchema = Record<string, unknown>;

type ResponseContentItem = {
  type?: string;
  text?: string;
};

type WebSearchSource = {
  type?: string;
  url?: string;
  title?: string;
};

type WebSearchAction = {
  type?: string;
  url?: string;
  sources?: WebSearchSource[];
};

type ResponseOutputItem = {
  type?: string;
  content?: ResponseContentItem[];
  action?: WebSearchAction;
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

export type OpenAIWebSource = {
  url: string;
  title: string | null;
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

function webSources(result: ResponsesApiResult): OpenAIWebSource[] {
  const seen = new Set<string>();
  const sources: OpenAIWebSource[] = [];

  for (const item of result.output ?? []) {
    if (item.type !== "web_search_call") continue;

    const actionSources = item.action?.sources ?? [];

    for (const source of actionSources) {
      if (source.type && source.type !== "url") continue;
      if (typeof source.url !== "string" || !source.url.startsWith("http")) {
        continue;
      }
      if (seen.has(source.url)) continue;

      seen.add(source.url);
      sources.push({
        url: source.url,
        title:
          typeof source.title === "string" && source.title.trim()
            ? source.title.trim()
            : null,
      });
    }
  }

  return sources.slice(0, 12);
}

export async function createStructuredResponse(params: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: JsonSchema;
  webSearch?: boolean;
  searchContextSize?: "low" | "medium" | "high";
}): Promise<{ text: string; model: string; sources: OpenAIWebSource[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getOutboundModel();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const body: Record<string, unknown> = {
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
  };

  if (params.webSearch) {
    body.tools = [
      {
        type: "web_search",
        search_context_size: params.searchContextSize ?? "medium",
      },
    ];
    body.tool_choice = "required";
    body.include = ["web_search_call.action.sources"];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

  return { text, model, sources: webSources(result) };
}
