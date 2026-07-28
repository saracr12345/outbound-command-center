export type SlackMessageEvent = {
    type?: string;
    subtype?: string;
    channel?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    ts?: string;
    event_ts?: string;
    blocks?: unknown[];
    attachments?: unknown[];
  };
  
  export type ParsedRb2bVisitor = {
    profileType: "person" | "company";
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    companyName: string | null;
    email: string | null;
    maskedEmail: string | null;
    linkedinUrl: string | null;
    location: string | null;
    companyWebsite: string | null;
    companyDomain: string | null;
    industry: string | null;
    employeeCount: number | null;
    employeeCountRaw: string | null;
    estimatedRevenue: string | null;
    pageUrl: string | null;
    pageViews: number | null;
    occurredAt: string | null;
    isRepeatVisit: boolean;
    rawText: string;
  };
  
  type UnknownRecord = Record<string, unknown>;
  
  function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  
  function decodeHtml(value: string): string {
    return value
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'");
  }
  
  function normaliseSlackMarkup(value: string): string {
    return decodeHtml(value)
      .replace(/<mailto:([^|>]+)\|([^>]+)>/gi, "$2 ($1)")
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/gi, "$2 ($1)")
      .replace(/<(https?:\/\/[^>]+)>/gi, "$1")
      // Remove Slack bold markers around labels, but preserve masked emails such as ***@***.
      .replace(/\*([A-Za-z][^*\n]{0,80}:)\*/g, "$1")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }
  
  function collectStrings(
    value: unknown,
    output: string[],
    parentKey: string | null = null,
  ): void {
    if (typeof value === "string") {
      const allowedKeys = new Set([
        "text",
        "title",
        "fallback",
        "pretext",
        "value",
        "url",
        "alt_text",
      ]);
  
      if (parentKey === null || allowedKeys.has(parentKey)) {
        output.push(value);
      }
  
      return;
    }
  
    if (Array.isArray(value)) {
      value.forEach((item) => collectStrings(item, output, parentKey));
      return;
    }
  
    if (!isRecord(value)) return;
  
    Object.entries(value).forEach(([key, child]) => {
      collectStrings(child, output, key);
    });
  }
  
  export function extractSlackMessageText(event: SlackMessageEvent): string {
    const fragments: string[] = [];
  
    if (event.text) fragments.push(event.text);
    collectStrings(event.blocks, fragments);
    collectStrings(event.attachments, fragments);
  
    const lines: string[] = [];
    const seen = new Set<string>();
  
    for (const fragment of fragments) {
      const normalised = normaliseSlackMarkup(fragment);
  
      for (const rawLine of normalised.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
  
        const key = line.toLowerCase();
        if (seen.has(key)) continue;
  
        seen.add(key);
        lines.push(line);
      }
    }
  
    return lines.join("\n");
  }
  
  function findField(lines: string[], labels: string[]): string | null {
    for (const line of lines) {
      for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = line.match(
          new RegExp(`^${escaped}\\s*(?::|–|—|-)\\s*(.+)$`, "i"),
        );
  
        if (match?.[1]) return match[1].trim();
      }
    }
  
    return null;
  }
  
  function extractUrl(value: string | null): string | null {
    if (!value) return null;
  
    const match = value.match(/https?:\/\/[^\s)>]+/i);
    return match?.[0]?.replace(/[.,;]+$/, "") ?? null;
  }
  
  function normaliseUrl(value: string | null): string | null {
    if (!value) return null;
  
    const extracted = extractUrl(value) ?? value.trim();
  
    try {
      const url = new URL(
        extracted.startsWith("http://") || extracted.startsWith("https://")
          ? extracted
          : `https://${extracted}`,
      );
  
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return extracted.replace(/\/$/, "");
    }
  }
  
  function normaliseLinkedInUrl(value: string | null): string | null {
    const url = normaliseUrl(value);
    if (!url) return null;
  
    try {
      const parsed = new URL(url);
      parsed.search = "";
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }
  
  function extractDomain(value: string | null): string | null {
    const url = normaliseUrl(value);
    if (!url) return null;
  
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return url
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null;
    }
  }
  
  function isRealEmail(value: string | null): boolean {
    if (!value || value.includes("*")) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }
  
  function splitName(fullName: string | null): {
    firstName: string | null;
    lastName: string | null;
  } {
    if (!fullName) {
      return { firstName: null, lastName: null };
    }
  
    const parts = fullName.split(/\s+/).filter(Boolean);
  
    return {
      firstName: parts[0] ?? null,
      lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
    };
  }
  
  function parseExactEmployeeCount(value: string | null): number | null {
    if (!value || !/^\d+$/.test(value.trim())) return null;
    return Number.parseInt(value.trim(), 10);
  }
  
  const monthNumbers: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  
  const timezoneOffsets: Record<string, string> = {
    UTC: "+00:00",
    GMT: "+00:00",
    EDT: "-04:00",
    EST: "-05:00",
    CDT: "-05:00",
    CST: "-06:00",
    MDT: "-06:00",
    MST: "-07:00",
    PDT: "-07:00",
    PST: "-08:00",
  };
  
  function makeIsoDate(input: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    meridiem: string;
    timezone?: string | null;
  }): string | null {
    let hour = input.hour;
    const meridiem = input.meridiem.toUpperCase();
  
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
  
    const offset = input.timezone
      ? timezoneOffsets[input.timezone.toUpperCase()] ?? "+00:00"
      : "+00:00";
  
    const value = `${String(input.year).padStart(4, "0")}-${String(
      input.month,
    ).padStart(2, "0")}-${String(input.day).padStart(2, "0")}T${String(
      hour,
    ).padStart(2, "0")}:${String(input.minute).padStart(2, "0")}:00${offset}`;
  
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  
  function parseVisitDate(value: string): string | null {
    const normalised = value.replace(/\s+/g, " ").trim();
  
    const words = normalised.match(
      /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AP]M)\s*([A-Z]{2,5})?/i,
    );
  
    if (words) {
      const month = monthNumbers[words[1].toLowerCase()];
      if (!month) return null;
  
      return makeIsoDate({
        year: Number(words[3]),
        month,
        day: Number(words[2]),
        hour: Number(words[4]),
        minute: Number(words[5]),
        meridiem: words[6],
        timezone: words[7] ?? null,
      });
    }
  
    const numeric = normalised.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)\s*([A-Z]{2,5})?/i,
    );
  
    if (numeric) {
      return makeIsoDate({
        year: Number(numeric[3]),
        month: Number(numeric[1]),
        day: Number(numeric[2]),
        hour: Number(numeric[4]),
        minute: Number(numeric[5]),
        meridiem: numeric[6],
        timezone: numeric[7] ?? null,
      });
    }
  
    return null;
  }
  
  function parseVisitSentence(text: string): {
    pageUrl: string | null;
    occurredAt: string | null;
  } {
    const sentence = text.match(
      /(?:First identified|Last identified|Identified|Returned)\s+visiting\s+(.+?)(?:\s+on\s+(.+))?$/im,
    );
  
    if (sentence) {
      return {
        pageUrl: normaliseUrl(sentence[1]),
        occurredAt: sentence[2] ? parseVisitDate(sentence[2]) : null,
      };
    }
  
    const lastVisitor = text.match(
      /Last visitor\s*(?::|–|—|-)\s*(.+)$/im,
    );
  
    return {
      pageUrl: null,
      occurredAt: lastVisitor?.[1] ? parseVisitDate(lastVisitor[1]) : null,
    };
  }
  
  function findHeadline(lines: string[]): string | null {
    return (
      lines.find((line) => /\s+from\s+/i.test(line) && !line.includes(":")) ??
      null
    );
  }
  
  function findCompanyFallback(lines: string[]): string | null {
    const about = lines.find((line) => /^About\s+.+/i.test(line));
    if (about) return about.replace(/^About\s+/i, "").trim();
  
    const ignored = [
      /^connect on linkedin/i,
      /^more details/i,
      /^first identified/i,
      /^last identified/i,
      /^last visitor/i,
      /^page views/i,
      /^website/i,
      /^industry/i,
      /^visitor location/i,
    ];
  
    return (
      lines.find(
        (line) =>
          !line.includes(":") &&
          !line.startsWith("http") &&
          !ignored.some((pattern) => pattern.test(line)),
      ) ?? null
    );
  }
  
  export function parseRb2bSlackMessage(
    event: SlackMessageEvent,
  ): ParsedRb2bVisitor | null {
    const rawText = extractSlackMessageText(event);
    if (!rawText) return null;
  
    const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
    const headline = findHeadline(lines);
    const headlineMatch = headline?.match(/^(.+?)\s+from\s+(.+)$/i) ?? null;
  
    const fullName =
      findField(lines, ["Name"]) ?? headlineMatch?.[1]?.trim() ?? null;
  
    const companyName =
      findField(lines, ["Company"]) ??
      headlineMatch?.[2]?.trim() ??
      findCompanyFallback(lines);
  
    const emailRaw = findField(lines, ["Email"]);
    const linkedInRaw = findField(lines, ["LinkedIn", "Linkedin"]);
    const websiteRaw = findField(lines, ["Website"]);
    const employeeCountRaw = findField(lines, [
      "Est. Employees",
      "Estimated Employees",
      "Employees",
    ]);
    const pageViewsRaw = findField(lines, ["Page views", "Page Views"]);
    const visit = parseVisitSentence(rawText);
    const names = splitName(fullName);
    const email = isRealEmail(emailRaw) ? emailRaw!.trim().toLowerCase() : null;
    const maskedEmail = emailRaw && !email ? emailRaw.trim() : null;
  
    const linkedinUrl = normaliseLinkedInUrl(linkedInRaw);
    const companyWebsite = normaliseUrl(websiteRaw);
    const jobTitle = findField(lines, ["Title", "Job title", "Job Title"]);
    const location = findField(lines, ["Location", "Visitor location"]);
    const industry = findField(lines, ["Industry"]);
    const estimatedRevenue = findField(lines, [
      "Est. Revenue",
      "Estimated Revenue",
      "Revenue",
    ]);
  
    const pageViews = pageViewsRaw?.match(/\d+/)?.[0]
      ? Number.parseInt(pageViewsRaw.match(/\d+/)![0], 10)
      : null;
  
    const profileType: "person" | "company" =
      fullName || linkedinUrl || jobTitle || emailRaw ? "person" : "company";
  
    if (!companyName && profileType === "company") return null;
    if (!companyName && !fullName && !linkedinUrl && !emailRaw) return null;
  
    return {
      profileType,
      fullName,
      firstName: names.firstName,
      lastName: names.lastName,
      jobTitle,
      companyName,
      email,
      maskedEmail,
      linkedinUrl,
      location,
      companyWebsite,
      companyDomain: extractDomain(companyWebsite),
      industry,
      employeeCount: parseExactEmployeeCount(employeeCountRaw),
      employeeCountRaw,
      estimatedRevenue,
      pageUrl: visit.pageUrl,
      pageViews,
      occurredAt: visit.occurredAt,
      isRepeatVisit: /repeat visitor|returned|visited again|identified again/i.test(
        rawText,
      ),
      rawText,
    };
  }
  