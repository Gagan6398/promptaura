/**
 * PromptAura - Content Script
 * Injected into supported AI platforms (ChatGPT, Gemini, Claude, etc.)
 * Handles: Floating button, Neural ray animation, Prompt interception & enhancement
 */

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  //  CONSTANTS & CONFIG
  // ─────────────────────────────────────────────
  const PROMPTAURA_API = "https://api.promptaura.io/v1"; // Your backend
  const SUPPORTED_PLATFORMS = {
    "chat.openai.com": "chatgpt",
    "chatgpt.com": "chatgpt",
    "gemini.google.com": "gemini",
    "claude.ai": "claude",
    "bing.com": "bing",
  };

  // Platform-specific selectors for prompt input & submit
  const PLATFORM_SELECTORS = {
    chatgpt: {
      input: "#prompt-textarea, [data-id='root'] textarea, div[contenteditable='true']",
      submit: "button[data-testid='send-button'], button[aria-label='Send prompt']",
      response: ".markdown.prose, [data-message-author-role='assistant']",
    },
    gemini: {
      input: "rich-textarea .ql-editor, textarea[placeholder]",
      submit: "button[aria-label='Send message'], .send-button",
      response: ".model-response-text, .response-content",
    },
    claude: {
      input: 'div[contenteditable="true"].ProseMirror',
      submit: 'button[aria-label="Send Message"]',
      response: ".prose, [data-testid='assistant-message']",
    },
    bing: {
      input: "#searchbox, textarea[name='q']",
      submit: "button#search-icon-legacy",
      response: ".ac-container",
    },
  };

  let platform = SUPPORTED_PLATFORMS[window.location.hostname];
  let isActive = false;
  let userSettings = {};
  let auraButton = null;
  let isEnhancing = false;

  // ─────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────
  async function init() {
    userSettings = await getSettings();
    if (!userSettings.enabled) return;

    injectStyles();
    createNeuralCanvas();
    createAuraButton();
    attachPromptInterceptor();

    console.log("[PromptAura] Activated on", platform);
  }

  // ─────────────────────────────────────────────
  //  SETTINGS FROM CHROME STORAGE
  // ─────────────────────────────────────────────
  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          enabled: true,
          apiKey: "",
          plan: "free",
          humorLevel: 50,
          detailLevel: 70,
          formalityLevel: 40,
          autoEnhance: false,
          platforms: {
            chatgpt: true,
            gemini: true,
            claude: true,
            bing: false,
          },
          promptauraToken: "",
        },
        resolve
      );
    });
  }

  // ─────────────────────────────────────────────
  //  INJECT STYLES
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("promptaura-styles")) return;
    const link = document.createElement("link");
    link.id = "promptaura-styles";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("content.css");
    document.head.appendChild(link);
  }

  // ─────────────────────────────────────────────
  //  CREATE NEURAL CANVAS (for the ray animation)
  // ─────────────────────────────────────────────
  function createNeuralCanvas() {
    if (document.getElementById("promptaura-canvas")) return;

    const canvas = document.createElement("canvas");
    canvas.id = "promptaura-canvas";
    canvas.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 999998;
      opacity: 0;
      transition: opacity 0.15s ease;
    `;
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }

  // ─────────────────────────────────────────────
  //  THE SIGNATURE NEURAL RAY BURST ANIMATION
  // ─────────────────────────────────────────────
  function triggerNeuralRayBurst(originX, originY) {
    const canvas = document.getElementById("promptaura-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    canvas.style.opacity = "1";

    const W = canvas.width;
    const H = canvas.height;
    const cx = originX || W / 2;
    const cy = originY || H / 2;

    // Particle system
    const particles = [];
    const nodes = [];
    const numRays = 60;
    const numNodes = 80;
    let frame = 0;
    const totalFrames = 72; // ~1.2s at 60fps

    // Create ray particles
    for (let i = 0; i < numRays; i++) {
      const angle = (Math.PI * 2 * i) / numRays + Math.random() * 0.2;
      const speed = 8 + Math.random() * 18;
      particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        size: 1.5 + Math.random() * 3,
        trail: [],
        color: Math.random() > 0.3 ? "#00d4ff" : "#7c3aed",
      });
    }

    // Create random nodes across screen
    for (let i = 0; i < numNodes; i++) {
      nodes.push({
        x: Math.random() * W,
        y: Math.random() * H,
        activated: false,
        alpha: 0,
        pulseRadius: 0,
      });
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const progress = frame / totalFrames;

      // Screen flash
      const flashAlpha = progress < 0.1 ? progress * 8 : (1 - progress) * 0.15;
      ctx.fillStyle = `rgba(0, 212, 255, ${Math.max(0, flashAlpha * 0.08)})`;
      ctx.fillRect(0, 0, W, H);

      // Update and draw particles
      particles.forEach((p) => {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 12) p.trail.shift();

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.alpha = Math.max(0, 1 - progress * 1.3);

        // Draw trail
        p.trail.forEach((t, ti) => {
          const trailAlpha = (ti / p.trail.length) * p.alpha * 0.6;
          ctx.beginPath();
          ctx.arc(t.x, t.y, p.size * 0.6, 0, Math.PI * 2);
          ctx.fillStyle = p.color.replace(")", `, ${trailAlpha})`).replace("rgb", "rgba");
          ctx.fill();
        });

        // Draw particle head
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Glow
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 6);
        grd.addColorStop(0, `rgba(0, 212, 255, ${p.alpha * 0.4})`);
        grd.addColorStop(1, "rgba(0, 212, 255, 0)");
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 6, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();

        // Activate nearby nodes
        nodes.forEach((n) => {
          if (!n.activated) {
            const dist = Math.hypot(p.x - n.x, p.y - n.y);
            if (dist < 40) {
              n.activated = true;
              n.alpha = 1;
            }
          }
        });
      });

      // Draw connections between close nodes
      ctx.lineWidth = 0.8;
      nodes.forEach((n, i) => {
        if (!n.activated) return;
        n.alpha = Math.max(0, n.alpha - 0.015);
        n.pulseRadius += 1.5;

        // Node dot
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 255, ${n.alpha})`;
        ctx.fill();

        // Pulse ring
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 212, 255, ${n.alpha * 0.3})`;
        ctx.stroke();

        // Connection lines to nearby nodes
        nodes.slice(i + 1).forEach((n2) => {
          if (!n2.activated) return;
          const dist = Math.hypot(n.x - n2.x, n.y - n2.y);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.strokeStyle = `rgba(0, 212, 255, ${n.alpha * n2.alpha * 0.2 * (1 - dist / 150)})`;
            ctx.stroke();
          }
        });
      });

      // Central burst ring
      const ringRadius = progress * Math.max(W, H) * 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 212, 255, ${Math.max(0, (1 - progress) * 0.6)})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      frame++;
      if (frame < totalFrames) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, W, H);
        canvas.style.opacity = "0";
      }
    }

    requestAnimationFrame(draw);
  }

  // ─────────────────────────────────────────────
  //  CREATE FLOATING AURA BUTTON
  // ─────────────────────────────────────────────
  function createAuraButton() {
    if (document.getElementById("promptaura-btn")) return;

    const btn = document.createElement("div");
    btn.id = "promptaura-btn";
    btn.innerHTML = `
      <div class="aura-pulse-ring"></div>
      <div class="aura-pulse-ring delay"></div>
      <div class="aura-btn-inner">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="2" fill="#00d4ff"/>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="#00d4ff" stroke-width="1.5" fill="none" opacity="0.3"/>
          <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="#00d4ff" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="12" cy="4" r="1.5" fill="#00d4ff" opacity="0.6"/>
          <circle cx="12" cy="20" r="1.5" fill="#00d4ff" opacity="0.6"/>
          <circle cx="4" cy="12" r="1.5" fill="#00d4ff" opacity="0.6"/>
          <circle cx="20" cy="12" r="1.5" fill="#00d4ff" opacity="0.6"/>
        </svg>
      </div>
      <div class="aura-tooltip">Enhance with PromptAura ⚡</div>
    `;
    document.body.appendChild(btn);
    auraButton = btn;

    // Click handler
    btn.addEventListener("click", handleAuraButtonClick);

    // Drag to reposition
    makeDraggable(btn);
  }

  // ─────────────────────────────────────────────
  //  HANDLE AURA BUTTON CLICK
  // ─────────────────────────────────────────────
  async function handleAuraButtonClick(e) {
    e.stopPropagation();
    if (isEnhancing) return;

    const rect = auraButton.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // 🔵 TRIGGER THE NEURAL RAY ANIMATION
    triggerNeuralRayBurst(cx, cy);

    // Add loading state to button
    auraButton.classList.add("enhancing");

    // Check if user is logged in and has valid subscription
    const settings = await getSettings();
    if (!settings.promptauraToken) {
      showToast("⚡ Sign in to PromptAura to start enhancing!", "info", true);
      auraButton.classList.remove("enhancing");
      return;
    }

    isEnhancing = true;

    try {
      // Get current prompt from input
      const selectors = PLATFORM_SELECTORS[platform];
      const inputEl = document.querySelector(selectors.input);

      if (!inputEl) {
        showToast("❌ Could not find prompt input. Please type something first.", "error");
        return;
      }

      const originalPrompt = getInputValue(inputEl);
      if (!originalPrompt || originalPrompt.trim().length < 3) {
        showToast("✍️ Please type a prompt first, then click PromptAura!", "info");
        return;
      }

      showToast("🧠 PromptAura is enhancing your prompt...", "loading");

      // Enhance the prompt via PromptAura API
      const enhanced = await enhancePrompt(originalPrompt, settings);

      if (enhanced.success) {
        // Replace the input content with enhanced prompt
        setInputValue(inputEl, enhanced.enhancedPrompt);

        showToast("✅ Prompt enhanced! Submit to get a supercharged response.", "success");

        // Auto-submit if setting is enabled
        if (settings.autoEnhance) {
          setTimeout(() => {
            const submitBtn = document.querySelector(selectors.submit);
            if (submitBtn) submitBtn.click();

            // After response, post-process it
            setTimeout(() => postProcessResponse(enhanced, settings), 3000);
          }, 500);
        }

        // Track usage
        chrome.runtime.sendMessage({ action: "trackUsage", platform });
      } else {
        showToast("❌ " + (enhanced.error || "Enhancement failed"), "error");
      }
    } catch (err) {
      console.error("[PromptAura]", err);
      showToast("❌ Something went wrong. Check your connection.", "error");
    } finally {
      isEnhancing = false;
      auraButton.classList.remove("enhancing");
    }
  }

  // ─────────────────────────────────────────────
  //  PROMPT ENHANCEMENT VIA API
  // ─────────────────────────────────────────────
  async function enhancePrompt(originalPrompt, settings) {
    try {
      const response = await fetch(`${PROMPTAURA_API}/enhance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.promptauraToken}`,
        },
        body: JSON.stringify({
          prompt: originalPrompt,
          platform: platform,
          settings: {
            humorLevel: settings.humorLevel,
            detailLevel: settings.detailLevel,
            formalityLevel: settings.formalityLevel,
            userApiKey: settings.apiKey, // User's own OpenAI/Gemini key
          },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        return { success: false, error: err.message };
      }

      return await response.json();
    } catch (err) {
      return { success: false, error: "Network error" };
    }
  }

  // ─────────────────────────────────────────────
  //  POST-PROCESS RESPONSE (add sources, images, etc.)
  // ─────────────────────────────────────────────
  async function postProcessResponse(enhancedData, settings) {
    const selectors = PLATFORM_SELECTORS[platform];
    const responseElements = document.querySelectorAll(selectors.response);

    if (!responseElements.length) return;

    const lastResponse = responseElements[responseElements.length - 1];

    // Inject the enhanced metadata panel
    if (enhancedData.sources || enhancedData.images || enhancedData.relatedDocs) {
      const panel = createMetadataPanel(enhancedData);
      lastResponse.appendChild(panel);
    }
  }

  // ─────────────────────────────────────────────
  //  METADATA PANEL (Sources, Images, Docs)
  // ─────────────────────────────────────────────
  function createMetadataPanel(data) {
    const panel = document.createElement("div");
    panel.className = "promptaura-meta-panel";
    panel.innerHTML = `
      <div class="promptaura-meta-header">
        <span class="promptaura-logo-small">⚡ PromptAura Enhanced</span>
        <button class="promptaura-meta-toggle" onclick="this.parentElement.parentElement.querySelector('.promptaura-meta-content').classList.toggle('collapsed')">▼</button>
      </div>
      <div class="promptaura-meta-content">
        ${
          data.sources
            ? `
          <div class="promptaura-section">
            <h4>🔗 Sources</h4>
            <ul>${data.sources.map((s) => `<li><a href="${s.url}" target="_blank">${s.title}</a></li>`).join("")}</ul>
          </div>`
            : ""
        }
        ${
          data.images
            ? `
          <div class="promptaura-section">
            <h4>🖼️ Related Images</h4>
            <div class="promptaura-images">${data.images.map((img) => `<img src="${img.url}" alt="${img.alt}" title="${img.alt}" />`).join("")}</div>
          </div>`
            : ""
        }
        ${
          data.relatedDocs
            ? `
          <div class="promptaura-section">
            <h4>📚 Documentation</h4>
            <ul>${data.relatedDocs.map((d) => `<li><a href="${d.url}" target="_blank">${d.title}</a></li>`).join("")}</ul>
          </div>`
            : ""
        }
        ${
          data.followUps
            ? `
          <div class="promptaura-section">
            <h4>💡 Smart Follow-ups</h4>
            <div class="promptaura-followups">${data.followUps.map((q) => `<button class="promptaura-followup-btn" onclick="promptaura_askFollowup('${q}')">${q}</button>`).join("")}</div>
          </div>`
            : ""
        }
      </div>
    `;
    return panel;
  }

  // ─────────────────────────────────────────────
  //  PROMPT INTERCEPTOR (for auto-enhance mode)
  // ─────────────────────────────────────────────
  function attachPromptInterceptor() {
    document.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" && !e.shiftKey) && userSettings.autoEnhance) {
        const selectors = PLATFORM_SELECTORS[platform];
        const inputEl = document.querySelector(selectors.input);
        if (document.activeElement === inputEl || inputEl?.contains(document.activeElement)) {
          e.preventDefault();
          handleAuraButtonClick(e);
        }
      }
    });
  }

  // ─────────────────────────────────────────────
  //  UTILITY: Get / Set Input Value
  // ─────────────────────────────────────────────
  function getInputValue(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.innerText || el.textContent;
  }

  function setInputValue(el, value) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )?.set || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        el.value = value;
      }
    } else {
      el.innerText = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  // ─────────────────────────────────────────────
  //  TOAST NOTIFICATIONS
  // ─────────────────────────────────────────────
  function showToast(message, type = "info", hasAction = false) {
    const existing = document.getElementById("promptaura-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "promptaura-toast";
    toast.className = `promptaura-toast promptaura-toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      ${hasAction ? `<a href="https://promptaura.io/login" target="_blank" class="promptaura-toast-action">Sign In →</a>` : ""}
    `;
    document.body.appendChild(toast);

    // Auto-dismiss
    if (type !== "loading") {
      setTimeout(() => toast.remove(), 4000);
    }
  }

  // ─────────────────────────────────────────────
  //  MAKE ELEMENT DRAGGABLE
  // ─────────────────────────────────────────────
  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, origX, origY;

    el.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("aura-btn-inner") || e.target.closest(".aura-btn-inner")) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = el.getBoundingClientRect();
        origX = rect.left;
        origY = rect.top;
        el.style.transition = "none";
        e.preventDefault();
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = `${origX + dx}px`;
      el.style.top = `${origY + dy}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        el.style.transition = "";
        // Save position
        chrome.storage.sync.set({
          btnPosition: { left: el.style.left, top: el.style.top },
        });
      }
    });
  }

  // ─────────────────────────────────────────────
  //  FOLLOW-UP HANDLER (global for HTML onclick)
  // ─────────────────────────────────────────────
  window.promptaura_askFollowup = function (question) {
    const selectors = PLATFORM_SELECTORS[platform];
    const inputEl = document.querySelector(selectors.input);
    if (inputEl) {
      setInputValue(inputEl, question);
      inputEl.focus();
      showToast("✍️ Follow-up loaded! Click PromptAura to enhance it.", "info");
    }
  };

  // ─────────────────────────────────────────────
  //  START
  // ─────────────────────────────────────────────
  if (platform) {
    // Wait for page to be fully ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      // Delay a bit for SPA pages that load dynamically
      setTimeout(init, 1500);
    }

    // Re-init on navigation (for SPAs)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(init, 1500);
      }
    }).observe(document, { subtree: true, childList: true });
  }
})();
