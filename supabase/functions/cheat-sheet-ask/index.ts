// ============================================================
// TARA ROSE — Wellness Voucher cheat sheets, the question widget
// supabase/functions/cheat-sheet-ask/index.ts
// ============================================================
//
// Sibling of pulse-narrative and branch-narrative: same project, same
// ANTHROPIC_API_KEY secret, same house rules. Where those two write English
// about numbers they were handed, this one answers questions about text it was
// handed, and the discipline is the same one: it may not produce a fact it was
// not given.
//
// WHY IT EXISTS: the cheat sheets are static HTML on a public host, so they
// cannot hold an API key. This function holds it and is the only thing that
// talks to Anthropic.
//
// THE ONE DESIGN RULE, and everything below serves it: a cheat sheet exists so
// somebody says the right thing to a client. A confidently wrong answer is
// therefore worse than no answer. So the model is given the sheets as its only
// source, is told to refuse rather than reason, and every answer carries the
// line it came from so a human can check it in two seconds.
//
// THE GROUNDING IS SENT BY THE CALLER. The widget sends the sheet she is reading
// in full plus the Overview, and the remaining sheets as headings only.
//
// THE MODEL IS CHOSEN BY THE READER, from a fixed list. Never from whatever the
// client sends: this endpoint is public, and an open model parameter is somebody
// else's bill. MODELS below is the allowlist and the per-model request shape in
// one place, because those shapes genuinely differ and getting one wrong is a
// 400 rather than a soft ignore.
//
// Deploy:  supabase functions deploy cheat-sheet-ask --project-ref gvijxenafoowajqktqvd
// Secrets: shares pulse-narrative's ANTHROPIC_API_KEY. Nothing new to set.
// Tables:  none. Nothing is stored; a question is not a record.
// Speed:   fast mode was tried and removed. It 429s on this account every time,
//          so it only added a failed round trip before the real call. 529
//          overloaded is retried rather than surfaced as a fault.
//
// No em-dashes anywhere in this file, per the 4 July purge. Comments included.

import Anthropic from "npm:@anthropic-ai/sdk";

const MAX_QUESTION_CHARS = 600;
const MAX_CONTEXT_CHARS = 90000;

// The allowlist. `key` is what the widget sends; everything else is decided here.
//
// The per-model differences are real and not cosmetic:
//   effort    errors outright on Haiku 4.5, so it must be omitted there.
//   thinking  is on by default on Opus 5 and adaptive on Sonnet 5. Omitting it on
//             Haiku 4.5 means no thinking at all, which is the point of picking it.
//   fallbacks is the Opus 5 server-side refusal fallback, kept where it applies.
type ModelSpec = {
  id: string;
  effort?: "low" | "medium" | "high";
  fallback?: boolean;
};

const MODELS: Record<string, ModelSpec> = {
  quick:    { id: "claude-haiku-4-5" },
  balanced: { id: "claude-sonnet-5", effort: "low" },
  careful:  { id: "claude-opus-5", effort: "low", fallback: true },
};
const DEFAULT_MODEL = "careful";

const SYSTEM = `You answer questions from the Tara Rose team about the Wellness Voucher campaign, using the team cheat sheets you are given and nothing else.

Who is asking. Reception at a busy till, the GHL team mid-build, or LID working through a revision list. They need an answer they can act on in seconds, often with a client waiting.

THE RULE THAT OVERRIDES EVERYTHING ELSE: your only source is the SHEETS block. You have no other knowledge of this campaign. Anything you think you remember about Tara Rose, salon vouchers, prices or this offer is not evidence. Prices, allowances, tier rules and dates have changed more than once; the sheets are current and your memory is not. If the sheets do not say it, you do not know it.

How to answer.
1. Answer plainly in one to three sentences, leading with what they should do or say.
2. Quote, as close to word for word as you can, the single sentence from the sheets that carries the answer. One sentence, not a paragraph.
3. If the sheets do not answer it, set found to false, say so in one sentence, and name the owner if the sheets name one. "I do not know, ask Kate" is a correct and useful answer here. Never fill a gap with a plausible number, rule or date.
4. The SHEETS block sends the sheet she is reading in full, and the other sheets as their headings only, marked "headings only, not loaded". If the answer is on a full sheet, give it. If it plainly belongs to a sheet you only have headings for, say so and name that sheet rather than guessing at its contents: "That is on the GHL sheet" is a useful answer, an invented one is not.

Never acceptable. Inventing or estimating a price, an allowance, a cap, a validity period or a date. Softening a rule the sheets state firmly. Deciding a specific client's bill or booking, which is a till decision and not yours. Guessing which colour step a service sits on beyond the named ladder: if it is not named, say so and say to ask before the appointment.

Voice: warm, real, expert, plain. British English. Short sentences, no filler, no preamble, never open with "Great question". No exclamation marks. Never use an em-dash.`;

const SCHEMA = {
  type: "object",
  properties: {
    found: {
      type: "boolean",
      description: "True only if the sheets actually answer the question. False if you are declining or saying you do not know.",
    },
    answer: {
      type: "string",
      description: "One to three sentences, leading with what to do or say. If found is false, one sentence saying so and naming the owner if the sheets name one.",
    },
    source: {
      type: "string",
      description: "The single sentence from the sheets that carries the answer, quoted as closely as you can. If found is false, the exact string: not in the sheets",
    },
    sheet: {
      type: "string",
      description: "Which sheet the answer came from, for example Overview, LID, GHL team or Reception. Empty string if found is false.",
    },
  },
  required: ["found", "answer", "source", "sheet"],
  additionalProperties: false,
};

// The sheets are served from a public Pages site. Only those origins plus local
// preview may call this. Not a security boundary on its own, but it stops the
// endpoint being casually reused from anywhere else.
const ALLOWED_ORIGINS = [
  "https://katealsaybar.github.io",
  "https://tararose83.github.io",
  "http://localhost:8791",
  "http://127.0.0.1:8791",
];

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

// Error status, read off the error itself. Not instanceof: this SDK build does
// not hang its error classes off the default export, so `instanceof
// Anthropic.RateLimitError` threw a TypeError inside the catch, and every API
// error (rate limit, out of credit, overloaded) reached the browser as a bare
// 500 with no CORS header, which the widget reports as "could not reach".
// Found on dashboard-ask, its sibling, 24 Sep 2026.
const statusOf = (e: unknown): number | undefined => {
  const n = (e as { status?: unknown })?.status;
  return typeof n === "number" ? n : undefined;
};

const json = (body: unknown, headers: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  const CORS = cors(req.headers.get("origin"));

  // A 204 must carry no body: JSON.stringify into a 204 throws in Deno, the
  // preflight fails, and CORS then blocks the real POST.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, CORS, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json({ error: "The answer service is not configured. Tell Kate the ANTHROPIC_API_KEY secret is missing." }, CORS, 500);
  }

  let question = "";
  let sheets = "";
  let picked = DEFAULT_MODEL;
  try {
    const body = await req.json();
    question = String(body.question ?? "").trim();
    sheets = String(body.sheets ?? "").trim();
    const asked = String(body.model ?? "").trim();
    // An unknown key falls back to the default rather than erroring: a stale page
    // should get a slower answer, never no answer.
    if (asked && MODELS[asked]) picked = asked;
  } catch {
    return json({ error: "Could not read that request." }, CORS, 400);
  }

  if (!question) return json({ error: "Ask a question first." }, CORS, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: `Keep the question under ${MAX_QUESTION_CHARS} characters.` }, CORS, 400);
  }
  if (!sheets) {
    return json({ error: "The sheets did not load, so there is nothing to answer from. Reload the page and try again." }, CORS, 400);
  }
  if (sheets.length > MAX_CONTEXT_CHARS) {
    return json({ error: "That is more sheet content than expected. Tell Kate the widget is sending too much." }, CORS, 400);
  }

  const spec = MODELS[picked];
  const anthropic = new Anthropic({ apiKey });

  async function ask() {
    // output_config always carries the schema. `effort` is added only where the
    // model accepts it: sending it to Haiku 4.5 is a 400, not a soft ignore.
    const outputConfig: Record<string, unknown> = {
      format: { type: "json_schema", schema: SCHEMA },
    };
    if (spec.effort) outputConfig.effort = spec.effort;

    return await anthropic.beta.messages.create({
      model: spec.id,
      max_tokens: 1500,
      output_config: outputConfig,
      // Server-side refusal fallback, where the model supports it, so a safety
      // refusal still returns something the person at the till can act on.
      ...(spec.fallback
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      system: [
        // Stable prefix first so it caches. The system prompt and the sheets do
        // not change between questions; only the question does.
        { type: "text", text: SYSTEM },
        { type: "text", text: `SHEETS\n${sheets}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: question }],
    });
  }

  // 529 overloaded is the API saying "try again", and it says so in its own
  // headers: x-should-retry true, retry-after 0. It used to fall through to the
  // generic catch and report a fault that was not one.
  async function askWithRetry() {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await ask();
      } catch (e) {
        last = e;
        const overloaded = statusOf(e) === 529;
        if (!overloaded || attempt === 2) throw e;
        console.warn(`[ask] ${spec.id} overloaded, retry ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw last;
  }

  try {
    const res = await askWithRetry();

    if (res.stop_reason === "refusal") {
      console.error("[ask] refused", res.stop_details);
      return json({ found: false, answer: "I cannot answer that one. Ask Kate.", source: "not in the sheets", sheet: "", model: picked }, CORS);
    }

    const text = res.content.find((b: { type: string }) => b.type === "text");
    if (!text || !("text" in text)) return json({ error: "No answer came back. Try again." }, CORS, 502);

    let out: Record<string, unknown>;
    try {
      out = JSON.parse((text as { text: string }).text);
    } catch {
      console.error("[ask] unparseable output from", spec.id);
      return json({ error: "The answer came back malformed. Try asking it a different way, or pick a different model." }, CORS, 502);
    }

    // Echo which model answered, so the widget can label it and so a wrong answer
    // can be traced to the model that gave it.
    out.model = picked;
    return json(out, CORS);
  } catch (error) {
    const status = statusOf(error);
    const msg = String((error as { message?: string })?.message ?? "");
    if (/credit balance/i.test(msg)) {
      return json({ error: "The answer service has run out of Anthropic credit. Tell Kate to top up the API account. The sheets are still correct." }, CORS, 503);
    }
    if (status === 429) {
      return json({ error: "Too many questions at once. Wait a moment and ask again." }, CORS, 429);
    }
    if (status === 401 || status === 403) {
      return json({ error: "The answer service cannot sign in. Tell Kate the API key needs checking." }, CORS, 500);
    }
    if (status === 529) {
      return json({ error: "The answer service is busy right now. Ask again in a few seconds; it usually clears straight away." }, CORS, 503);
    }
    if (status === undefined) {
      console.error("[ask] no response from", spec.id, error);
      return json({ error: "Could not reach the answer service. Try again in a moment." }, CORS, 503);
    }
    console.error("[ask] failed on", spec.id, error);
    return json({ error: "Something went wrong answering that. Try a different model, or read the sheet: it is still correct." }, CORS, 500);
  }
});
