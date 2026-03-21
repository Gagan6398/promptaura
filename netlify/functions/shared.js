import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────
//  CLIENTS INITIALIZATION
// ─────────────────────────────────────────────
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
});

// ─────────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────────
export async function authenticate(token) {
  if (!token?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const jwtToken = token.split(" ")[1];

  try {
    // Verify with Supabase JWT
    const { data: { user }, error } = await supabase.auth.getUser(jwtToken);
    if (error || !user) throw new Error("Invalid token");

    // Get user profile + subscription
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, subscriptions(*)")
      .eq("id", user.id)
      .single();

    return { ...user, profile };
  } catch (err) {
    throw new Error("Token verification failed");
  }
}

// ─────────────────────────────────────────────
//  CHECK USAGE LIMITS
// ─────────────────────────────────────────────
export async function checkUsageLimit(user) {
  const plan = user.profile?.subscriptions?.[0]?.plan || "free";
  const limits = { free: 50, basic: 500, premium: -1 };
  const limit = limits[plan];

  if (limit === -1) return { plan }; // Premium = unlimited

  // Get this month's usage
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", startOfMonth.toISOString());

  if (count >= limit) {
    throw new Error(JSON.stringify({
      error: "Monthly limit reached",
      used: count,
      limit,
      plan,
      upgradeUrl: "https://promptaura.io/pricing",
    }));
  }

  return { usageCount: count, plan };
}

// Add the enhancePromptWithAI and other functions here.

export async function enhancePromptWithAI(prompt, settings, userApiKey, plan) {
  const { humorLevel, detailLevel, formalityLevel, platform } = settings;

  // Build the system prompt (the secret sauce)
  const systemPrompt = buildSystemPrompt(humorLevel, detailLevel, formalityLevel, plan);

  // Build enhanced user prompt
  const enhancedUserPrompt = buildEnhancedPrompt(prompt, settings);

  let response;

  // Try user's own API key first (their cost), then fallback to our key
  const openaiKey = userApiKey?.startsWith("sk-") ? userApiKey : process.env.OPENAI_API_KEY;
  const geminiKey = userApiKey?.startsWith("AIza") ? userApiKey : process.env.GEMINI_API_KEY;

  try {
    if (userApiKey?.startsWith("sk-") || openaiKey) {
      // Use OpenAI
      const openai = new OpenAI({ apiKey: openaiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Original prompt: "${prompt}"\n\nEnhanced version:` },
        ],
        max_tokens: 600,
        temperature: 0.7,
      });

      const enhancedText = completion.choices[0].message.content;

      // Also fetch sources and related content
      const metadata = await fetchResponseMetadata(prompt, plan);

      return {
        success: true,
        enhancedPrompt: enhancedText,
        originalPrompt: prompt,
        ...metadata,
      };
    } else if (geminiKey) {
      // Use Gemini
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(
        `${systemPrompt}\n\nOriginal prompt: "${prompt}"\n\nEnhanced version:`
      );
      const enhancedText = result.response.text();
      const metadata = await fetchResponseMetadata(prompt, plan);

      return {
        success: true,
        enhancedPrompt: enhancedText,
        originalPrompt: prompt,
        ...metadata,
      };
    }
  } catch (err) {
    console.error("AI enhancement error:", err);
    // Fallback: return rule-based enhancement
    return {
      success: true,
      enhancedPrompt: applyRuleBasedEnhancement(prompt, settings),
      originalPrompt: prompt,
    };
  }
}

function buildSystemPrompt(humorLevel, detailLevel, formalityLevel, plan) {
  const humorInstructions = humorLevel > 60
    ? "Add appropriate wit and humor to make the response engaging and memorable. Use clever analogies and light jokes where relevant."
    : humorLevel > 30
    ? "Keep the tone friendly and conversational with occasional light humor."
    : "Maintain a professional, serious tone.";

  const detailInstructions = detailLevel > 70
    ? "Provide comprehensive, detailed responses with examples, edge cases, and thorough explanations."
    : detailLevel > 40
    ? "Balance brevity with completeness. Include key details and one or two examples."
    : "Be concise and to the point. Only essential information.";

  const premiumInstructions = plan === "premium"
    ? "\n\nAs a Premium enhancement:\n- Always suggest follow-up questions\n- Provide confidence scores for factual claims\n- Include expert-level insights\n- Suggest related topics to explore"
    : "";

  return `You are PromptAura's Neural Enhancement Engine. Your job is to transform a user's rough prompt into a perfectly crafted, comprehensive query that will get the BEST possible response from any AI model.

RULES:
1. NEVER hallucinate or make up information
2. Make the enhanced prompt specific, clear, and context-rich
3. ${humorInstructions}
4. ${detailInstructions}
5. Add context that will help the AI provide accurate, relevant information
6. Request that sources and references be included in the response
7. Ask for practical examples where relevant
8. Structure the prompt to get organized, well-formatted responses
9. Anti-hallucination instruction: Include "Only provide information you are confident about. Clearly indicate if something is uncertain. Do not speculate without labeling it as speculation."${premiumInstructions}

Transform the prompt to be optimally structured for the best AI response possible. Return ONLY the enhanced prompt text, nothing else.`;
}

function buildEnhancedPrompt(originalPrompt, settings) {
  return `Please enhance this prompt optimally: "${originalPrompt}"`;
}

// Rule-based fallback enhancement (no AI needed)
function applyRuleBasedEnhancement(prompt, settings) {
  let enhanced = prompt;

  // Add clarity request
  if (!prompt.includes("explain") && !prompt.includes("describe")) {
    enhanced = `Please provide a comprehensive and accurate response to: ${enhanced}`;
  }

  // Add source request
  enhanced += "\n\nPlease include relevant sources, examples, and structured formatting. Only provide information you are confident about.";

  return enhanced;
}

// ─────────────────────────────────────────────
//  FETCH METADATA (Sources, Images, Docs)
// ─────────────────────────────────────────────
async function fetchResponseMetadata(prompt, plan) {
  if (plan === "free") return {}; // Metadata only for paid plans

  try {
    // In production: call search APIs (Bing Search, Google Custom Search, etc.)
    // For now, return structured placeholder that shows the concept
    const keywords = extractKeywords(prompt);

    return {
      sources: [
        {
          title: `${keywords[0]} - Wikipedia`,
          url: `https://en.wikipedia.org/wiki/${encodeURIComponent(keywords[0])}`,
          relevance: 0.95,
        },
        {
          title: `${keywords[0]} Documentation`,
          url: `https://docs.example.com/${keywords[0].toLowerCase()}`,
          relevance: 0.88,
        },
      ],
      followUps: generateFollowUps(prompt, keywords),
      relatedTopics: keywords.slice(0, 4),
    };
  } catch (e) {
    return {};
  }
}

function extractKeywords(text) {
  const stopWords = new Set(["the","a","an","is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","could","should","may","might","shall","can","need","dare","ought","used","what","when","where","who","which","why","how","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its","our","their","this","that","these","those","and","or","but","if","because","as","until","while","of","at","by","for","with","about","against","between","into","through","during","before","after","above","below","to","from","up","down","in","out","on","off","over","under","again","then","once","here","there","both","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","just","also"]);
  
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 5);
}

function generateFollowUps(prompt, keywords) {
  return [
    `What are the latest developments in ${keywords[0]}?`,
    `Can you provide examples of ${keywords[0]} in practice?`,
    `What are the potential challenges with ${keywords[0]}?`,
  ];
}