(() => {
  "use strict";

  const DEMO_SESSION_KEY = "hotel-lumiere-demo-session";
  const REQUEST_TIMEOUT_MS = 30_000;

  const dom = {
    form: document.querySelector("#simulationForm"),
    guestName: document.querySelector("#guestName"),
    language: document.querySelector("#guestLanguage"),
    scenario: document.querySelector("#scenario"),
    isDemo: document.querySelector("#isDemo"),
    chatMessages: document.querySelector("#chatMessages"),
    messageForm: document.querySelector("#messageForm"),
    messageInput: document.querySelector("#messageInput"),
    sendButton: document.querySelector("#sendButton"),
    transcript: document.querySelector("#transcript"),
    inboxName: document.querySelector("#inboxGuestName"),
    inboxContext: document.querySelector("#inboxGuestContext"),
    initials: document.querySelector("#guestInitials"),
    handoffButton: document.querySelector("#handoffButton"),
    handoffStatus: document.querySelector("#handoffStatus"),
    handoffTitle: document.querySelector("#handoff-title"),
    handoffDescription: document.querySelector("#handoffDescription"),
    conversationMode: document.querySelector("#conversationMode"),
    staffAlert: document.querySelector("#staffAlert"),
    staffAlertTitle: document.querySelector("#staffAlertTitle"),
    staffAlertBody: document.querySelector("#staffAlertBody"),
    sheet: document.querySelector("#serviceSheet"),
    backdrop: document.querySelector("#sheetBackdrop"),
    closeSheet: document.querySelector("#closeSheet")
  };

  let session = null;
  let humanHandoff = false;
  let lastFocusedElement = null;
  let activeController = null;

  // Multilingual Hard-coded Meta Pre-Arrival Templates (Bug 1 Fix)
  const PRE_ARRIVAL_TEMPLATES = {
    English: {
      text: (name) => `Bonjour ${name}, your stay at Hôtel Lumière Paris begins in 48 hours. We would be delighted to assist in preparing your arrival. May we arrange a private airport transfer or reserve a table for your first evening?`,
      quickReplies: ["Book Transfer", "View Spa", "Dining Reservations"],
    },
    French: {
      text: (name) => `Bonjour ${name}, votre séjour à l'Hôtel Lumière Paris débute dans 48 heures. Nous serions ravis de préparer votre arrivée. Souhaitez-vous réserver un transfert privé ou une table au restaurant ?`,
      quickReplies: ["Réserver transfert", "Voir le Spa", "Réserver une table"],
    },
    Spanish: {
      text: (name) => `Hola ${name}, su estancia en Hôtel Lumière Paris comienza en 48 horas. Será un placer preparar su llegada. ¿Desea que reservemos un traslado privado o una mesa para cenar?`,
      quickReplies: ["Reservar traslado", "Ver Spa", "Reservar mesa"],
    },
    Japanese: {
      text: (name) => `${name}様、オテル・リュミエール・パリへのお越しを心よりお待ち申し上げております（ご到着まで48時間）。空港送迎やディナーの手配を承りましょうか？`,
      quickReplies: ["送迎を予約", "スパを見る", "ディナー予約"],
    },
  };

  const CHECKOUT_TEMPLATES = {
    English: {
      text: (name) => `Dear ${name}, thank you for staying with us at Hôtel Lumière Paris. We hope you had a pleasant journey. How would you rate your stay with us?`,
      quickReplies: ["Excellent — 5 Stars", "Good", "Speak to Manager"],
    },
    French: {
      text: (name) => `Cher/Chère ${name}, merci d'avoir séjourné à l'Hôtel Lumière Paris. Nous espérons que votre séjour fut remarquable. Comment évaluez-vous votre expérience ?`,
      quickReplies: ["Excellent — 5 Étoiles", "Bien", "Parler au directeur"],
    },
    Spanish: {
      text: (name) => `Estimado/a ${name}, gracias por su estancia en Hôtel Lumière Paris. ¿Cómo calificaría su experiencia con nosotros?`,
      quickReplies: ["Excelente — 5 Estrellas", "Buena", "Hablar con gerente"],
    },
    Japanese: {
      text: (name) => `${name}様、オテル・リュミエール・パリにご宿泊いただき誠にありがとうございました。ご滞在はいかがでしたでしょうか？`,
      quickReplies: ["素晴らしい — 5つ星", "満足", "支配人と話す"],
    },
  };

  function timeNow() {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
  }

  function getDemoSessionId() {
    try {
      const existing = window.sessionStorage.getItem(DEMO_SESSION_KEY);
      if (existing && /^demo_[A-Za-z0-9_-]+$/.test(existing)) return existing;
      const created = `demo_${crypto.randomUUID()}`;
      window.sessionStorage.setItem(DEMO_SESSION_KEY, created);
      return created;
    } catch {
      return `demo_${crypto.randomUUID()}`;
    }
  }

  function configuredDemoEndpoint() {
    const explicit = String(window.CONCIERGE_DEMO_ENDPOINT || "").trim();
    if (explicit) return explicit;
    const chatEndpoint = String(window.CONCIERGE_WEBHOOK_URL || "").trim();
    return chatEndpoint.replace(/\/api\/chat(?:\?.*)?$/i, "/api/demo-chat");
  }

  function initialsFor(name) {
    return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "G";
  }

  function scenarioLabel() {
    return dom.scenario.options[dom.scenario.selectedIndex].text;
  }

  function clearChildren(element) {
    element.replaceChildren();
  }

  function addTranscript(actor, text, type) {
    const item = document.createElement("li");
    item.className = `transcript-entry transcript-entry--${type}`;
    const meta = document.createElement("div");
    meta.className = "transcript-meta";
    meta.textContent = `${timeNow()} · ${actor}`;
    const body = document.createElement("div");
    body.className = "transcript-text";
    body.textContent = text;
    item.append(meta, body);
    dom.transcript.append(item);
    dom.transcript.scrollTop = dom.transcript.scrollHeight;
  }

  function buildActionButton(label, className, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset.action = action;
    return button;
  }

  function showToast(message) {
    let toast = document.querySelector(".demo-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "demo-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    if (toast.dataset.timeoutId) {
      window.clearTimeout(Number(toast.dataset.timeoutId));
    }
    const timeoutId = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2600);
    toast.dataset.timeoutId = String(timeoutId);
  }

  // Render WhatsApp chat bubble with optional rich media (Bug 2 Fix)
  function addMessage({ sender, text, quickReplies = [], listMessage = false, media = null }) {
    const message = document.createElement("article");
    message.className = `message message--${sender}`;

    // Render Rich Media Attachment Card if present
    if (media && typeof media === "object") {
      if (media.type === "document" || media.format === "PDF") {
        const fileUrl = media.url || "Lumiere_Spa_Wellness_Menu.pdf";
        const fileName = media.filename || "Lumiere_Spa_Wellness_Menu.pdf";

        const docCard = document.createElement("a");
        docCard.className = "message-media-doc";
        docCard.href = fileUrl;
        docCard.download = fileName;
        docCard.target = "_blank";
        docCard.rel = "noopener noreferrer";
        docCard.setAttribute("role", "group");
        docCard.setAttribute("aria-label", `Download ${media.title || fileName}`);

        const docIcon = document.createElement("div");
        docIcon.className = "media-doc-icon";
        docIcon.textContent = media.format || "PDF";
        docIcon.setAttribute("aria-hidden", "true");

        const docInfo = document.createElement("div");
        docInfo.className = "media-doc-info";

        const docTitle = document.createElement("div");
        docTitle.className = "media-doc-title";
        docTitle.textContent = media.title || fileName;

        const docMeta = document.createElement("div");
        docMeta.className = "media-doc-meta";
        docMeta.textContent = `${media.format || "PDF"} · ${media.size || "2.4 MB"}${media.pages ? ` · ${media.pages}` : ""}`;

        docInfo.append(docTitle, docMeta);

        const docBtn = document.createElement("span");
        docBtn.className = "media-doc-action";
        docBtn.title = "Download Document";
        docBtn.setAttribute("aria-label", "Download Document");
        docBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>`;

        docCard.append(docIcon, docInfo, docBtn);
        docCard.addEventListener("click", () => {
          addTranscript("Document Download", `Downloaded: ${media.title || fileName}`, "ai");
        });
        message.append(docCard);
      } else if (media.type === "image" || media.url || media.thumbnail) {
        const imgCard = document.createElement("div");
        imgCard.className = "message-media-image";
        const img = document.createElement("img");
        img.src = media.url || media.thumbnail;
        img.alt = media.title || "Attached Media";
        img.loading = "lazy";
        imgCard.append(img);
        message.append(imgCard);
      }
    }

    if (text) {
      const body = document.createElement("p");
      body.textContent = text;
      message.append(body);
    }

    if (sender === "ai" && (quickReplies.length || listMessage)) {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      quickReplies.slice(0, 3).forEach((reply) => actions.append(buildActionButton(reply, "quick-reply", "quick-reply")));
      if (listMessage) actions.append(buildActionButton("View Services", "list-message", "view-services"));
      message.append(actions);
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = timeNow();
    message.append(meta);
    dom.chatMessages.append(message);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    addTranscript(sender === "guest" ? "Guest" : "AI Concierge", text || "[Media Attachment]", sender === "guest" ? "guest" : "ai");
  }

  function addChatChrome() {
    const date = document.createElement("p");
    date.className = "chat-date";
    date.textContent = "Today";
    const notice = document.createElement("p");
    notice.className = "chat-encryption";
    notice.textContent = "Demo session · replies are generated by the concierge service.";
    dom.chatMessages.append(date, notice);
  }

  function addTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.setAttribute("aria-label", "AI Concierge is typing");
    indicator.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
    dom.chatMessages.append(indicator);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    return indicator;
  }

  function setBusy(isBusy) {
    dom.messageInput.disabled = isBusy;
    dom.sendButton.disabled = isBusy;
  }

  function setOwnerStatus({ human }) {
    dom.handoffStatus.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    dom.handoffStatus.append(dot, human ? " Human active" : " Active");
  }

  function updateGuestSummary() {
    dom.inboxName.textContent = session.name;
    dom.inboxContext.textContent = `${session.language} · ${scenarioLabel()}`;
    dom.initials.textContent = initialsFor(session.name);
  }

  function resetHandoff() {
    humanHandoff = false;
    dom.handoffButton.classList.remove("is-human");
    dom.handoffButton.textContent = "Take over chat";
    dom.handoffButton.setAttribute("aria-pressed", "false");
    dom.handoffStatus.classList.remove("is-human");
    setOwnerStatus({ human: false });
    dom.handoffTitle.textContent = "AI Concierge";
    dom.handoffDescription.textContent = "AI replies are enabled for this simulation.";
    dom.conversationMode.classList.remove("is-human");
    dom.conversationMode.textContent = "AI active";
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = "online";
  }

  // Trigger Human Handoff (Escape Hatch / Sentiment Override Reaction - Bug 3 Fix)
  function triggerEscalationHandoff(reason = "Guest requested manager / severe complaint") {
    humanHandoff = true;
    dom.handoffButton.classList.add("is-human");
    dom.handoffButton.textContent = "Resume AI Concierge";
    dom.handoffButton.setAttribute("aria-pressed", "true");
    dom.handoffStatus.classList.add("is-human");
    setOwnerStatus({ human: true });
    dom.handoffTitle.textContent = "Duty Manager Escalation";
    dom.handoffDescription.textContent = "Human Agent Active — AI Paused. Automated replies suspended due to guest escalation.";
    dom.conversationMode.classList.add("is-human");
    dom.conversationMode.textContent = "Human active";
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = "Human Staff Active";

    renderStaffAlerts([{
      role: "Duty Manager / Front Desk",
      summary: `URGENT: ${reason}`,
    }]);

    addTranscript("URGENT ESCALATION", `⚠️ ${reason}. AI automatically suspended. Front Desk Duty Manager notified.`, "human");
  }

  function hideStaffAlert() {
    dom.staffAlert.hidden = true;
    dom.staffAlertTitle.textContent = "Reception follow-up";
    dom.staffAlertBody.textContent = "";
  }

  function renderStaffAlerts(alerts) {
    if (!Array.isArray(alerts) || !alerts.length) return;
    const alert = alerts[0];
    dom.staffAlert.hidden = false;
    dom.staffAlertTitle.textContent = `${alert.role || "Reception"} notified`;
    dom.staffAlertBody.textContent = alert.summary || "A concierge request was created for team follow-up.";
    addTranscript("Staff alert", `${alert.role || "Reception"}: ${alert.summary || "New concierge request."}`, "human");
  }

  function disableMessageActions(button) {
    button.closest(".message-actions")?.querySelectorAll("button").forEach((actionButton) => { actionButton.disabled = true; });
  }

  function partnerQuickReplies(result) {
    return (Array.isArray(result.partner_offers) ? result.partner_offers : [])
      .map((offer) => String(offer?.name || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  // Launch simulation logic (Bug 1 Fix)
  function launchSimulation() {
    activeController?.abort();
    activeController = null;
    session = {
      id: getDemoSessionId(),
      name: dom.guestName.value.trim() || "Guest",
      language: dom.language.value,
      scenario: dom.scenario.value,
      isDemo: dom.isDemo.value === "true",
      chatHistory: []
    };
    resetHandoff();
    hideStaffAlert();
    updateGuestSummary();
    clearChildren(dom.chatMessages);
    clearChildren(dom.transcript);
    addChatChrome();
    addTranscript("System", `Demo session launched for ${session.name} [Scenario: ${scenarioLabel()}, Language: ${session.language}]. Airtable isolation enabled.`, "ai");
    setBusy(false);

    // Bug 1: Hard-coded Meta Pre-Arrival Template immediately injected upon Launch
    if (session.scenario === "pre-arrival") {
      const templateData = PRE_ARRIVAL_TEMPLATES[session.language] || PRE_ARRIVAL_TEMPLATES.English;
      const templateText = templateData.text(session.name);
      session.chatHistory.push({ role: "assistant", content: templateText });
      addMessage({
        sender: "ai",
        text: templateText,
        quickReplies: templateData.quickReplies,
        listMessage: true,
      });
      addTranscript("Meta Template", `Automated 48h pre-arrival template delivered to ${session.name}.`, "ai");
    } else if (session.scenario === "checkout") {
      const checkoutData = CHECKOUT_TEMPLATES[session.language] || CHECKOUT_TEMPLATES.English;
      const checkoutText = checkoutData.text(session.name);
      session.chatHistory.push({ role: "assistant", content: checkoutText });
      addMessage({
        sender: "ai",
        text: checkoutText,
        quickReplies: checkoutData.quickReplies,
        listMessage: false,
      });
      addTranscript("Meta Template", `Automated checkout review template delivered to ${session.name}.`, "ai");
    }
  }

  async function requestConciergeReply() {
    const endpoint = configuredDemoEndpoint();
    if (!endpoint) throw new Error("The demo chat endpoint is not configured.");
    const typing = addTypingIndicator();
    const controller = new AbortController();
    activeController = controller;
    setBusy(true);
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          guestName: session.name,
          language: session.language,
          scenario: session.scenario,
          is_demo: true,
          sessionId: session.id,
          chatHistory: session.chatHistory.map((item) => ({ role: item.role, content: item.content }))
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `The concierge service returned ${response.status}.`);
      const reply = String(result.reply || "").trim();
      if (!reply) throw new Error("The concierge service returned an empty reply.");
      session.chatHistory.push({ role: "assistant", content: reply });

      // Bug 2: Rich Media rendering
      const media = result.media || null;
      const quickReplies = (result.quickReplies && result.quickReplies.length) ? result.quickReplies : partnerQuickReplies(result);

      addMessage({
        sender: "ai",
        text: reply,
        quickReplies,
        listMessage: session.scenario !== "checkout",
        media,
      });

      renderStaffAlerts(result.staff_alerts);

      // Bug 3: Escape Hatch / Sentiment Override Reaction
      if (result.escape_hatch_triggered === true || (result.requires_human === true && result.intent === "complaint")) {
        const lastUserMsg = session.chatHistory.filter((m) => m.role === "user").slice(-1)[0]?.content || "Guest escalation";
        triggerEscalationHandoff(`Guest complaint / Manager request: "${lastUserMsg}"`);
      }
    } finally {
      window.clearTimeout(timeout);
      typing.remove();
      if (activeController === controller) activeController = null;
      setBusy(false);
    }
  }

  async function sendGuestMessage(text) {
    const cleanText = text.trim();
    if (!cleanText || !session || activeController) return;
    addMessage({ sender: "guest", text: cleanText });
    session.chatHistory.push({ role: "user", content: cleanText });
    if (humanHandoff) {
      addTranscript("System", "AI response withheld while a receptionist owns this conversation.", "human");
      return;
    }
    try {
      await requestConciergeReply();
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The concierge took too long to respond. Please try again."
        : "The concierge service is unavailable at the moment. Please try again shortly.";
      addMessage({ sender: "ai", text: message });
      addTranscript("System", error instanceof Error ? error.message : "Demo chat request failed.", "human");
    }
  }

  function openServices() {
    lastFocusedElement = document.activeElement;
    dom.backdrop.hidden = false;
    dom.sheet.hidden = false;
    dom.sheet.style.transform = "translateX(-50%) translateY(0)";
    dom.closeSheet.focus();
  }

  function closeServices() {
    dom.sheet.hidden = true;
    dom.backdrop.hidden = true;
    dom.sheet.style.transform = "";
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  // Apple Fluid Motion: 1:1 Gesture Tracking & Momentum Projection for Bottom Sheet (WWDC / Emil Kowalski)
  let isDraggingSheet = false;
  let startY = 0;
  let currentY = 0;
  let moveHistory = [];

  function projectVelocity(initialVelocity, decelerationRate = 0.998) {
    return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
  }

  function initSheetGestures() {
    const sheet = dom.sheet;
    const handle = dom.sheet.querySelector(".sheet-handle") || sheet;

    handle.addEventListener("pointerdown", (e) => {
      if (sheet.hidden) return;
      isDraggingSheet = true;
      startY = e.clientY;
      currentY = 0;
      moveHistory = [{ y: e.clientY, t: performance.now() }];
      handle.setPointerCapture(e.pointerId);
      sheet.style.transition = "none";
    });

    handle.addEventListener("pointermove", (e) => {
      if (!isDraggingSheet) return;
      const deltaY = e.clientY - startY;
      // Rubber-band resistance if dragged upwards past origin
      currentY = deltaY < 0 ? deltaY * 0.3 : deltaY;
      sheet.style.transform = `translateX(-50%) translateY(${currentY}px)`;
      moveHistory.push({ y: e.clientY, t: performance.now() });
      if (moveHistory.length > 5) moveHistory.shift();
    });

    const finishDrag = () => {
      if (!isDraggingSheet) return;
      isDraggingSheet = false;
      sheet.style.transition = "";

      let velocity = 0;
      if (moveHistory.length >= 2) {
        const first = moveHistory[0];
        const last = moveHistory[moveHistory.length - 1];
        const dt = last.t - first.t;
        if (dt > 0) velocity = ((last.y - first.y) / dt) * 1000; // px/s
      }

      const projected = currentY + projectVelocity(velocity);
      if (projected > 120 || currentY > 150) {
        closeServices();
      } else {
        sheet.style.transform = "translateX(-50%) translateY(0)";
      }
    };

    handle.addEventListener("pointerup", finishDrag);
    handle.addEventListener("pointercancel", finishDrag);
  }

  function toggleHandoff() {
    humanHandoff = !humanHandoff;
    dom.handoffButton.classList.toggle("is-human", humanHandoff);
    dom.handoffButton.textContent = humanHandoff ? "Resume AI Concierge" : "Take over chat";
    dom.handoffButton.setAttribute("aria-pressed", String(humanHandoff));
    dom.handoffStatus.classList.toggle("is-human", humanHandoff);
    setOwnerStatus({ human: humanHandoff });
    dom.handoffTitle.textContent = humanHandoff ? "Human receptionist" : "AI Concierge";
    dom.handoffDescription.textContent = humanHandoff
      ? "Human Agent Active — AI Paused. New guest messages will not receive automated replies."
      : "AI replies are enabled for this simulation.";
    dom.conversationMode.classList.toggle("is-human", humanHandoff);
    dom.conversationMode.textContent = humanHandoff ? "Human active" : "AI active";
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = humanHandoff ? "Human Staff Active" : "online";
    addTranscript("System", humanHandoff ? "Human receptionist took over the conversation. AI paused." : "AI Concierge resumed.", humanHandoff ? "human" : "ai");
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    launchSimulation();
  });

  dom.messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = dom.messageInput.value;
    dom.messageInput.value = "";
    await sendGuestMessage(text);
    if (!dom.messageInput.disabled) dom.messageInput.focus();
  });

  dom.chatMessages.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    if (button.dataset.action === "view-services") {
      openServices();
      return;
    }
    if (button.dataset.action === "quick-reply") {
      disableMessageActions(button);
      sendGuestMessage(button.textContent || "");
    }
  });

  document.querySelectorAll(".service-option").forEach((option) => {
    option.addEventListener("click", () => {
      closeServices();
      sendGuestMessage(`I would like to book ${option.dataset.service}.`);
    });
  });

  dom.handoffButton.addEventListener("click", toggleHandoff);
  dom.closeSheet.addEventListener("click", closeServices);
  dom.backdrop.addEventListener("click", closeServices);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.sheet.hidden) closeServices();
  });

  initSheetGestures();
  launchSimulation();
})();
