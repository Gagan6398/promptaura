-- PromptAura Database Schema
-- Run this in your Supabase SQL Editor
-- Supabase is FREE at supabase.com (up to 500MB, 50k MAU)

-- ─────────────────────────────────────────────
--  Enable Extensions
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
--  PROFILES TABLE (extends Supabase auth.users)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  stripe_customer_id TEXT UNIQUE,
  settings JSONB DEFAULT '{
    "humorLevel": 50,
    "detailLevel": 70,
    "formalityLevel": 40,
    "platforms": {
      "chatgpt": true,
      "gemini": true,
      "claude": true
    }
  }',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─────────────────────────────────────────────
--  SUBSCRIPTIONS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'premium')),
  billing TEXT DEFAULT 'monthly' CHECK (billing IN ('monthly', 'annual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'trialing')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- ─────────────────────────────────────────────
--  USAGE LOGS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'unknown',
  original_prompt_length INT DEFAULT 0,
  enhanced_prompt_length INT DEFAULT 0,
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for monthly usage queries
CREATE INDEX IF NOT EXISTS idx_usage_user_date ON public.usage_logs(user_id, created_at);

-- ─────────────────────────────────────────────
--  ENHANCED_PROMPTS TABLE (for analytics)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.enhanced_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform TEXT,
  original_prompt TEXT,
  enhanced_prompt TEXT,
  humor_level INT DEFAULT 50,
  detail_level INT DEFAULT 70,
  response_rating INT CHECK (response_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
--  ROW LEVEL SECURITY (RLS)
-- ─────────────────────────────────────────────

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enhanced_prompts ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Subscriptions: users can see their own
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- Usage logs: users can see their own
CREATE POLICY "Users can view own usage" ON public.usage_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can do everything (for backend API)
CREATE POLICY "Service role full access profiles" ON public.profiles
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access subscriptions" ON public.subscriptions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access usage" ON public.usage_logs
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────
--  ANALYTICS VIEWS
-- ─────────────────────────────────────────────

-- Monthly revenue view
CREATE OR REPLACE VIEW public.monthly_stats AS
SELECT
  date_trunc('month', created_at) AS month,
  COUNT(*) AS total_enhancements,
  COUNT(DISTINCT user_id) AS unique_users
FROM public.usage_logs
GROUP BY 1
ORDER BY 1 DESC;

-- User stats view
CREATE OR REPLACE VIEW public.user_stats AS
SELECT
  p.id,
  p.email,
  COALESCE(s.plan, 'free') AS plan,
  COUNT(u.id) AS total_enhancements,
  MAX(u.created_at) AS last_active
FROM public.profiles p
LEFT JOIN public.subscriptions s ON s.user_id = p.id AND s.status = 'active'
LEFT JOIN public.usage_logs u ON u.user_id = p.id
GROUP BY p.id, p.email, s.plan;

-- ─────────────────────────────────────────────
--  SEED DATA (for testing)
-- ─────────────────────────────────────────────
-- Uncomment to add test subscription plans reference:
-- INSERT INTO public.plans (name, price_monthly, price_annual, limits) VALUES
--   ('free', 0, 0, '{"prompts": 50}'),
--   ('basic', 999, 7990, '{"prompts": 500}'),
--   ('premium', 2499, 19990, '{"prompts": -1}');
