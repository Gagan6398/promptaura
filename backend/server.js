/**
 * PromptAura - Main Backend API
 * Stack: Node.js + Express + Supabase + Stripe
 * Deploy: Railway / Render (Free Tier)
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
//  CLIENTS INITIALIZATION
// ─────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-11-20.acacia",
});

// ─────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    "https://promptaura.io",
    "https://www.promptaura.io",
    "chrome-extension://",  // Allow any Chrome extension origin
    /^chrome-extension:\/\//,
    "http://localhost:3000",
  ],
  credentials: true,
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  message: { error: "Too many requests. Please try again later." },
});

const enhanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: { error: "Too many enhancement requests. Slow down!" },
});

app.use("/api/v1/enhance", enhanceLimiter);
app.use("/api/v1/", generalLimiter);

// Raw body for Stripe webhooks
app.use("/api/v1/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ─────────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────────
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify with Supabase JWT
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Invalid token" });

    // Get user profile + subscription
    const { data: profile } = await supabase
      .from("profiles")
      .select("*, subscriptions(*)")
      .eq("id", user.id)
      .single();

    req.user = { ...user, profile };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token verification failed" });
  }
}

// ─────────────────────────────────────────────
//  CHECK USAGE LIMITS MIDDLEWARE
// ─────────────────────────────────────────────
async function checkUsageLimit(req, res, next) {
  const { user } = req;
  const plan = user.profile?.subscriptions?.[0]?.plan || "free";
  const limits = { free: 50, basic: 500, premium: -1 };
  const limit = limits[plan];

  if (limit === -1) return next(); // Premium = unlimited

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
    return res.status(429).json({
      error: "Monthly limit reached",
      used: count,
      limit,
      plan,
      upgradeUrl: "https://promptaura.io/pricing",
    });
  }

  req.usageCount = count;
  req.plan = plan;
  next();
}

// ─────────────────────────────────────────────
//  THE CORE ENHANCEMENT ENGINE
// ─────────────────────────────────────────────
async function enhancePromptWithAI(prompt, settings, userApiKey, plan) {
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

// ─────────────────────────────────────────────
//  SYSTEM PROMPT BUILDER (The Secret Sauce)
// ─────────────────────────────────────────────
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
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1));
}

function generateFollowUps(prompt, keywords) {
  return [
    `What are the best practices for ${keywords[0]}?`,
    `Can you give me a practical example of ${keywords[0]}?`,
    `What are common mistakes to avoid with ${keywords[0]}?`,
  ];
}

// ─────────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
});

// ── POST /api/v1/enhance ──────────────────────
app.post("/api/v1/enhance", authenticate, checkUsageLimit, async (req, res) => {
  const { prompt, platform, settings } = req.body;

  if (!prompt || prompt.trim().length < 3) {
    return res.status(400).json({ error: "Prompt is too short" });
  }

  if (prompt.length > 5000) {
    return res.status(400).json({ error: "Prompt too long (max 5000 chars)" });
  }

  try {
    const result = await enhancePromptWithAI(
      prompt,
      { ...settings, platform },
      settings?.userApiKey,
      req.plan
    );

    // Log usage to database
    await supabase.from("usage_logs").insert({
      user_id: req.user.id,
      platform: platform || "unknown",
      original_prompt_length: prompt.length,
      enhanced_prompt_length: result.enhancedPrompt?.length || 0,
      plan: req.plan,
    });

    res.json(result);
  } catch (err) {
    console.error("Enhancement error:", err);
    res.status(500).json({ error: "Enhancement failed. Please try again." });
  }
});

// ── GET /api/v1/usage ─────────────────────────
app.get("/api/v1/usage", authenticate, async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const plan = req.user.profile?.subscriptions?.[0]?.plan || "free";
  const limits = { free: 50, basic: 500, premium: -1 };

  const { count } = await supabase
    .from("usage_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", req.user.id)
    .gte("created_at", startOfMonth.toISOString());

  res.json({
    used: count,
    limit: limits[plan],
    plan,
    unlimited: plan === "premium",
    resetDate: new Date(startOfMonth.getFullYear(), startOfMonth.getMonth() + 1, 1).toISOString(),
  });
});

// ── GET /api/v1/usage/history ─────────────────
app.get("/api/v1/usage/history", authenticate, async (req, res) => {
  const { data } = await supabase
    .from("usage_logs")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  res.json({ history: data || [] });
});

// ── POST /api/v1/usage/track ──────────────────
app.post("/api/v1/usage/track", authenticate, async (req, res) => {
  const { platform } = req.body;
  await supabase.from("usage_logs").insert({
    user_id: req.user.id,
    platform: platform || "unknown",
    plan: req.user.profile?.subscriptions?.[0]?.plan || "free",
  });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  STRIPE PAYMENT ROUTES
// ─────────────────────────────────────────────

const STRIPE_PRICES = {
  basic_monthly: process.env.STRIPE_PRICE_BASIC_MONTHLY,
  basic_annual: process.env.STRIPE_PRICE_BASIC_ANNUAL,
  premium_monthly: process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
  premium_annual: process.env.STRIPE_PRICE_PREMIUM_ANNUAL,
};

// Create checkout session
app.post("/api/v1/stripe/create-checkout", authenticate, async (req, res) => {
  const { plan, billing } = req.body; // plan: 'basic'|'premium', billing: 'monthly'|'annual'
  const priceKey = `${plan}_${billing || "monthly"}`;
  const priceId = STRIPE_PRICES[priceKey];

  if (!priceId) return res.status(400).json({ error: "Invalid plan" });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: req.user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `https://promptaura.io/dashboard?upgrade=success&plan=${plan}`,
      cancel_url: `https://promptaura.io/pricing?cancel=true`,
      metadata: {
        userId: req.user.id,
        plan,
        billing: billing || "monthly",
      },
      subscription_data: {
        metadata: { userId: req.user.id },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Payment session creation failed" });
  }
});

// Create portal session (manage subscription)
app.post("/api/v1/stripe/portal", authenticate, async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", req.user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({ error: "No subscription found" });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: "https://promptaura.io/dashboard",
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Portal creation failed" });
  }
});

// Stripe Webhook
app.post("/api/v1/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: "Webhook verification failed" });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const { userId, plan } = session.metadata;

      // Update user's subscription in database
      await supabase.from("subscriptions").upsert({
        user_id: userId,
        plan,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        status: "active",
        started_at: new Date().toISOString(),
      });

      // Update profile
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: session.customer })
        .eq("id", userId);

      console.log(`✅ User ${userId} upgraded to ${plan}`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;

      if (userId) {
        await supabase
          .from("subscriptions")
          .update({ plan: "free", status: "cancelled" })
          .eq("stripe_subscription_id", subscription.id);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      // TODO: send email notification about failed payment
      console.log(`❌ Payment failed for customer ${invoice.customer}`);
      break;
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────
//  PROFILE ROUTES
// ─────────────────────────────────────────────
app.get("/api/v1/profile", authenticate, async (req, res) => {
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, subscriptions(*)")
    .eq("id", req.user.id)
    .single();

  res.json({ profile });
});

app.put("/api/v1/profile/settings", authenticate, async (req, res) => {
  const { humorLevel, detailLevel, formalityLevel, platforms } = req.body;

  const { error } = await supabase
    .from("profiles")
    .update({ settings: { humorLevel, detailLevel, formalityLevel, platforms } })
    .eq("id", req.user.id);

  if (error) return res.status(500).json({ error: "Settings update failed" });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────
app.post("/api/v1/auth/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "No token" });

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) return res.status(401).json({ error: "Token refresh failed" });

  const plan = data.user ? (await supabase
    .from("subscriptions")
    .select("plan")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .single()).data?.plan || "free" : "free";

  res.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    plan,
  });
});

// ─────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 PromptAura API running on port ${PORT}`);
});

export default app;
