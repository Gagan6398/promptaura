# 🚀 PromptAura — Complete Deployment & Operations Guide

## 📁 Project Structure
```
promptaura/
├── extension/           ← Chrome/Firefox Browser Extension
│   ├── manifest.json    ← Extension config & permissions
│   ├── content.js       ← Floating button + Neural ray animation
│   ├── content.css      ← Extension UI styles
│   ├── background.js    ← Service worker (API calls, auth)
│   └── popup.html       ← Extension popup UI (340px)
│
├── backend/             ← Node.js API Server
│   ├── server.js        ← Main Express API
│   ├── package.json     ← Dependencies
│   ├── .env.example     ← Environment variables template
│   └── schema.sql       ← Supabase database schema
│
└── website/             ← Landing Page + Dashboard (from Agent)
    └── index.html       ← Complete SPA
```

---

## 🎯 STEP 1: Setup Supabase (Database + Auth) — FREE

**Time: 10 minutes | Cost: $0**

1. Go to **supabase.com** → Sign up with GitHub
2. Click "New Project"
   - Name: `promptaura`
   - Database Password: [Save this securely!]
   - Region: Choose nearest to you
3. Wait ~2 minutes for setup

4. Go to **SQL Editor** → Paste contents of `backend/schema.sql` → Run
5. Go to **Settings → API** → Copy:
   - `Project URL` → paste as `SUPABASE_URL` in .env
   - `anon/public` key → paste as `SUPABASE_ANON_KEY`
   - `service_role` key → paste as `SUPABASE_SERVICE_ROLE_KEY`

6. Go to **Authentication → Settings**:
   - Enable Email/Password auth
   - Enable Google OAuth (add your Google OAuth credentials)
   - Set Site URL to `https://promptaura.io`
   - Add redirect URLs:
     - `https://promptaura.io/dashboard`
     - `chrome-extension://YOUR_EXTENSION_ID/popup.html`

---

## 💳 STEP 2: Setup Stripe (Payments) — FREE

**Time: 15 minutes | Cost: $0 setup (2.9% + 30¢ per transaction)**

1. Go to **stripe.com** → Create account
2. Complete business verification
3. Go to **Products** → Create 4 products:

   **Basic Monthly:**
   - Product name: "PromptAura Basic"
   - Price: $9.99/month (recurring)
   - Save the Price ID as `STRIPE_PRICE_BASIC_MONTHLY`

   **Basic Annual:**
   - Price: $83.88/year (= $6.99/mo, 30% off)
   - Save as `STRIPE_PRICE_BASIC_ANNUAL`

   **Premium Monthly:**
   - Product name: "PromptAura Premium"
   - Price: $24.99/month
   - Save as `STRIPE_PRICE_PREMIUM_MONTHLY`

   **Premium Annual:**
   - Price: $209.88/year (= $17.49/mo, 30% off)
   - Save as `STRIPE_PRICE_PREMIUM_ANNUAL`

4. Go to **Developers → API Keys** → Copy Secret Key
5. Go to **Developers → Webhooks** → Add endpoint:
   - URL: `https://api.promptaura.io/api/v1/stripe/webhook`
   - Events to listen:
     - `checkout.session.completed`
     - `customer.subscription.deleted`
     - `invoice.payment_failed`
   - Copy Signing Secret as `STRIPE_WEBHOOK_SECRET`

---

## ⚡ STEP 3: Deploy Backend API — FREE

**Time: 10 minutes | Cost: $0 (Railway free tier)**

### Option A: Railway (Recommended - Free $5/month credit)
1. Go to **railway.app** → Sign up with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub repo containing the `backend/` folder
4. Add environment variables:
   - Click "Variables" → Add all from `.env.example`
5. Railway auto-deploys → you get URL like `promptaura-api.up.railway.app`
6. Set `RAILWAY_URL` = `https://promptaura-api.up.railway.app`

### Option B: Render.com (Free 750 hours/month)
1. Go to **render.com** → Sign up
2. New Web Service → Connect GitHub
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Add environment variables
6. Deploy → get URL like `promptaura-api.onrender.com`

### Custom Domain for API:
- Buy `promptaura.io` on **Namecheap** (~$12/year)
- Add subdomain `api.promptaura.io` pointing to your Railway/Render URL

---

## 🌐 STEP 4: Deploy Website — FREE

**Time: 5 minutes | Cost: $0 (Vercel free)**

1. Go to **vercel.com** → Sign up with GitHub
2. Import your repo
3. Vercel auto-detects the HTML file → deploys instantly
4. Add custom domain `promptaura.io` in Vercel settings
5. Point your domain's DNS to Vercel

---

## 🔌 STEP 5: Publish Chrome Extension — ONE-TIME $5

**Time: 30 minutes | Cost: $5 (one-time Chrome Web Store fee)**

1. **Package the extension:**
   ```bash
   # Zip the extension folder (must include icons)
   cd extension
   zip -r promptaura-extension-v1.0.zip .
   ```

2. **Create icons** (required sizes: 16, 32, 48, 128px)
   - Use any free icon tool or Canva
   - Save as PNG files in `extension/icons/` folder

3. **Submit to Chrome Web Store:**
   - Go to **chrome.google.com/webstore/devconsole**
   - Pay $5 one-time developer fee
   - Upload your zip file
   - Fill in store listing (description, screenshots)
   - Submit for review (~3-7 business days)

4. **Submit to Firefox Add-ons (FREE):**
   - Go to **addons.mozilla.org/developers**
   - Submit the same zip (minor manifest adjustments needed)

5. **Update the extension ID** in your Supabase auth redirect URLs

---

## 🔗 STEP 6: Connect Everything

Update these values after setup:
```
content.js line 12: const PROMPTAURA_API = "https://api.promptaura.io/v1";
background.js line 9: const API_BASE = "https://api.promptaura.io/v1";
```

In your website's HTML, update:
```
All "promptaura.io" references with your actual domain
Stripe publishable key
Supabase URL and anon key
```

---

## 💰 HOW YOU MAKE MONEY

### Revenue Model:
```
FREE users:    $0/month (50 prompts — gets them hooked)
BASIC users:   $9.99/month × users
PREMIUM users: $24.99/month × users
Your AI cost:  $0 (users provide own API keys)
Infrastructure: ~$0-12/year (all free tiers)
```

### Revenue Projections:
| Users (Basic) | Users (Premium) | Monthly Revenue |
|--------------|-----------------|-----------------|
| 50           | 10              | $749.40         |
| 200          | 50              | $3,247          |
| 500          | 100             | $7,494          |
| 1,000        | 250             | $16,237         |
| 5,000        | 1,000           | $74,940         |

### Growth Strategy:
1. **Post on Reddit** (r/ChatGPT, r/MachineLearning, r/productivity) — FREE
2. **Product Hunt launch** — FREE
3. **Twitter/X posts** showing the neural animation (it's viral-worthy!) — FREE
4. **YouTube demo** of the blue neural ray effect — FREE
5. **AI tool directories** (There's An AI For That, Futurepedia) — FREE
6. **Chrome Web Store** organic discovery — FREE

---

## 🛡️ SECURITY CHECKLIST

- [ ] Never store user API keys in your database (store encrypted or let extension handle locally)
- [ ] Use HTTPS everywhere (Vercel/Railway handle this automatically)
- [ ] Rate limit all API endpoints ✅ (already done in server.js)
- [ ] Validate all user inputs ✅ (done in server.js)
- [ ] Use Row Level Security in Supabase ✅ (done in schema.sql)
- [ ] Add CAPTCHA to signup form (hCaptcha - free)
- [ ] Monitor with Sentry (free tier) for error tracking

---

## 📊 MONITORING (All Free)

- **Vercel Analytics** — website traffic (free)
- **Railway/Render logs** — API logs (built-in)
- **Supabase Dashboard** — database queries & users
- **Stripe Dashboard** — revenue, subscriptions, churn
- **Sentry.io** — error tracking (free 5k errors/month)

---

## 🔑 CREDENTIALS SUMMARY

After following all steps, you'll have accounts on:

| Service | Purpose | Cost | URL |
|---------|---------|------|-----|
| GitHub | Code hosting | FREE | github.com |
| Supabase | Database + Auth | FREE | supabase.com |
| Stripe | Payments | FREE setup | stripe.com |
| Vercel | Website hosting | FREE | vercel.com |
| Railway | API hosting | FREE | railway.app |
| Chrome Web Store | Extension | $5 once | chrome.google.com/webstore/devconsole |
| Namecheap | Domain | ~$12/year | namecheap.com |

**Total upfront cost: $17 (domain + Chrome fee)**
**Monthly cost: $0**
**Revenue potential: Unlimited** 🚀

---

## 📧 SUPPORT EMAIL TEMPLATE

Set up a free email at **Zoho Mail** or **Gmail** for:
- `support@promptaura.io`
- `hello@promptaura.io`

---

## 🎨 BRANDING ASSETS NEEDED

Create these for free on **Canva.com**:
- Logo (SVG + PNG)
- Extension icons (16, 32, 48, 128px)
- Social media preview image (1200×630px)
- Chrome Web Store screenshots (1280×800px)

---

## 📝 LEGAL PAGES TO ADD

Use **termly.io** (free) to generate:
- Privacy Policy
- Terms of Service
- Cookie Policy

---

## 🔮 FUTURE FEATURES TO BUILD

After launch and first revenue:
1. **Team workspaces** (Premium++)
2. **Custom AI personas** marketplace
3. **PromptAura API** for developers
4. **Mobile app** (React Native)
5. **Slack/Teams integration**
6. **White-label licensing** for enterprises

---

*PromptAura — Built to change how humans talk to AI* ⚡
