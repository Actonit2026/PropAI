export const config = { runtime: "edge" };

const FREE_LIMIT = 50; // 50 proposals per week for free users

function sanitize(str) {
  if (!str || typeof str !== "string") return "";
  return str.trim();
}

async function kvGetUses(key) {
  try {
    const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    const data = await res.json();
    return data.result ? parseInt(data.result, 10) : 0;
  } catch { return 0; }
}

async function kvIncrUses(key) {
  try {
    const res = await fetch(`${process.env.KV_REST_API_URL}/incr/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
    });
    const data = await res.json();
    if (data.result === 1) {
      // Expire after 7 days (weekly reset)
      fetch(`${process.env.KV_REST_API_URL}/expire/${encodeURIComponent(key)}/604800`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
      });
    }
    return data.result || 1;
  } catch { return 1; }
}

async function callClaude(systemPrompt, userPrompt, model, maxTokens = 700) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  const data = await res.json();
  if (data.error) { console.error("Claude error:", JSON.stringify(data.error)); return ""; }
  return data?.content?.[0]?.text || "";
}

const PLATFORM_MAP = {
  general:    "",
  upwork:     "This is an Upwork proposal. Clients scan fast. Lead with your strongest relevant point immediately.",
  linkedin:   "This is a LinkedIn message. Professional but warm. First line must hook.",
  email:      "This is a cold email. First sentence is the hook. End with one clear, low-friction ask.",
  freelancer: "This is a Freelancer.com bid. Be specific about timeline and deliverables."
};

const LENGTH_TOKENS = { short: 250, standard: 550, detailed: 800 };
const LENGTH_WORDS  = { short: "~120 words", standard: "~260 words", detailed: "~400 words" };

function buildVoiceSystem(writingSample, platform, language) {
  const platformNote = PLATFORM_MAP[platform] || "";
  const langNote = language && language !== "en" ? `Write entirely in ${language.toUpperCase()}.` : "";

  if (writingSample && writingSample.length > 30) {
    return [
      "You are an expert at voice-matched freelance proposal writing.",
      "Your PRIMARY task is to analyse the provided writing sample and replicate the author's exact voice in the output.",
      "",
      "When analysing the sample, extract and mirror ALL of the following:",
      "- Sentence length rhythm (short punchy sentences vs long flowing ones vs mixed)",
      "- Use of contractions (e.g. I've vs I have, don't vs do not)",
      "- Formality register (casual, professional, or formal)",
      "- Punctuation personality (ellipses, semicolons, parentheses, or none)",
      "- How they open (direct statement, question, observation, or context-setting)",
      "- Vocabulary level (plain words vs technical vs varied)",
      "- Energy and warmth level (dry, enthusiastic, calm, confident)",
      "- Whether they use first person assertively (I built vs I have experience building)",
      "",
      "The output MUST be indistinguishable in voice from the writing sample.",
      "A reader who sees both texts should immediately recognise they came from the same person.",
      "Do NOT default to generic proposal language. If the sample is conversational, the output is conversational. If it is terse, the output is terse.",
      "",
      "Additional rules:",
      "No bullet points. Paragraphs only.",
      "Never open with: I am writing to, I am excited to, I would love to, or any generic opener.",
      "Never use em dashes in the output. Use a period, comma, or colon instead.",
      "Never start the proposal with the word I as the first word.",
      "Every proposal must reference at least one specific detail from the job description.",
      "Lead with the single most relevant detail about this specific job.",
      platformNote,
      langNote
    ].filter(Boolean).join("\n");
  }

  return [
    "You are an elite freelance proposal writer. Your proposals are specific, human, and high-converting.",
    "Write with quiet confidence. Assertive but not arrogant.",
    "Use paragraphs only. No bullet points.",
    "Never open with: I am writing to, I am excited to, I would love to, or any generic opener.",
    "Never use em dashes in the output. Use a period, comma, or colon instead.",
    "Never start the proposal with the word I as the first word.",
    "Every proposal must reference at least one specific detail from the job description.",
    "Lead with the single most relevant detail about this specific job, something that proves you read it carefully.",
    platformNote,
    langNote
  ].filter(Boolean).join("\n");
}

export default async function handler(req) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    return await runHandler(req, headers);
  } catch (err) {
    console.error("generate.js uncaught:", err && err.stack || err);
    return new Response(
      JSON.stringify({ error: "Service temporarily unavailable. Please try again.", code: "INTERNAL_ERROR" }),
      { status: 500, headers }
    );
  }
}

async function runHandler(req, headers) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

  const isPaid = body.isPaid === true;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const kvKey = `free:${ip}`;

  if (!isPaid) {
    const uses = await kvGetUses(kvKey);
    if (uses >= FREE_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Free limit reached. Upgrade to continue.", remaining: 0 }),
        { status: 402, headers }
      );
    }
  }

  const mode                = body.mode || "proposal";
  const jobDesc             = sanitize(body.jobDesc || "");
  const name                = sanitize(body.name || "");
  const rate                = sanitize(body.rate || "");
  const linkedinUrl         = sanitize(body.linkedinUrl || "");
  const originalProposal    = sanitize(body.originalProposal || "");
  const revisionInstruction = sanitize(body.revisionInstruction || "");
  const writingSample       = sanitize(body.writingSample || "");

  const platform  = isPaid ? sanitize(body.platform || "general") : "general";
  const language  = isPaid ? sanitize(body.language || "en")      : "en";
  const length    = isPaid ? sanitize(body.length || "standard")  : "standard";

  const model     = isPaid ? "claude-sonnet-4-20250514" : "claude-haiku-4-5-20251001";
  const maxTokens = LENGTH_TOKENS[length] || 550;

  const systemPrompt = buildVoiceSystem(writingSample, platform, language);

  let result = "";

  if (mode === "proposal") {
    const hasVoice = writingSample && writingSample.length > 30;

    const voiceBlock = hasVoice
      ? `WRITING SAMPLE - study this carefully and mirror the voice exactly:\n"""\n${writingSample.slice(0, 1200)}\n"""\n\n`
      : "";

    const contextBlock = [
      jobDesc      ? `JOB DESCRIPTION:\n${jobDesc}` : "",
      name         ? `Freelancer name: ${name}`      : "",
      rate         ? `Rate: ${rate}`                 : "",
      linkedinUrl  ? `LinkedIn: ${linkedinUrl}`      : ""
    ].filter(Boolean).join("\n");

    const prompt = hasVoice
      ? `${voiceBlock}${contextBlock}\n\nWrite a proposal that wins this job, written in the EXACT voice of the writing sample above. The client should feel they are reading something written by the same person who wrote the sample. Target length: ${LENGTH_WORDS[length] || "~260 words"}.`
      : `Write a personalized, high-converting freelance proposal.\n\n${contextBlock}\n\nTarget length: ${LENGTH_WORDS[length] || "~260 words"}. Lead with the single most relevant detail about this specific job.`;

    result = await callClaude(systemPrompt, prompt, model, maxTokens);
  }

  if (mode === "followup") {
    const prompt = `Write a short follow-up message after 3 days of no reply.\n\nOriginal Proposal:\n${originalProposal}\n\nJob:\n${jobDesc}\n\nRules: Under 80 words. Warm but not desperate. Confident. End with a simple yes/no question.`;
    result = await callClaude(systemPrompt, prompt, model, 300);
  }

  if (mode === "revision") {
    const prompt = `Revise this proposal based on the instruction below. Return only the revised version, no commentary.\n\nInstruction: ${revisionInstruction}\n\nProposal:\n${originalProposal}`;
    result = await callClaude(systemPrompt, prompt, model, maxTokens);
  }

  if (!result) {
    return new Response(
      JSON.stringify({ error: "No output generated. Please try again." }),
      { status: 500, headers }
    );
  }

  let remaining = null;
  if (!isPaid) {
    const newCount = await kvIncrUses(kvKey);
    remaining = Math.max(0, FREE_LIMIT - newCount);
  }

  return new Response(JSON.stringify({ result, remaining }), { status: 200, headers });
}
