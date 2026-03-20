/**
 * PromptAura - Background Service Worker
 * Handles: API routing, auth token refresh, usage tracking, message passing
 */

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const API_BASE = "https://api.promptaura.io/v1";

// ─────────────────────────────────────────────
//  MESSAGE HANDLER from content scripts
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "trackUsage":
      trackUsage(message.platform, sender.tab?.id);
      sendResponse({ success: true });
      break;

    case "refreshToken":
      refreshAuthToken().then(sendResponse);
      return true; // async

    case "getUsageStats":
      getUsageStats().then(sendResponse);
      return true;

    case "enhancePrompt":
      handleEnhancePrompt(message.data).then(sendResponse);
      return true;

    case "openDashboard":
      chrome.tabs.create({ url: "https://promptaura.io/dashboard" });
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: "Unknown action" });
  }
});

// ─────────────────────────────────────────────
//  TRACK USAGE
// ─────────────────────────────────────────────
async function trackUsage(platform, tabId) {
  const data = await chrome.storage.sync.get(["usageCount", "usageResetDate", "promptauraToken"]);

  let count = data.usageCount || 0;
  const today = new Date().toISOString().split("T")[0];
  const resetDate = data.usageResetDate || today;

  // Reset monthly if needed (approximate)
  const resetMonthYear = resetDate.substring(0, 7);
  const todayMonthYear = today.substring(0, 7);
  if (resetMonthYear !== todayMonthYear) {
    count = 0;
    await chrome.storage.sync.set({ usageResetDate: today });
  }

  count++;
  await chrome.storage.sync.set({ usageCount: count });

  // Sync with server if authenticated
  if (data.promptauraToken) {
    try {
      await fetch(`${API_BASE}/usage/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.promptauraToken}`,
        },
        body: JSON.stringify({ platform, timestamp: new Date().toISOString() }),
      });
    } catch (e) {
      // Silently fail - track locally
    }
  }
}

// ─────────────────────────────────────────────
//  REFRESH AUTH TOKEN
// ─────────────────────────────────────────────
async function refreshAuthToken() {
  try {
    const data = await chrome.storage.sync.get(["refreshToken"]);
    if (!data.refreshToken) return { success: false };

    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: data.refreshToken }),
    });

    if (response.ok) {
      const result = await response.json();
      await chrome.storage.sync.set({
        promptauraToken: result.accessToken,
        plan: result.plan,
      });
      return { success: true, plan: result.plan };
    }
    return { success: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
//  GET USAGE STATS
// ─────────────────────────────────────────────
async function getUsageStats() {
  const data = await chrome.storage.sync.get([
    "usageCount", "plan", "promptauraToken"
  ]);
  
  const planLimits = { free: 50, basic: 500, premium: -1 };
  const limit = planLimits[data.plan || "free"];

  return {
    used: data.usageCount || 0,
    limit,
    plan: data.plan || "free",
    unlimited: limit === -1,
  };
}

// ─────────────────────────────────────────────
//  HANDLE ENHANCE PROMPT (via background for CORS bypass if needed)
// ─────────────────────────────────────────────
async function handleEnhancePrompt(data) {
  try {
    const settings = await chrome.storage.sync.get(["promptauraToken"]);
    const response = await fetch(`${API_BASE}/enhance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.promptauraToken}`,
      },
      body: JSON.stringify(data),
    });

    if (response.ok) return await response.json();
    const err = await response.json();
    return { success: false, error: err.message };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
//  INSTALLATION HANDLER
// ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Open welcome/onboarding page
    chrome.tabs.create({ url: "https://promptaura.io/welcome?source=extension" });
  }
  if (details.reason === "update") {
    // Silently update
    console.log("[PromptAura] Updated to", chrome.runtime.getManifest().version);
  }
});

// ─────────────────────────────────────────────
//  PERIODIC TOKEN REFRESH (every 30 min)
// ─────────────────────────────────────────────
chrome.alarms.create("tokenRefresh", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tokenRefresh") {
    refreshAuthToken();
  }
});
