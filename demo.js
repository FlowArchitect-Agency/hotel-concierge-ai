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

  const POST_CHECKOUT_TEMPLATES = {
    English: {
      text: (name) => `Thank you for staying at Hôtel Lumière, ${name}. We hope you had a safe journey home. How was your experience with us?`,
      quickReplies: ["Loved it, 5 stars!", "Great stay, thank you", "The room was noisy", "We had some issues"],
    },
    French: {
      text: (name) => `Merci d'avoir séjourné à l'Hôtel Lumière, ${name}. Nous espérons que votre voyage de retour s'est bien passé. Comment s'est déroulée votre expérience parmi nous ?`,
      quickReplies: ["Séjour parfait, 5 étoiles !", "Très bon séjour", "Chambre bruyante", "Nous avons eu des problèmes"],
    },
    Spanish: {
      text: (name) => `Gracias por alojarse en Hôtel Lumière, ${name}. Esperamos que haya tenido un buen viaje de regreso. ¿Cómo fue su experiencia con nosotros?`,
      quickReplies: ["¡Excelente, 5 estrellas!", "Muy buena estancia", "La habitación era ruidosa", "Tuvimos algunos problemas"],
    },
    Japanese: {
      text: (name) => `オテル・リュミエールにご宿泊いただき誠にありがとうございました、${name}様。ご無事にご帰宅されたことと存じます。当ホテルでのご滞在はいかがでしたでしょうか？`,
      quickReplies: ["素晴らしかった！5つ星", "快適な滞在でした", "部屋が少し騒がしかった", "問題がありました"],
    },
  };
  const CHECKOUT_TEMPLATES = POST_CHECKOUT_TEMPLATES;

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

  // Render WhatsApp chat bubble with optional rich media
  function addMessage({ sender, text, quickReplies = [], listMessage = false, media = null }) {
    const message = document.createElement("article");
    const isGuest = sender === "guest";
    const isStaff = sender === "staff" || sender === "reception";
    const senderClass = isGuest ? "message--guest msg-guest" : isStaff ? "message--staff msg-staff" : "message--ai msg-ai";
    message.className = `message ${senderClass}`;

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
      } else if (media.type === "link") {
        // Render WhatsApp Rich Link Preview Card
        const linkCard = document.createElement("a");
        linkCard.className = "message-media-link";
        linkCard.href = media.url || "#";
        linkCard.target = "_blank";
        linkCard.rel = "noopener noreferrer";
        linkCard.setAttribute("role", "group");
        linkCard.setAttribute("aria-label", `Open ${media.title || "Link"}`);

        const thumbUrl = media.thumbnail || media.image || media.imageUrl;
        if (thumbUrl) {
          const thumbWrap = document.createElement("div");
          thumbWrap.className = "media-link-thumb";
          const thumbImg = document.createElement("img");
          thumbImg.src = thumbUrl;
          thumbImg.alt = media.title || "Link Preview";
          thumbImg.loading = "lazy";
          thumbImg.onerror = () => { thumbWrap.remove(); };
          thumbWrap.append(thumbImg);
          linkCard.append(thumbWrap);
        }

        const linkInfo = document.createElement("div");
        linkInfo.className = "media-link-info";

        const domainSpan = document.createElement("span");
        domainSpan.className = "media-link-domain";
        try {
          domainSpan.textContent = media.url && !media.url.startsWith("#") ? new URL(media.url).hostname.replace(/^www\./, "") : "g.page";
        } catch {
          domainSpan.textContent = "g.page";
        }

        const titleSpan = document.createElement("span");
        titleSpan.className = "media-link-title";
        titleSpan.textContent = media.title || "Hôtel Lumière Paris — Google Reviews";

        const descSpan = document.createElement("span");
        descSpan.className = "media-link-desc";
        descSpan.textContent = media.description || "★★★★★ 4.9 · Share your stay experience";

        linkInfo.append(domainSpan, titleSpan, descSpan);
        linkCard.append(linkInfo);

        linkCard.addEventListener("click", (e) => {
          e.preventDefault();
          showToast("Demo Mode: Google Review Portal simulated.");
          addTranscript("Review Link Click", `Opened: ${media.title || "Google Reviews"}`, "ai");
        });

        message.append(linkCard);
      } else if (media.type === "image" || media.image_url || media.imageUrl || (media.thumbnail && !media.url) || (media.url && /\.(jpe?g|png|webp|gif|svg)(\?.*)?$/i.test(media.url))) {
        const imgSrc = media.image_url || media.imageUrl || media.thumbnail || media.url;
        if (imgSrc) {
          const imgCard = document.createElement("div");
          imgCard.className = "message-media-image";
          const img = document.createElement("img");
          img.src = imgSrc;
          img.alt = media.title || "Attached Media";
          img.loading = "lazy";
          img.onerror = () => { imgCard.remove(); };
          imgCard.append(img);
          message.append(imgCard);
        }
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
    meta.textContent = `${isStaff ? "Reception · " : ""}${timeNow()}`;
    message.append(meta);
    dom.chatMessages.append(message);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    addTranscript(
      isGuest ? "Guest" : isStaff ? "Receptionist (Live)" : "AI Concierge",
      text || "[Media Attachment]",
      isGuest ? "guest" : isStaff ? "human" : "ai"
    );
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

  function setOwnerStatus({ human, role = "Reception" }) {
    dom.handoffStatus.replaceChildren();
    const dot = document.createElement("span");
    dot.className = "status-dot";
    dot.setAttribute("aria-hidden", "true");
    dom.handoffStatus.append(dot, human ? ` You (${role}) · Live` : " Active");
  }

  function updateComposerState(isHuman, role = "Reception") {
    if (isHuman) {
      dom.messageInput.placeholder = `Reply as ${role}...`;
      dom.messageInput.setAttribute("aria-label", `Reply as ${role}`);
      dom.sendButton.setAttribute("aria-label", `Reply as ${role}`);
      dom.sendButton.title = `Reply as ${role}`;
      const label = document.querySelector('label[for="messageInput"]');
      if (label) label.textContent = `Reply as ${role}`;
    } else {
      dom.messageInput.placeholder = "Type a message";
      dom.messageInput.setAttribute("aria-label", "Type a message");
      dom.sendButton.setAttribute("aria-label", "Send message");
      dom.sendButton.title = "Send message";
      const label = document.querySelector('label[for="messageInput"]');
      if (label) label.textContent = "Type a message";
    }
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
    updateComposerState(false);
  }

  // Trigger Human Handoff (Escape Hatch / Sentiment Override Reaction / General Manager Service Recovery)
  function triggerEscalationHandoff(reason = "Guest requested manager / severe complaint", role = "General Manager") {
    humanHandoff = true;
    dom.handoffButton.classList.add("is-human");
    dom.handoffButton.textContent = "Resume AI Concierge";
    dom.handoffButton.setAttribute("aria-pressed", "true");
    dom.handoffStatus.classList.add("is-human");
    setOwnerStatus({ human: true, role });
    dom.handoffTitle.textContent = `${role} Escalation`;
    dom.handoffDescription.textContent = `Human Agent Active — AI Paused. Messages typed below will be sent as ${role} to the guest.`;
    dom.conversationMode.classList.add("is-human");
    dom.conversationMode.textContent = `You (${role}) · Live`;
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = `${role} Active`;
    updateComposerState(true, role);

    renderStaffAlerts([{
      role: role,
      summary: `URGENT: ${reason}`,
    }]);

    addTranscript("URGENT ESCALATION", `⚠️ ${reason}. AI automatically suspended. ${role} in control.`, "human");
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

  // Launch simulation logic (Pre-Arrival, In-Stay, Post-Checkout Review)
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

    // Hard-coded Meta Template immediately injected upon Launch for Pre-Arrival and Post-Checkout
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
    } else if (session.scenario === "post_checkout" || session.scenario === "checkout") {
      const checkoutData = POST_CHECKOUT_TEMPLATES[session.language] || POST_CHECKOUT_TEMPLATES.English;
      const checkoutText = checkoutData.text(session.name);
      session.chatHistory.push({ role: "assistant", content: checkoutText });
      addMessage({
        sender: "ai",
        text: checkoutText,
        quickReplies: checkoutData.quickReplies,
        listMessage: false,
      });
      addTranscript("Meta Template", `Automated post-checkout review template delivered to ${session.name}.`, "ai");
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

      // Rich Media & Link rendering
      const media = result.media || null;
      const quickReplies = (result.quickReplies && result.quickReplies.length) ? result.quickReplies : partnerQuickReplies(result);

      addMessage({
        sender: "ai",
        text: reply,
        quickReplies,
        listMessage: session.scenario !== "post_checkout" && session.scenario !== "checkout",
        media,
      });

      renderStaffAlerts(result.staff_alerts);

      // Escape Hatch / Sentiment Override / General Manager Service Recovery
      if (result.escape_hatch_triggered === true || (result.requires_human === true && result.intent === "complaint")) {
        const lastUserMsg = session.chatHistory.filter((m) => m.role === "user").slice(-1)[0]?.content || "Guest escalation";
        const role = result.staff_alerts?.[0]?.role || (session.scenario === "post_checkout" || session.scenario === "checkout" ? "General Manager" : "Duty Manager");
        triggerEscalationHandoff(`Guest complaint / Review recovery: "${lastUserMsg}"`, role);
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
      addTranscript("System", "Guest sent message while receptionist is controlling the chat. AI auto-reply is paused.", "human");
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

  function sendStaffMessage(text) {
    const cleanText = text.trim();
    if (!cleanText || !session) return;
    addMessage({ sender: "staff", text: cleanText });
    session.chatHistory.push({ role: "assistant", content: cleanText });
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
    setOwnerStatus({ human: humanHandoff, role: "Reception" });
    dom.handoffTitle.textContent = humanHandoff ? "Human receptionist" : "AI Concierge";
    dom.handoffDescription.textContent = humanHandoff
      ? "Receptionist is in control — AI auto-replies are paused. Messages typed below will be sent as Reception to the guest."
      : "AI replies are enabled for this simulation.";
    dom.conversationMode.classList.toggle("is-human", humanHandoff);
    dom.conversationMode.textContent = humanHandoff ? "You (Reception) · Live" : "AI active";
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = humanHandoff ? "Reception Staff Active" : "online";
    updateComposerState(humanHandoff, "Reception");
    addTranscript("System", humanHandoff ? "Human receptionist took over the conversation. AI paused. Composer is now replying as Reception." : "AI Concierge resumed.", humanHandoff ? "human" : "ai");
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    launchSimulation();
  });

  dom.messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = dom.messageInput.value;
    dom.messageInput.value = "";
    if (humanHandoff) {
      sendStaffMessage(text);
    } else {
      await sendGuestMessage(text);
    }
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
      const replyText = (button.textContent || "").trim();
      if (/leave google review/i.test(replyText)) {
        showToast("Demo Mode: Google Review Portal simulated (5 Stars).");
        addTranscript("Review Portal Action", "Guest opened Google Review Portal (5 Stars).", "guest");
      } else if (/share on tripadvisor/i.test(replyText)) {
        showToast("Demo Mode: TripAdvisor Review Portal simulated.");
        addTranscript("Review Portal Action", "Guest opened TripAdvisor Review Portal.", "guest");
      } else {
        sendGuestMessage(replyText);
      }
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
