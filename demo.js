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
    emojiPickerBtn: document.querySelector("#emojiPickerBtn"),
    emojiPicker: document.querySelector("#emojiPicker"),
    closeEmojiPicker: document.querySelector("#closeEmojiPicker"),
    emojiGrid: document.querySelector("#emojiGrid"),
    inboxStaffForm: document.querySelector("#inboxStaffForm"),
    inboxStaffInput: document.querySelector("#inboxStaffInput"),
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
    closeSheet: document.querySelector("#closeSheet"),
    journeySummary: document.querySelector("#journeySummary"),
    launchInstruction: document.querySelector("#launchInstruction"),
    activityTimeline: document.querySelector("#activityTimeline"),
    activityState: document.querySelector("#activityState"),
    workspaceGuestName: document.querySelector("#workspaceGuestName"),
    workspaceStay: document.querySelector("#workspaceStay"),
    workspaceLanguage: document.querySelector("#workspaceLanguage"),
    workspaceJourney: document.querySelector("#workspaceJourney"),
    workspaceIntent: document.querySelector("#workspaceIntent"),
    workspaceRequestStatus: document.querySelector("#workspaceRequestStatus"),
    workspaceOwner: document.querySelector("#workspaceOwner"),
    workspaceOperationalState: document.querySelector("#workspaceOperationalState"),
    workspaceJourneyState: document.querySelector("#workspaceJourneyState"),
    channelGuestName: document.querySelector("#channelGuestName"),
    channelStayMeta: document.querySelector("#channelStayMeta"),
    workspaceActiveRequest: document.querySelector("#workspaceActiveRequest"),
    workspaceActiveRequestTitle: document.querySelector("#workspaceActiveRequestTitle"),
    workspaceActiveRequestMeta: document.querySelector("#workspaceActiveRequestMeta"),
    workspaceRequestOpen: document.querySelector("#workspaceRequestOpen"),
    requestQueue: document.querySelector("#requestQueue"),
    requestDetail: document.querySelector("#requestDetail"),
    requestsQueueCount: document.querySelector("#requestsQueueCount"),
    requestsQueueState: document.querySelector("#requestsQueueState"),
    receptionRequestSummary: document.querySelector("#receptionRequestSummary"),
    receptionRequestTitle: document.querySelector("#receptionRequestTitle"),
    receptionRequestStatus: document.querySelector("#receptionRequestStatus"),
    receptionRequestMeta: document.querySelector("#receptionRequestMeta"),
    receptionRequestOpen: document.querySelector("#receptionRequestOpen")
  };

  let session = null;
  let humanHandoff = false;
  let lastFocusedElement = null;
  let activeController = null;
  let workspaceState = { intent: "", requestStatus: "", owner: "ConciergeFlow" };
  let requestState = { items: [], activeId: "", filter: "open", degraded: false };

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

  function scenarioDetails(value = dom.scenario.value) {
    const scenarios = {
      "pre-arrival": {
        title: "Pre-arrival",
        stay: "Arrival in 48 hours",
        channel: "48h pre-arrival",
        launcher: "48 hours before arrival",
        initialIntent: "Preparing the stay",
        initialStatus: "Journey initiated",
        instruction: "ConciergeFlow will open a simulated pre-arrival conversation, then carry the guest context into the staff view."
      },
      "in-stay": {
        title: "In-stay",
        stay: "During current stay",
        channel: "In-stay",
        launcher: "Live in-stay request",
        initialIntent: "Ready for a guest request",
        initialStatus: "Guest channel ready",
        instruction: "ConciergeFlow will open a simulated in-stay conversation with hotel context ready for a service need."
      },
      post_checkout: {
        title: "Post-stay",
        stay: "After checkout",
        channel: "Post-stay",
        launcher: "Post-stay follow-up",
        initialIntent: "Gathering guest feedback",
        initialStatus: "Feedback journey initiated",
        instruction: "ConciergeFlow will follow up after checkout and bring staff in when recovery needs human judgement."
      }
    };
    return scenarios[value] || scenarios["pre-arrival"];
  }

  function setActivityStatus(label, isAlert = false) {
    if (!dom.activityState) return;
    dom.activityState.classList.toggle("is-alert", isAlert);
    dom.activityState.innerHTML = `<i aria-hidden="true"></i>${label}`;
  }

  function addActivity(title, detail = "", { alert = false, status = "Active", level = alert ? "degraded" : "routine" } = {}) {
    if (!dom.activityTimeline) return;
    const item = document.createElement("li");
    item.className = `activity-event activity-event--${level}${alert ? " is-alert" : ""}`;
    const time = document.createElement("time");
    time.textContent = timeNow();
    const flag = document.createElement("span");
    flag.className = "activity-event-flag";
    flag.textContent = level === "degraded" ? "Service unavailable" : level === "attention" ? "Staff attention" : level === "transition" ? "Journey update" : "Updated";
    const heading = document.createElement("strong");
    heading.textContent = title;
    item.append(time, flag, heading);
    if (detail) {
      const copy = document.createElement("span");
      copy.textContent = detail;
      item.append(copy);
    }
    dom.activityTimeline.prepend(item);
    while (dom.activityTimeline.children.length > 8) {
      dom.activityTimeline.lastElementChild.remove();
    }
    setActivityStatus(status, alert);
  }

  function inferIntent(text) {
    const value = String(text || "").toLowerCase();
    if (/airport|transfer|taxi|chauffeur|cdg|orly/.test(value)) return "Airport transfer";
    if (/massage|spa|wellness|treatment/.test(value)) return "Spa & wellness";
    if (/restaurant|dining|table|breakfast|dinner/.test(value)) return "Dining";
    if (/towel|housekeeping|clean|linen/.test(value)) return "Housekeeping";
    if (/noise|air conditioning|\bac\b|complaint|issue|manager/.test(value)) return "Service recovery";
    if (/review|star|experience|loved|great stay/.test(value)) return "Guest feedback";
    return "Guest request";
  }

  // The public chat result exposes request summaries, not Airtable records.
  // These objects are therefore a browser-local operational projection for the
  // demo. They make existing AI request detection observable without adding an
  // unauthenticated staff mutation API.
  function requestServiceType(value) {
    const normalized = String(value || "").toLowerCase();
    if (/general manager|manager|complaint|escalation|recovery/.test(normalized)) return "General Manager";
    if (/maintenance|repair|engineering|air conditioning|\bac\b/.test(normalized)) return "Maintenance";
    if (/housekeeping|towel|linen|cleaning|room delivery/.test(normalized)) return "Housekeeping";
    if (/spa|wellness|massage|treatment|hammam|sauna/.test(normalized)) return "Spa & Wellness";
    if (/transport|transfer|taxi|chauffeur|airport|shuttle/.test(normalized)) return "Transport";
    if (/dining|restaurant|breakfast|lunch|dinner|food/.test(normalized)) return "Dining";
    return "Concierge";
  }

  function requestStatus(status) {
    const normalized = String(status || "new").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["resolved", "complete", "completed", "done"].includes(normalized)) return { key: "resolved", label: "Resolved" };
    if (["cancelled", "canceled"].includes(normalized)) return { key: "cancelled", label: "Cancelled" };
    if (["in_progress", "inprogress", "assigned", "active"].includes(normalized)) return { key: "in_progress", label: "In progress" };
    if (["waiting", "waiting_for_guest"].includes(normalized)) return { key: "waiting", label: "Waiting for guest" };
    return { key: "needs_attention", label: "Needs attention" };
  }

  function requestTitle(request) {
    return String(request?.serviceName || "").trim() || `${requestServiceType(request?.serviceType)} request`;
  }

  function requestForId(id = requestState.activeId) {
    return requestState.items.find((request) => request.id === id) || null;
  }

  function requestIsOpen(request) {
    return ["needs_attention", "in_progress", "waiting"].includes(requestStatus(request?.status).key);
  }

  function activeRequest() {
    const selected = requestForId();
    if (selected && requestIsOpen(selected)) return selected;
    return requestState.items.find((request) => requestIsOpen(request)) || null;
  }

  function activeRequestStatusOr(fallback) {
    const request = activeRequest();
    return request ? requestStatus(request.status).label : fallback;
  }

  function requestMatchesFilter(request) {
    const status = requestStatus(request.status).key;
    if (requestState.filter === "open") return requestIsOpen(request);
    if (requestState.filter === "in_progress") return status === "in_progress";
    if (requestState.filter === "resolved") return status === "resolved";
    return true;
  }

  function createRequestStatus(label) {
    const badge = document.createElement("span");
    const status = requestStatus(label);
    badge.className = "request-status";
    badge.dataset.status = status.key;
    badge.textContent = status.label;
    return badge;
  }

  function requestTiming() {
    if (!session) return "Current journey";
    return scenarioDetails(session.scenario).launcher;
  }

  function requestPriority(summary, serviceType) {
    if (/\burgent\b/i.test(String(summary || "")) || serviceType === "General Manager") return "Urgent";
    return "";
  }

  function requestServiceContext(result, serviceName) {
    const offers = [
      ...(Array.isArray(result?.partner_offers) ? result.partner_offers : []),
      ...(Array.isArray(result?.hotel_collection) ? result.hotel_collection : []),
    ];
    const target = String(serviceName || "").trim().toLowerCase();
    const match = offers.find((offer) => String(offer?.name || "").trim().toLowerCase() === target);
    if (!match) return null;
    return {
      name: String(match.name || "").trim(),
      description: String(match.description || "").trim(),
      price: Number.isFinite(Number(match.price_eur)) ? Number(match.price_eur) : null,
      duration: Number.isFinite(Number(match.duration_mins)) ? Number(match.duration_mins) : null,
      category: String(match.category || "").trim(),
    };
  }

  function requestEntriesFromResult(result) {
    const structured = Array.isArray(result?.requests) ? result.requests.filter((entry) => entry?.summary) : [];
    if (structured.length) return structured;
    // Existing deployments already return staff alerts. Retain that compatible
    // observable fallback while the additive structured field rolls out.
    return (Array.isArray(result?.staff_alerts) ? result.staff_alerts : [])
      .filter((entry) => entry?.summary)
      .map((entry) => ({
        service_name: entry.service_name || "",
        service_type: entry.service_type || "",
        summary: entry.summary,
      }));
  }

  function prepareRequestsFromResult(result, guestMessage) {
    if (!session) return [];
    const requests = requestEntriesFromResult(result);
    const created = requests.map((entry) => {
      const serviceName = String(entry.service_name || "").trim();
      const serviceType = requestServiceType(entry.service_type || result?.service_type || result?.serviceType || inferIntent(guestMessage));
      const summary = String(entry.summary || "").trim();
      const service = requestServiceContext(result, serviceName);
      return {
        id: `simreq_${crypto.randomUUID()}`,
        sessionId: session.id,
        serviceName,
        serviceType,
        summary,
        guestMessage: String(guestMessage || "").trim(),
        guestName: session.name,
        language: session.language,
        scenario: session.scenario,
        timing: requestTiming(),
        channel: "WhatsApp",
        source: entry.source === "external" || entry.source === "partner" ? entry.source : "",
        service,
        estimatedValue: Number.isFinite(Number(entry.est_value_eur)) ? Number(entry.est_value_eur) : null,
        isUpsell: Boolean(entry.is_upsell),
        priority: requestPriority(summary, serviceType),
        status: "needs_attention",
        owner: "Unassigned",
        createdAt: Date.now(),
        createdLabel: timeNow(),
        isDemo: true,
      };
    });

    if (!created.length) return [];
    requestState.items.unshift(...created);
    requestState.activeId = created[0].id;
    requestState.degraded = false;
    updateRequestSurfaces();
    created.forEach((request) => {
      addActivity("Request prepared", `${requestTitle(request)} · staff confirmation required.`, { status: "Staff attention", level: "attention" });
    });
    return created;
  }

  function cancelLocalRequestFromResult(result, guestMessage) {
    const reply = String(result?.reply || "");
    if (!/(?:has been cancelled|has been canceled|remains cancelled|remains canceled)/i.test(reply)) return null;
    const serviceType = requestServiceType(guestMessage);
    const request = requestState.items.find((item) => item.serviceType === serviceType && requestIsOpen(item));
    if (!request) return null;
    request.status = "cancelled";
    request.cancelledAt = timeNow();
    requestState.activeId = requestState.items.find((item) => requestIsOpen(item))?.id || request.id;
    updateRequestSurfaces();
    addActivity("Request cancelled", `${requestTitle(request)} was cancelled by the guest.`, { status: "Request updated", level: "transition" });
    return request;
  }

  function renderRequestQueue() {
    if (!dom.requestQueue) return;
    const visible = requestState.items.filter(requestMatchesFilter);
    const openCount = requestState.items.filter(requestIsOpen).length;
    if (dom.requestsQueueCount) dom.requestsQueueCount.textContent = String(visible.length);
    if (dom.requestsQueueState) dom.requestsQueueState.innerHTML = `<i aria-hidden="true"></i>${openCount ? `${openCount} active request${openCount === 1 ? "" : "s"}` : "No active requests"}`;
    document.querySelectorAll("[data-request-filter]").forEach((button) => {
      const active = button.dataset.requestFilter === requestState.filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    dom.requestQueue.replaceChildren();
    if (requestState.degraded) {
      const notice = document.createElement("p");
      notice.className = "request-queue-notice";
      notice.textContent = "The latest concierge response was unavailable. Existing demo requests are unchanged.";
      dom.requestQueue.append(notice);
    }
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "request-queue-empty";
      const heading = document.createElement("strong");
      heading.textContent = requestState.degraded ? "Request activity unavailable" : requestState.items.length ? "Nothing in this view" : "No active requests";
      const copy = document.createElement("p");
      copy.textContent = requestState.degraded
        ? "The concierge response did not arrive, so no new demo request could be prepared."
        : requestState.items.length
          ? "Choose another request state to see more of this demo session."
          : "When ConciergeFlow detects hotel follow-up, a structured request will appear here.";
      empty.append(heading, copy);
      dom.requestQueue.append(empty);
      return;
    }

    visible.forEach((request) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "request-queue-item";
      item.setAttribute("role", "listitem");
      item.classList.toggle("is-selected", request.id === requestState.activeId);
      item.setAttribute("aria-current", request.id === requestState.activeId ? "true" : "false");
      const type = document.createElement("span");
      type.className = "request-queue-item__type";
      type.textContent = request.serviceType;
      const title = document.createElement("strong");
      title.textContent = requestTitle(request);
      const guest = document.createElement("span");
      guest.className = "request-queue-item__guest";
      guest.textContent = request.guestName;
      const meta = document.createElement("span");
      meta.className = "request-queue-item__meta";
      meta.textContent = `${request.timing} · ${request.channel}`;
      const footer = document.createElement("span");
      footer.className = "request-queue-item__footer";
      footer.append(createRequestStatus(request.status));
      const owner = document.createElement("em");
      owner.textContent = request.owner;
      footer.append(owner);
      item.append(type, title, guest, meta, footer);
      item.addEventListener("click", () => selectRequest(request.id));
      dom.requestQueue.append(item);
    });
  }

  function detailField(label, value) {
    const field = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    field.append(term, description);
    return field;
  }

  function renderRequestDetail() {
    if (!dom.requestDetail) return;
    const request = requestForId();
    dom.requestDetail.replaceChildren();
    if (!request) {
      const empty = document.createElement("div");
      empty.className = "request-detail-empty";
      const eyebrow = document.createElement("p");
      eyebrow.className = "eyebrow";
      eyebrow.textContent = "Request detail";
      const heading = document.createElement("h2");
      heading.id = "request-detail-title";
      heading.textContent = "No request selected";
      const copy = document.createElement("p");
      copy.textContent = "Select a request to see the guest context, service information and operational next step.";
      const note = document.createElement("span");
      note.textContent = "Product simulation · status controls affect this demonstration only.";
      empty.append(eyebrow, heading, copy, note);
      dom.requestDetail.append(empty);
      return;
    }

    const header = document.createElement("header");
    header.className = "request-detail-header";
    const top = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Request";
    const heading = document.createElement("h2");
    heading.id = "request-detail-title";
    heading.textContent = requestTitle(request);
    top.append(eyebrow, heading);
    header.append(top, createRequestStatus(request.status));
    if (request.priority) {
      const priority = document.createElement("span");
      priority.className = "request-priority";
      priority.textContent = request.priority;
      header.append(priority);
    }

    const summary = document.createElement("section");
    summary.className = "request-detail-summary";
    const summaryLabel = document.createElement("p");
    summaryLabel.textContent = "What the guest needs";
    const summaryCopy = document.createElement("p");
    summaryCopy.textContent = request.summary || "No request summary was returned.";
    summary.append(summaryLabel, summaryCopy);

    const facts = document.createElement("dl");
    facts.className = "request-detail-facts";
    facts.append(
      detailField("Guest", request.guestName),
      detailField("Channel", request.channel),
      detailField("Journey", request.timing),
      detailField("Language", request.language),
      detailField("Service type", request.serviceType),
      detailField("Owner", request.owner),
    );

    const context = document.createElement("section");
    context.className = "request-detail-section";
    const contextHeading = document.createElement("h3");
    contextHeading.textContent = "Conversation";
    const guestMessage = document.createElement("p");
    guestMessage.textContent = request.guestMessage ? `Guest message: “${request.guestMessage}”` : "No linked guest message was returned.";
    const conversationButton = document.createElement("button");
    conversationButton.type = "button";
    conversationButton.className = "request-text-action";
    conversationButton.textContent = "Open conversation →";
    conversationButton.addEventListener("click", () => openRequestConversation(request.id));
    context.append(contextHeading, guestMessage, conversationButton);

    const service = document.createElement("section");
    service.className = "request-detail-section";
    const serviceHeading = document.createElement("h3");
    serviceHeading.textContent = "Service context";
    const serviceCopy = document.createElement("p");
    if (request.service?.description) {
      serviceCopy.textContent = request.service.description;
    } else if (request.serviceName) {
      serviceCopy.textContent = `Requested service: ${request.serviceName}.`;
    } else {
      serviceCopy.textContent = "No matched hotel service was returned for this request.";
    }
    service.append(serviceHeading, serviceCopy);
    const knownValue = Number.isFinite(request.estimatedValue) ? request.estimatedValue : request.service?.price;
    if (Number.isFinite(knownValue)) {
      const value = document.createElement("span");
      value.className = "request-service-value";
      value.textContent = `Potential service value · €${Number(knownValue).toFixed(0)}`;
      service.append(value);
    }
    if (request.service?.duration) {
      const duration = document.createElement("span");
      duration.className = "request-service-value";
      duration.textContent = `${request.service.duration} minutes`;
      service.append(duration);
    }
    if (request.source) {
      const source = document.createElement("span");
      source.className = "request-service-value";
      source.textContent = request.source === "external" ? "External recommendation" : "Hotel / partner service";
      service.append(source);
    }

    const actions = document.createElement("footer");
    actions.className = "request-detail-actions";
    const status = requestStatus(request.status).key;
    if (status === "needs_attention") {
      const take = document.createElement("button");
      take.type = "button";
      take.className = "button button-primary button-sm";
      take.textContent = "Take ownership";
      take.addEventListener("click", () => takeRequestOwnership(request.id));
      actions.append(take);
    }
    if (status === "in_progress") {
      const resolve = document.createElement("button");
      resolve.type = "button";
      resolve.className = "button button-primary button-sm";
      resolve.textContent = "Resolve request";
      resolve.addEventListener("click", () => resolveRequest(request.id));
      actions.append(resolve);
    }
    const open = document.createElement("button");
    open.type = "button";
    open.className = "button button-quiet button-sm";
    open.textContent = "Open conversation";
    open.addEventListener("click", () => openRequestConversation(request.id));
    actions.append(open);

    const note = document.createElement("p");
    note.className = "request-detail-note";
    note.textContent = "Status controls are part of this product simulation and do not change a live hotel system.";
    dom.requestDetail.append(header, summary, facts, context, service, actions, note);
  }

  function renderRequestLinkedSurfaces() {
    const request = activeRequest();
    if (dom.workspaceActiveRequest) {
      dom.workspaceActiveRequest.hidden = !request;
      if (request) {
        dom.workspaceActiveRequestTitle.textContent = requestTitle(request);
        dom.workspaceActiveRequestMeta.textContent = `${requestStatus(request.status).label} · ${request.owner}`;
      }
    }
    if (dom.receptionRequestSummary) {
      dom.receptionRequestSummary.hidden = !request;
      if (request) {
        dom.receptionRequestTitle.textContent = requestTitle(request);
        dom.receptionRequestStatus.replaceWith(createRequestStatus(request.status));
        dom.receptionRequestStatus = document.querySelector("#receptionRequestSummary .request-status");
        dom.receptionRequestMeta.textContent = `${request.owner} · ${request.timing} · ${request.channel}`;
      }
    }
  }

  function updateRequestSurfaces() {
    renderRequestQueue();
    renderRequestDetail();
    renderRequestLinkedSurfaces();
  }

  function selectRequest(id) {
    if (!requestForId(id)) return;
    requestState.activeId = id;
    updateRequestSurfaces();
  }

  function takeRequestOwnership(id) {
    const request = requestForId(id);
    if (!request || requestStatus(request.status).key !== "needs_attention") return;
    request.owner = "Reception";
    request.status = "in_progress";
    updateRequestSurfaces();
    updateWorkspaceContext({ requestStatus: "In progress" });
    addTranscript("Request update", `Reception took ownership of ${requestTitle(request)}.`, "human");
    addActivity("Request assigned", `${requestTitle(request)} is now owned by Reception.`, { status: "In progress", level: "transition" });
    showToast("Demo request is now owned by Reception.");
  }

  function resolveRequest(id) {
    const request = requestForId(id);
    if (!request || requestStatus(request.status).key !== "in_progress") return;
    request.status = "resolved";
    request.resolvedAt = timeNow();
    // Keep the selected request visible when it leaves the default Open view.
    // This makes the local demo lifecycle legible instead of showing an empty
    // queue beside a still-selected resolved request.
    requestState.filter = "resolved";
    updateRequestSurfaces();
    updateWorkspaceContext({ requestStatus: "Request resolved" });
    addTranscript("Request update", `Reception resolved ${requestTitle(request)}.`, "human");
    addActivity("Request resolved", `${requestTitle(request)} has been marked resolved in this product simulation.`, { status: "Resolved", level: "transition" });
    showToast("Request marked resolved in this demo.");
  }

  function openRequestConversation(id) {
    selectRequest(id);
    showScreen("inbox");
  }

  function updateWorkspaceContext(next = {}) {
    if (!session) return;
    const details = scenarioDetails(session.scenario);
    workspaceState = {
      intent: (next.intent ?? workspaceState.intent) || details.initialIntent,
      requestStatus: (next.requestStatus ?? workspaceState.requestStatus) || details.initialStatus,
      owner: (next.owner ?? workspaceState.owner) || "ConciergeFlow"
    };
    if (dom.workspaceGuestName) dom.workspaceGuestName.textContent = session.name;
    if (dom.workspaceStay) dom.workspaceStay.textContent = details.stay;
    if (dom.workspaceLanguage) dom.workspaceLanguage.textContent = session.language;
    if (dom.workspaceJourney) dom.workspaceJourney.textContent = details.title;
    if (dom.workspaceIntent) dom.workspaceIntent.textContent = workspaceState.intent || details.initialIntent;
    if (dom.workspaceRequestStatus) dom.workspaceRequestStatus.textContent = workspaceState.requestStatus || details.initialStatus;
    if (dom.workspaceOwner) dom.workspaceOwner.textContent = workspaceState.owner || "ConciergeFlow";
    if (dom.workspaceOperationalState) {
      const staffOwned = humanHandoff;
      dom.workspaceOperationalState.classList.toggle("is-staff-owned", staffOwned);
      dom.workspaceOperationalState.innerHTML = `<i aria-hidden="true"></i>${staffOwned ? "Staff-owned · AI paused" : "AI active"}`;
    }
    if (dom.workspaceJourneyState) dom.workspaceJourneyState.textContent = `${details.title} active`;
    if (dom.channelGuestName) dom.channelGuestName.textContent = session.name;
    if (dom.channelStayMeta) dom.channelStayMeta.textContent = details.channel;
  }

  function syncJourneyLauncher() {
    const details = scenarioDetails();
    document.querySelectorAll(".journey-choice").forEach((choice) => {
      const selected = choice.dataset.journey === dom.scenario.value;
      choice.classList.toggle("is-selected", selected);
      choice.setAttribute("aria-checked", String(selected));
    });
    document.querySelectorAll("[data-lifecycle]").forEach((stage) => {
      stage.classList.toggle("is-current", stage.dataset.lifecycle === dom.scenario.value);
    });
    if (dom.journeySummary) dom.journeySummary.textContent = details.launcher;
    if (dom.launchInstruction) dom.launchInstruction.textContent = details.instruction;
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
  function addMessage({ sender, text, quickReplies = [], listMessage = false, media = null, state = "" }) {
    // Remove any initial empty / starter helper cards
    const promptCard = dom.chatMessages.querySelector(".chat-prompt-card");
    if (promptCard) promptCard.remove();

    const message = document.createElement("article");
    const isGuest = sender === "guest";
    const isStaff = sender === "staff" || sender === "reception";
    const senderClass = isGuest ? "message--guest msg-guest" : isStaff ? "message--staff msg-staff" : "message--ai msg-ai";
    message.className = `message ${senderClass}${state ? ` message--${state}` : ""}`;

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
        const mediaTitle = String(media.title || "");
        const mediaDescription = String(media.description || "");
        const isFeedbackLink = /feedback|review/i.test(`${mediaTitle} ${mediaDescription}`);
        const linkCard = document.createElement("a");
        linkCard.className = "message-media-link";
        linkCard.href = media.url || "#";
        linkCard.target = "_blank";
        linkCard.rel = "noopener noreferrer";
        linkCard.setAttribute("role", "group");
        linkCard.setAttribute("aria-label", `Open ${isFeedbackLink ? "guest feedback" : media.title || "link"}`);

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
        if (isFeedbackLink) {
          domainSpan.textContent = "Guest feedback";
        } else {
          try {
            domainSpan.textContent = media.url && !media.url.startsWith("#") ? new URL(media.url).hostname.replace(/^www\./, "") : "Shared link";
          } catch {
            domainSpan.textContent = "Shared link";
          }
        }

        const titleSpan = document.createElement("span");
        titleSpan.className = "media-link-title";
        titleSpan.textContent = isFeedbackLink ? "Share your experience when you are ready" : media.title || "Shared details";

        const descSpan = document.createElement("span");
        descSpan.className = "media-link-desc";
        descSpan.textContent = isFeedbackLink ? "Selected feedback workflows are simulated." : media.description || "Open the shared details.";

        linkInfo.append(domainSpan, titleSpan, descSpan);
        linkCard.append(linkInfo);

        linkCard.addEventListener("click", (e) => {
          e.preventDefault();
          if (isFeedbackLink) {
            showToast("Guest feedback is shown in this product simulation.");
            addTranscript("Guest feedback", "Feedback link opened in this product simulation.", "ai");
            return;
          }
          showToast("Shared link opened in this product simulation.");
          addTranscript("Shared link", `Opened: ${media.title || "Shared link"}`, "ai");
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

    if (state === "degraded") {
      const stateLabel = document.createElement("span");
      stateLabel.className = "message-state-label";
      stateLabel.textContent = "Concierge service · Response unavailable";
      message.append(stateLabel);
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
    dom.handoffStatus.textContent = human ? `You (${role}) · Live` : "Active";
  }

  function updateComposerState(isHuman, role = "Reception") {
    if (isHuman) {
      dom.messageInput.placeholder = `Reply to guest as ${role}...`;
      dom.messageInput.setAttribute("aria-label", `Reply as ${role}`);
      dom.sendButton.setAttribute("aria-label", `Reply as ${role}`);
      dom.sendButton.title = `Reply as ${role}`;
      const label = document.querySelector('label[for="messageInput"]');
      if (label) label.textContent = `Reply as ${role}`;
      if (dom.inboxStaffInput) {
        dom.inboxStaffInput.placeholder = `Type message as ${role}...`;
      }
    } else {
      dom.messageInput.placeholder = "Type a message";
      dom.messageInput.setAttribute("aria-label", "Type a message");
      dom.sendButton.setAttribute("aria-label", "Send message");
      dom.sendButton.title = "Send message";
      const label = document.querySelector('label[for="messageInput"]');
      if (label) label.textContent = "Type a message";
      if (dom.inboxStaffInput) {
        dom.inboxStaffInput.placeholder = "Type message as Receptionist...";
      }
    }
  }

  function updateGuestSummary() {
    dom.inboxName.textContent = session.name;
    dom.inboxContext.textContent = `${session.language} · ${scenarioLabel()}`;
    dom.initials.textContent = initialsFor(session.name);
    updateWorkspaceContext();
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
    if (session) updateWorkspaceContext({ owner: "ConciergeFlow" });
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
    dom.handoffDescription.textContent = `Staff takeover is active in this simulation. ConciergeFlow replies are paused until ${role} resumes them.`;
    dom.conversationMode.classList.add("is-human");
    dom.conversationMode.textContent = `You (${role}) · Live`;
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = `${role} Active`;
    updateComposerState(true, role);

    if (dom.staffAlert.hidden) {
      renderStaffAlerts([{
        role: role,
        summary: `Staff attention required: ${reason}`,
      }]);
    }

    addTranscript("Staff takeover", `${role} takeover prepared. ConciergeFlow replies are paused in this product simulation.`, "human");
    updateWorkspaceContext({ owner: role, requestStatus: activeRequestStatusOr("Staff attention required") });
    addActivity("Staff attention recommended", reason, { status: "Staff attention", level: "attention" });
    addActivity(`Staff takeover prepared · ${role}`, "ConciergeFlow replies are paused in this product simulation.", { status: "AI paused", level: "attention" });
  }

  function hideStaffAlert() {
    dom.staffAlert.hidden = true;
    dom.staffAlertTitle.textContent = "Reception follow-up";
    dom.staffAlertBody.textContent = "";
  }

  function renderStaffAlerts(alerts) {
    if (!Array.isArray(alerts) || !alerts.length) return;
    const alert = alerts[0];
    const staffArea = String(alert.role || "Reception").replace(/\s+team$/i, "").trim() || "Reception";
    dom.staffAlert.hidden = false;
    dom.staffAlertTitle.textContent = `Staff attention required · ${staffArea}`;
    dom.staffAlertBody.textContent = alert.summary || "A concierge request was created for team follow-up.";
    addTranscript("ConciergeFlow", `${staffArea} follow-up prepared for staff attention.`, "ai");
    updateWorkspaceContext({ requestStatus: activeRequestStatusOr("Staff attention recommended") });
    addActivity("Staff attention recommended", `${staffArea} follow-up prepared for staff attention.`, { status: "Staff attention", level: "attention" });
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
    const details = scenarioDetails(session.scenario);
    workspaceState = {
      intent: details.initialIntent,
      requestStatus: details.initialStatus,
      owner: "ConciergeFlow"
    };
    requestState = { items: [], activeId: "", filter: "open", degraded: false };
    resetHandoff();
    hideStaffAlert();
    updateGuestSummary();
    updateRequestSurfaces();
    clearChildren(dom.chatMessages);
    clearChildren(dom.transcript);
    clearChildren(dom.activityTimeline);
    addChatChrome();
    addTranscript("ConciergeFlow", `Simulation started for ${session.name} · ${scenarioLabel()} · ${session.language}.`, "ai");
    addActivity("Guest context loaded", `${session.name} · ${session.language}`, { status: "Context loaded", level: "routine" });
    addActivity(`${details.title} journey initiated`, details.stay, { status: "Journey active", level: "routine" });
    setBusy(false);

    // The locally simulated proactive messages make the two proactive journeys visible on launch.
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
      addTranscript("ConciergeFlow", `48-hour pre-arrival message shown to ${session.name}.`, "ai");
      addActivity("Proactive guest message delivered", "Pre-arrival concierge template is visible in WhatsApp.", { status: "Guest channel active", level: "transition" });
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
      addTranscript("ConciergeFlow", `Post-stay feedback message shown to ${session.name}.`, "ai");
      addActivity("Feedback invitation delivered", "Post-stay message is visible in WhatsApp.", { status: "Guest channel active", level: "transition" });
    } else if (session.scenario === "in-stay") {
      const helper = document.createElement("div");
      helper.className = "chat-prompt-card";
      helper.innerHTML = `
        <span class="prompt-badge">Guest conversation ready</span>
        <p>Try one of these realistic requests or type your own:</p>
      `;
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const samplePrompts = session.language === "French"
        ? ["Pouvez-vous m'envoyer le menu du Spa ?", "Besoin de serviettes supplémentaires", "Horaires du petit-déjeuner"]
        : session.language === "Spanish"
        ? ["¿Me puede enviar el menú del Spa?", "Necesito toallas adicionales", "¿A qué hora es el desayuno?"]
        : session.language === "Japanese"
        ? ["スパのメニューとパンフレットを送ってください", "タオルが必要です", "朝食は何時ですか？"]
        : ["Could you send me the Spa Menu and brochure?", "Need extra fresh towels in room", "What time is breakfast served?"];

      samplePrompts.forEach((p) => actions.append(buildActionButton(p, "quick-reply", "quick-reply")));
      helper.append(actions);
      dom.chatMessages.append(helper);
      addActivity("Guest channel ready", "Starter requests are ready to explore.", { status: "Guest channel active", level: "routine" });
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

      const lastGuestMessage = session.chatHistory.filter((item) => item.role === "user").slice(-1)[0]?.content || "";
      const cancelledRequest = cancelLocalRequestFromResult(result, lastGuestMessage);
      const preparedRequests = prepareRequestsFromResult(result, lastGuestMessage);
      const interpretedIntent = String(result.intent || "").trim() || inferIntent(lastGuestMessage);
      updateWorkspaceContext({
        intent: interpretedIntent,
        requestStatus: preparedRequests.length ? "Needs attention" : cancelledRequest ? "Request cancelled" : "Response prepared"
      });
      addActivity("Concierge response prepared", "A response is now visible in the guest channel.", { status: "Response ready", level: "transition" });
      if (Array.isArray(result.partner_offers) && result.partner_offers.length) {
        addActivity("Service options prepared", "Available offers are visible to the guest.", { status: "Options ready", level: "transition" });
      }
      if (media?.type === "document" || media?.format === "PDF") {
        addActivity(`Document shared${media.title ? ` · ${media.title}` : ""}`, "Available in the guest conversation.", { status: "Document shared", level: "transition" });
      } else if (media?.type === "link") {
        addActivity(`Link shared${media.title ? ` · ${media.title}` : ""}`, "Available in the guest conversation.", { status: "Link shared", level: "transition" });
      } else if (media?.type === "image" || media?.image_url || media?.imageUrl) {
        addActivity("Image shared", "Available in the guest conversation.", { status: "Media shared", level: "transition" });
      }

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
    const intent = inferIntent(cleanText);
    updateWorkspaceContext({
      intent,
      requestStatus: activeRequestStatusOr(humanHandoff ? "Awaiting staff reply" : "Preparing response")
    });
    addActivity("Guest message received", "Visible in the WhatsApp channel.", { status: humanHandoff ? "Staff review" : "Preparing response", level: "routine" });
    addActivity(`Intent recognized · ${intent}`, "Structured context updated for this simulated journey.", { status: humanHandoff ? "Staff review" : "Preparing response", level: "transition" });
    if (humanHandoff) {
      addTranscript("System", "Guest sent message while receptionist is controlling the chat. AI auto-reply is paused.", "human");
      addActivity("AI replies paused", "The conversation remains with staff.", { status: "Staff review", level: "attention" });
      return;
    }
    try {
      await requestConciergeReply();
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The concierge took too long to respond. Please try again."
        : "The concierge service is unavailable at the moment. Please try again shortly.";
      addMessage({ sender: "ai", text: message, state: "degraded" });
      addTranscript("ConciergeFlow", "Response unavailable. No new request was prepared.", "human");
      requestState.degraded = true;
      updateRequestSurfaces();
      updateWorkspaceContext({ requestStatus: "Concierge service unavailable" });
      addActivity("Concierge response unavailable", "The guest-facing service did not return a reply.", { alert: true, status: "Service unavailable", level: "degraded" });
    }
  }

  function sendStaffMessage(text) {
    const cleanText = text.trim();
    if (!cleanText || !session) return;
    addMessage({ sender: "staff", text: cleanText });
    session.chatHistory.push({ role: "assistant", content: cleanText });
    updateWorkspaceContext({
      owner: humanHandoff ? "Reception" : "ConciergeFlow",
      requestStatus: activeRequestStatusOr("Staff reply sent")
    });
    addActivity("Staff reply sent", "Reception reply is visible in the guest channel.", { status: "Staff reply sent", level: "transition" });
  }

  // Apple-Style Quick Emoji Reactions & Picker System
  const EMOJI_CATEGORIES = {
    popular: ["✨", "🛎️", "🏨", "🥂", "🍽️", "🧖", "🚘", "👍", "🙏", "❤️", "😊", "👌", "⭐", "🌟", "🎉", "☕"],
    faces: ["😊", "😀", "😃", "😄", "😁", "🤩", "🥰", "😍", "😎", "😌", "🙌", "🤝", "👋", "💬", "💭", "💡"],
    hotel: ["🏨", "🛎️", "🧳", "🔑", "🚪", "🛏️", "🛁", "🧖", "🧼", "💆", "🏊", "🏰", "🗼", "🏛️", "🖼️", "✨"],
    dining: ["🍽️", "🍷", "🥂", "🍾", "☕", "🥐", "🥖", "🥩", "🍝", "🥗", "🍰", "🍓", "🍇", "🧁", "🍹", "🍸"],
    travel: ["✈️", "🚘", "🚕", "🚆", "🚢", "🗺️", "📍", "🛍️", "🎫", "⏱️", "⏳", "💼", "💳", "💶", "🌆", "🌅"],
  };

  let activeEmojiCategory = "popular";

  function renderEmojiGrid(category = "popular") {
    if (!dom.emojiGrid) return;
    activeEmojiCategory = category;
    dom.emojiGrid.replaceChildren();
    const list = EMOJI_CATEGORIES[category] || EMOJI_CATEGORIES.popular;
    list.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-item-btn";
      btn.textContent = emoji;
      btn.setAttribute("aria-label", `Insert ${emoji}`);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        insertEmoji(emoji);
      });
      dom.emojiGrid.append(btn);
    });

    document.querySelectorAll(".emoji-cat-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.cat === category);
    });
  }

  function insertEmoji(emoji) {
    const input = dom.messageInput;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const val = input.value;
    input.value = val.substring(0, start) + emoji + val.substring(end);
    input.focus();
    input.setSelectionRange(start + emoji.length, start + emoji.length);
  }

  function toggleEmojiPicker(e) {
    e?.stopPropagation();
    if (!dom.emojiPicker) return;
    const isHidden = dom.emojiPicker.hidden;
    dom.emojiPicker.hidden = !isHidden;
    if (!dom.emojiPicker.hidden) {
      renderEmojiGrid(activeEmojiCategory);
    }
  }

  function closeEmojiPicker() {
    if (dom.emojiPicker) {
      dom.emojiPicker.hidden = true;
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
    setOwnerStatus({ human: humanHandoff, role: "Reception" });
    dom.handoffTitle.textContent = humanHandoff ? "Human receptionist" : "AI Concierge";
    dom.handoffDescription.textContent = humanHandoff
      ? "Reception is in control in this simulation. ConciergeFlow replies are paused while staff responds."
      : "AI replies are enabled for this simulation.";
    dom.conversationMode.classList.toggle("is-human", humanHandoff);
    dom.conversationMode.textContent = humanHandoff ? "You (Reception) · Live" : "AI active";
    const presenceSpan = document.querySelector(".chat-identity span");
    if (presenceSpan) presenceSpan.textContent = humanHandoff ? "Reception Staff Active" : "online";
    updateComposerState(humanHandoff, "Reception");
    addTranscript("Conversation owner", humanHandoff ? "Reception took over the conversation. ConciergeFlow replies are paused." : "ConciergeFlow replies resumed.", humanHandoff ? "human" : "ai");
    if (humanHandoff) {
      updateWorkspaceContext({ owner: "Reception", requestStatus: activeRequestStatusOr("Staff review in progress") });
      addActivity("Conversation handed to Reception", "Reception is now the conversation owner.", { status: "Staff review", level: "attention" });
      addActivity("AI replies paused", "Staff messages can be sent from Reception.", { status: "AI paused", level: "attention" });
    } else {
      updateWorkspaceContext({ owner: "ConciergeFlow", requestStatus: activeRequestStatusOr("AI responses enabled") });
      addActivity("AI replies resumed", "ConciergeFlow is again ready to respond to the guest.", { status: "AI active", level: "transition" });
    }
  }

  // Website Concierge is deliberately separate from the stay-aware simulator.
  // It speaks to the established anonymous web contract at /api/chat rather than
  // the demo-only /api/demo-chat flow above.
  const WEBSITE_SESSION_KEY = "hotel-lumiere-website-concierge-v1";
  const WEBSITE_MAX_MESSAGES = 24;
  let websiteState = null;
  let websiteSending = false;
  let websiteLastFocusedElement = null;

  const websiteDom = {
    launcher: document.querySelector("#websiteConciergeLauncher"),
    panel: document.querySelector("#websiteConciergePanel"),
    close: document.querySelector("#websiteConciergeClose"),
    messages: document.querySelector("#websiteConciergeMessages"),
    starters: document.querySelector("#websiteConciergeStarters"),
    form: document.querySelector("#websiteConciergeForm"),
    input: document.querySelector("#websiteConciergeInput"),
    send: document.querySelector("#websiteConciergeSend"),
    status: document.querySelector("#websiteConciergeStatus"),
    serviceModal: document.querySelector("#websiteServiceEnquiry"),
    serviceForm: document.querySelector("#websiteServiceEnquiryForm"),
    serviceName: document.querySelector("#websiteServiceName"),
    serviceMeta: document.querySelector("#websiteServiceMeta"),
    serviceError: document.querySelector("#websiteServiceEnquiryError"),
    serviceSubmit: document.querySelector("#websiteServiceEnquirySubmit"),
    roomModal: document.querySelector("#websiteRoomEnquiry"),
    roomForm: document.querySelector("#websiteRoomEnquiryForm"),
    roomSummary: document.querySelector("#websiteRoomSummary"),
    roomName: document.querySelector("#websiteRoomName"),
    roomMeta: document.querySelector("#websiteRoomMeta"),
    roomError: document.querySelector("#websiteRoomEnquiryError"),
    roomSubmit: document.querySelector("#websiteRoomEnquirySubmit"),
  };

  function createWebsiteSessionId() {
    const token = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `web_${token}`;
  }

  function readWebsiteState() {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(WEBSITE_SESSION_KEY) || "null");
      if (stored && /^web_[A-Za-z0-9_-]{4,110}$/.test(String(stored.sessionId || "")) && Array.isArray(stored.messages)) {
        return { sessionId: stored.sessionId, preferredLanguage: String(stored.preferredLanguage || ""), messages: stored.messages.slice(-WEBSITE_MAX_MESSAGES) };
      }
    } catch {
      // Storage is an enhancement; the anonymous chat still works without it.
    }
    return { sessionId: createWebsiteSessionId(), preferredLanguage: "", messages: [] };
  }

  function saveWebsiteState() {
    if (!websiteState) return;
    try {
      websiteState.messages = websiteState.messages.slice(-WEBSITE_MAX_MESSAGES);
      window.sessionStorage.setItem(WEBSITE_SESSION_KEY, JSON.stringify(websiteState));
    } catch {
      // Keep the active browser session usable even when storage is unavailable.
    }
  }

  function websiteTime() {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  }

  function websiteHttpUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function websiteApiUrl(path = "/api/chat") {
    const configured = String(window.CONCIERGE_WEBHOOK_URL || "").trim();
    if (!configured || /YOUR_|your-worker/i.test(configured)) return "";
    try {
      const url = new URL(configured);
      url.pathname = path;
      url.search = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function websiteCategoryLabel(category) {
    const labels = {
      accommodation: "Rooms & suites",
      restaurant: "Dining",
      spa: "Spa & wellness",
      transport: "Transport",
      tour: "Private tours",
      experience: "Private experiences",
    };
    const key = String(category || "experience").toLowerCase();
    return labels[key] || key.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function uniqueWebsiteOffers(offers) {
    const seen = new Set();
    return (Array.isArray(offers) ? offers : []).filter((offer) => {
      const key = `${String(offer?.category || "").toLowerCase()}:${String(offer?.name || "").trim().toLowerCase()}`;
      if (!offer?.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scrollWebsiteToLatest() {
    websiteDom.messages?.scrollTo({ top: websiteDom.messages.scrollHeight, behavior: "smooth" });
  }

  function setWebsiteStatus(message) {
    if (websiteDom.status) websiteDom.status.textContent = message;
  }

  function setWebsiteBusy(busy) {
    websiteSending = busy;
    if (websiteDom.input) websiteDom.input.disabled = busy;
    if (websiteDom.send) websiteDom.send.disabled = busy;
    if (websiteDom.starters) websiteDom.starters.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  }

  function websiteTextBlocks(text) {
    const rawBlocks = String(text || "").replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    return rawBlocks.flatMap((block) => {
      if (block.includes("\n") || block.length <= 360) return [block];
      const sentences = block.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [block];
      const chunks = [];
      let chunk = "";
      sentences.forEach((sentence) => {
        const candidate = `${chunk}${chunk ? " " : ""}${sentence.trim()}`;
        if (chunk && candidate.length > 300) {
          chunks.push(chunk);
          chunk = sentence.trim();
        } else {
          chunk = candidate;
        }
      });
      if (chunk) chunks.push(chunk);
      return chunks;
    });
  }

  function appendWebsiteMessageCopy(item, text, { collapsible = false } = {}) {
    const blocks = websiteTextBlocks(text);
    if (!blocks.length) return;
    const shouldCollapse = collapsible && (blocks.length > 4 || String(text || "").length > 720);
    const visibleBlocks = shouldCollapse ? blocks.slice(0, 2) : blocks;
    const appendBlocks = (target, entries) => entries.forEach((block) => {
      const copy = document.createElement("p");
      copy.className = "website-concierge-message__copy";
      copy.textContent = block;
      target.appendChild(copy);
    });
    appendBlocks(item, visibleBlocks);
    if (shouldCollapse) {
      const details = document.createElement("details");
      details.className = "website-concierge-message__details";
      const summary = document.createElement("summary");
      summary.textContent = `Read the remaining ${blocks.length - visibleBlocks.length} details`;
      details.appendChild(summary);
      const remainder = document.createElement("div");
      remainder.className = "website-concierge-message__details-copy";
      appendBlocks(remainder, blocks.slice(visibleBlocks.length));
      details.appendChild(remainder);
      item.appendChild(details);
    }
  }

  function createWebsiteMessageElement(message) {
    const item = document.createElement("article");
    const isGuest = message.sender === "guest";
    item.className = `website-concierge-message website-concierge-message--${isGuest ? "guest" : "assistant"}${message.state ? ` website-concierge-message--${message.state}` : ""}`;
    item.setAttribute("aria-label", isGuest ? "Website visitor message" : "Hôtel Lumière concierge reply");
    const label = document.createElement("span");
    label.className = "website-concierge-message__label";
    label.textContent = isGuest ? "You" : "Hôtel Lumière concierge";
    const time = document.createElement("time");
    time.textContent = message.time || websiteTime();
    item.appendChild(label);
    if (message.state === "degraded") {
      const state = document.createElement("span");
      state.className = "website-concierge-message__state";
      state.textContent = "Concierge service unavailable";
      item.appendChild(state);
    }
    appendWebsiteMessageCopy(item, message.text, { collapsible: !isGuest });
    item.appendChild(time);
    return item;
  }

  function offerMeta(offer) {
    const accommodation = String(offer?.category || "").toLowerCase() === "accommodation";
    const price = Number(offer?.price_eur);
    const priceText = Number.isFinite(price) ? `${accommodation ? "From " : ""}€${price.toFixed(0)}${accommodation ? " / night" : ""}` : "On request";
    const duration = !accommodation && Number.isFinite(Number(offer?.duration_mins)) && Number(offer.duration_mins) > 0 ? ` · ${Number(offer.duration_mins)} min` : "";
    return `${priceText}${duration}`;
  }

  function prefillWebsiteQuestion(offer) {
    const name = String(offer?.name || "this experience").trim();
    openWebsiteConcierge();
    if (websiteDom.input) websiteDom.input.value = `Tell me more about ${name}.`;
    websiteDom.input?.focus();
  }

  function createWebsiteOfferCard(offer, { external = false } = {}) {
    const card = document.createElement("article");
    card.className = "website-offer-card";
    const image = document.createElement("img");
    image.src = websiteHttpUrl(offer?.image_url) || "assets/hotel-lumiere-salon.jpg";
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.src = "assets/hotel-lumiere-salon.jpg"; }, { once: true });
    const body = document.createElement("div");
    body.className = "website-offer-card__body";
    const name = document.createElement("h4");
    name.textContent = String(offer?.name || "Hotel experience");
    const description = document.createElement("p");
    description.textContent = String(offer?.description || (external ? "An independently sourced Paris recommendation." : "A considered experience from the Hôtel Lumière collection."));
    const meta = document.createElement("span");
    meta.className = "website-offer-card__meta";
    meta.textContent = external ? "External Paris recommendation" : offerMeta(offer);
    body.append(name, description, meta);
    const actions = document.createElement("div");
    actions.className = "website-offer-card__actions";
    if (external) {
      const website = websiteHttpUrl(offer?.website_url);
      if (website) {
        const link = document.createElement("a");
        link.href = website;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View venue";
        actions.appendChild(link);
      }
      if (offer?.booking_enabled === true) {
        const enquire = document.createElement("button");
        enquire.type = "button";
        enquire.textContent = "Ask concierge to enquire";
        enquire.addEventListener("click", () => openWebsiteServiceEnquiry({ ...offer, category: offer.service_type || "Concierge", source: "external" }));
        actions.appendChild(enquire);
      }
    } else {
      const isRoom = String(offer?.category || "").toLowerCase() === "accommodation";
      const ask = document.createElement("button");
      ask.type = "button";
      ask.textContent = "Ask about this";
      ask.addEventListener("click", () => prefillWebsiteQuestion(offer));
      const enquire = document.createElement("button");
      enquire.type = "button";
      enquire.textContent = isRoom ? "Request availability" : "Make an enquiry";
      enquire.addEventListener("click", () => {
        if (isRoom) openWebsiteRoomEnquiry(offer);
        else openWebsiteServiceEnquiry(offer);
      });
      actions.append(ask, enquire);
    }
    if (actions.childElementCount) body.appendChild(actions);
    card.append(image, body);
    return card;
  }

  function createWebsiteMediaCard(media) {
    if (!media || typeof media !== "object") return null;
    const type = String(media.type || "").toLowerCase();
    const format = String(media.format || "").toUpperCase();
    const url = websiteHttpUrl(media.url);
    const thumbnail = websiteHttpUrl(media.thumbnail || media.image || media.image_url || media.imageUrl);

    if (type === "document" || format === "PDF") {
      if (!url) return null;
      const card = document.createElement("a");
      card.className = "website-media-card website-media-card--document";
      card.href = url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", `View ${media.title || media.filename || "document"}`);
      if (thumbnail) {
        const image = document.createElement("img");
        image.src = thumbnail;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => image.remove(), { once: true });
        card.appendChild(image);
      }
      const body = document.createElement("div");
      const eyebrow = document.createElement("span");
      eyebrow.textContent = format || "Document";
      const title = document.createElement("strong");
      title.textContent = String(media.title || media.filename || "Hôtel Lumière document");
      const meta = document.createElement("small");
      meta.textContent = [format || "PDF", media.size, media.pages].filter(Boolean).join(" · ");
      const action = document.createElement("em");
      action.textContent = "View brochure →";
      body.append(eyebrow, title, meta, action);
      card.appendChild(body);
      return card;
    }

    if (type === "link" && url) {
      const card = document.createElement("a");
      card.className = "website-media-card website-media-card--link";
      card.href = url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", `View ${media.title || "shared link"}`);
      if (thumbnail) {
        const image = document.createElement("img");
        image.src = thumbnail;
        image.alt = "";
        image.loading = "lazy";
        image.addEventListener("error", () => image.remove(), { once: true });
        card.appendChild(image);
      }
      const body = document.createElement("div");
      const source = document.createElement("span");
      try { source.textContent = new URL(url).hostname.replace(/^www\./, ""); } catch { source.textContent = "Shared by Hôtel Lumière"; }
      const title = document.createElement("strong");
      title.textContent = String(media.title || "Recommended details");
      const description = document.createElement("small");
      description.textContent = String(media.description || "Open the shared details.");
      const action = document.createElement("em");
      action.textContent = "View details →";
      body.append(source, title, description, action);
      card.appendChild(body);
      return card;
    }

    const imageUrl = websiteHttpUrl(media.image_url || media.imageUrl || media.thumbnail || (type === "image" ? media.url : ""));
    if (!imageUrl) return null;
    const figure = document.createElement("figure");
    figure.className = "website-media-card website-media-card--image";
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = String(media.title || "Hôtel Lumière shared image");
    image.loading = "lazy";
    image.addEventListener("error", () => figure.remove(), { once: true });
    figure.appendChild(image);
    if (media.title || media.description) {
      const caption = document.createElement("figcaption");
      const title = document.createElement("strong");
      title.textContent = String(media.title || "Hôtel Lumière");
      caption.appendChild(title);
      if (media.description) {
        const description = document.createElement("span");
        description.textContent = String(media.description);
        caption.appendChild(description);
      }
      figure.appendChild(caption);
    }
    return figure;
  }

  function renderWebsiteOfferPanel(offers, { title, intro, external = false } = {}) {
    const verified = uniqueWebsiteOffers(offers);
    if (!verified.length) return null;
    const panel = document.createElement("section");
    panel.className = `website-rich-panel${external ? " website-rich-panel--external" : ""}`;
    const eyebrow = document.createElement("p");
    eyebrow.className = "website-rich-panel__eyebrow";
    eyebrow.textContent = external ? "External / Paris recommendations" : "Hotel collection";
    const heading = document.createElement("h3");
    heading.className = "website-rich-panel__heading";
    heading.textContent = title || (external ? "Independent addresses in Paris" : "Selected for your stay");
    panel.append(eyebrow, heading);
    if (intro) {
      const copy = document.createElement("p");
      copy.className = "website-rich-panel__intro";
      copy.textContent = intro;
      panel.appendChild(copy);
    }
    const grid = document.createElement("div");
    grid.className = "website-rich-grid";
    if (external) {
      verified.forEach((offer) => grid.appendChild(createWebsiteOfferCard(offer, { external: true })));
    } else {
      const groups = new Map();
      verified.forEach((offer) => {
        const category = String(offer?.category || "experience").toLowerCase();
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(offer);
      });
      groups.forEach((entries, category) => {
        const group = document.createElement("section");
        group.className = "website-rich-group";
        const groupHeading = document.createElement("h3");
        groupHeading.textContent = `${websiteCategoryLabel(category)} · ${entries.length}`;
        group.appendChild(groupHeading);
        entries.forEach((offer) => group.appendChild(createWebsiteOfferCard(offer)));
        grid.appendChild(group);
      });
    }
    panel.appendChild(grid);
    return panel;
  }

  function renderWebsiteRoomAction() {
    const panel = document.createElement("section");
    panel.className = "website-rich-panel";
    const eyebrow = document.createElement("p");
    eyebrow.className = "website-rich-panel__eyebrow";
    eyebrow.textContent = "Reservations";
    const heading = document.createElement("h3");
    heading.className = "website-rich-panel__heading";
    heading.textContent = "Request your stay";
    const intro = document.createElement("p");
    intro.className = "website-rich-panel__intro";
    intro.textContent = "Share your dates with reservations. Availability is confirmed only after the hotel replies.";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "website-enquiry-submit";
    action.textContent = "Send room enquiry";
    action.addEventListener("click", () => openWebsiteRoomEnquiry());
    panel.append(eyebrow, heading, intro, action);
    return panel;
  }

  function renderWebsiteMessage(message, animate = true) {
    if (!websiteDom.messages) return;
    const bubble = createWebsiteMessageElement(message);
    if (!animate) bubble.style.animation = "none";
    websiteDom.messages.appendChild(bubble);
    const media = createWebsiteMediaCard(message.media);
    if (media) websiteDom.messages.appendChild(media);
    const partnerOffers = renderWebsiteOfferPanel(message.partnerOffers, { title: "From the Hôtel Lumière collection", intro: "These are hotel experiences. Choose one to prepare an enquiry." });
    if (partnerOffers) websiteDom.messages.appendChild(partnerOffers);
    const collection = renderWebsiteOfferPanel(message.hotelCollection, { title: "Explore the hotel collection", intro: "Every option below is offered by Hôtel Lumière and grouped by service." });
    if (collection) websiteDom.messages.appendChild(collection);
    const recommendations = renderWebsiteOfferPanel(message.recommendations, { external: true, title: "Paris recommendations", intro: "Independently sourced venues, not Hôtel Lumière partners. Availability is not confirmed." });
    if (recommendations) websiteDom.messages.appendChild(recommendations);
    if (message.roomBooking) websiteDom.messages.appendChild(renderWebsiteRoomAction());
  }

  function renderWebsiteConversation() {
    if (!websiteDom.messages || !websiteState) return;
    websiteDom.panel?.classList.toggle("is-empty", !websiteState.messages.length);
    websiteDom.messages.replaceChildren();
    if (!websiteState.messages.length) {
      renderWebsiteMessage({ sender: "assistant", text: "Good evening. How may I assist with your stay in Paris?", time: "" }, false);
      return;
    }
    websiteState.messages.forEach((message) => renderWebsiteMessage(message, false));
    scrollWebsiteToLatest();
  }

  function appendWebsiteMessage(text, sender, result = {}, persist = true) {
    const message = {
      text: String(text || ""),
      sender,
      time: websiteTime(),
      recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
      partnerOffers: Array.isArray(result.partner_offers) ? result.partner_offers : [],
      hotelCollection: Array.isArray(result.hotel_collection) ? result.hotel_collection : [],
      roomBooking: result.room_booking === true || result.intent === "room_enquiry",
      media: result.media && typeof result.media === "object" ? result.media : null,
      state: String(result.state || ""),
    };
    renderWebsiteMessage(message);
    if (persist && websiteState) {
      websiteState.messages.push(message);
      saveWebsiteState();
    }
    scrollWebsiteToLatest();
  }

  function showWebsiteLoading(message) {
    const status = document.createElement("p");
    status.id = "websiteConciergeLoading";
    status.className = "website-concierge-status website-concierge-status--loading";
    status.setAttribute("role", "status");
    status.textContent = message;
    websiteDom.messages?.appendChild(status);
    scrollWebsiteToLatest();
  }

  function clearWebsiteLoading() {
    document.querySelector("#websiteConciergeLoading")?.remove();
  }

  async function parseWebsiteEventStream(stream, onStatus) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (!data) continue;
          let payload;
          try { payload = JSON.parse(data); } catch { continue; }
          if (payload.type === "status") onStatus(payload.message || "Considering your request…");
          if (payload.type === "error") throw new Error(payload.message || "The concierge service could not complete this request.");
          if (payload.type === "final") return payload;
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }
    throw new Error("The concierge did not return a final response.");
  }

  async function requestWebsiteConciergeReply(message) {
    const endpoint = websiteApiUrl("/api/chat");
    if (!endpoint) throw new Error("The concierge service is not configured.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
        body: JSON.stringify({
          message,
          sessionId: websiteState.sessionId,
          preferredLanguage: websiteState.preferredLanguage || "",
          hotel: "Hôtel Lumière Paris",
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Concierge returned HTTP ${response.status}`);
      if ((response.headers.get("content-type") || "").includes("text/event-stream") && response.body) {
        return parseWebsiteEventStream(response.body, (status) => {
          clearWebsiteLoading();
          showWebsiteLoading(status);
          setWebsiteStatus(status);
        });
      }
      return response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function sendWebsiteMessage(text) {
    const message = String(text || "").trim();
    if (!message || websiteSending || !websiteState) return;
    appendWebsiteMessage(message, "guest");
    if (websiteDom.input) websiteDom.input.value = "";
    setWebsiteBusy(true);
    setWebsiteStatus("Concierge is considering your request");
    showWebsiteLoading("Considering your request…");
    try {
      const result = await requestWebsiteConciergeReply(message);
      clearWebsiteLoading();
      const language = String(result?.language || "");
      if (["en", "fr", "es", "it", "de", "ar", "ja", "zh"].includes(language)) {
        websiteState.preferredLanguage = language;
      }
      appendWebsiteMessage(result?.reply || "The concierge did not return a written reply. Please try again.", "assistant", result || {});
      setWebsiteStatus("Private website conversation");
    } catch (error) {
      clearWebsiteLoading();
      appendWebsiteMessage("The concierge response is temporarily unavailable. Please try again shortly, or contact the hotel directly.", "assistant", { state: "degraded" });
      setWebsiteStatus("Concierge temporarily unavailable");
    } finally {
      setWebsiteBusy(false);
      if (!websiteDom.panel?.hidden) websiteDom.input?.focus();
    }
  }

  function openWebsiteConcierge({ focus = true } = {}) {
    if (!websiteDom.panel || !websiteDom.launcher) return;
    websiteLastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    websiteDom.panel.hidden = false;
    websiteDom.panel.setAttribute("aria-hidden", "false");
    websiteDom.launcher.setAttribute("aria-expanded", "true");
    if (focus) window.setTimeout(() => websiteDom.input?.focus(), 80);
  }

  function closeWebsiteConcierge({ restoreFocus = true } = {}) {
    if (!websiteDom.panel || websiteDom.panel.hidden) return false;
    websiteDom.panel.hidden = true;
    websiteDom.panel.setAttribute("aria-hidden", "true");
    websiteDom.launcher?.setAttribute("aria-expanded", "false");
    if (restoreFocus) websiteLastFocusedElement?.focus?.();
    return true;
  }

  function closeWebsiteEnquiries({ restoreFocus = true } = {}) {
    const openModal = [websiteDom.serviceModal, websiteDom.roomModal].find((modal) => modal && !modal.hidden);
    if (!openModal) return false;
    openModal.hidden = true;
    if (restoreFocus) websiteDom.panel?.querySelector("button, textarea")?.focus();
    return true;
  }

  function openWebsiteServiceEnquiry(offer = {}) {
    if (!websiteDom.serviceModal || !websiteDom.serviceForm) return;
    websiteDom.serviceForm.reset();
    if (websiteDom.serviceError) websiteDom.serviceError.textContent = "";
    if (websiteDom.serviceName) websiteDom.serviceName.textContent = String(offer?.name || "Selected experience");
    if (websiteDom.serviceMeta) websiteDom.serviceMeta.textContent = offerMeta(offer);
    websiteDom.serviceForm.elements.serviceName.value = String(offer?.name || "Selected experience");
    websiteDom.serviceForm.elements.serviceType.value = String(offer?.category || offer?.service_type || "Concierge");
    websiteDom.serviceForm.elements.source.value = offer?.source === "external" ? "external" : "partner";
    websiteDom.serviceModal.hidden = false;
    window.setTimeout(() => websiteDom.serviceForm.elements.guestName?.focus(), 60);
  }

  function openWebsiteRoomEnquiry(offer = {}) {
    if (!websiteDom.roomModal || !websiteDom.roomForm) return;
    websiteDom.roomForm.reset();
    if (websiteDom.roomError) websiteDom.roomError.textContent = "";
    const selectedRoom = String(offer?.name || "").trim();
    if (websiteDom.roomSummary) websiteDom.roomSummary.hidden = !selectedRoom;
    if (selectedRoom) {
      if (websiteDom.roomName) websiteDom.roomName.textContent = selectedRoom;
      if (websiteDom.roomMeta) websiteDom.roomMeta.textContent = offerMeta(offer);
    }
    websiteDom.roomForm.elements.serviceName.value = selectedRoom;
    const today = new Date().toISOString().slice(0, 10);
    websiteDom.roomForm.elements.checkIn.min = today;
    websiteDom.roomForm.elements.checkOut.min = today;
    websiteDom.roomForm.elements.adults.value = "2";
    websiteDom.roomForm.elements.children.value = "0";
    websiteDom.roomForm.elements.rooms.value = "1";
    websiteDom.roomModal.hidden = false;
    window.setTimeout(() => websiteDom.roomForm.elements.firstName?.focus(), 60);
  }

  async function submitWebsiteServiceEnquiry(event) {
    event.preventDefault();
    if (!websiteDom.serviceForm?.reportValidity()) return;
    const endpoint = websiteApiUrl("/api/booking-enquiry");
    if (!endpoint) {
      websiteDom.serviceError.textContent = "The concierge enquiry could not be sent just now. Please try again shortly.";
      return;
    }
    const form = new FormData(websiteDom.serviceForm);
    const payload = { guestName: form.get("guestName"), email: form.get("email"), preferredDate: form.get("preferredDate"), preferredTime: form.get("preferredTime"), partySize: form.get("partySize"), notes: form.get("notes"), serviceName: form.get("serviceName"), serviceType: form.get("serviceType"), source: form.get("source"), consent: form.get("consent") === "yes", sessionId: websiteState?.sessionId || "", language: websiteState?.preferredLanguage || "en" };
    websiteDom.serviceError.textContent = "";
    websiteDom.serviceSubmit.disabled = true;
    websiteDom.serviceSubmit.textContent = "Sending enquiry…";
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "We could not record your enquiry.");
      closeWebsiteEnquiries({ restoreFocus: false });
      setWebsiteStatus("Enquiry received — hotel follow-up requested");
    } catch (error) {
      websiteDom.serviceError.textContent = "The concierge enquiry could not be sent just now. Please try again shortly.";
    } finally {
      websiteDom.serviceSubmit.disabled = false;
      websiteDom.serviceSubmit.textContent = "Send concierge enquiry";
    }
  }

  async function submitWebsiteRoomEnquiry(event) {
    event.preventDefault();
    if (!websiteDom.roomForm?.reportValidity()) return;
    const form = new FormData(websiteDom.roomForm);
    const checkIn = String(form.get("checkIn") || "");
    const checkOut = String(form.get("checkOut") || "");
    if (checkOut <= checkIn) {
      websiteDom.roomError.textContent = "Check-out must be after check-in.";
      return;
    }
    const endpoint = websiteApiUrl("/api/room-enquiry");
    if (!endpoint) {
      websiteDom.roomError.textContent = "The room enquiry could not be sent just now. Please try again shortly.";
      return;
    }
    const payload = { firstName: form.get("firstName"), lastName: form.get("lastName"), email: form.get("email"), phone: form.get("phone"), checkIn, checkOut, adults: form.get("adults"), children: form.get("children"), rooms: form.get("rooms"), serviceName: form.get("serviceName"), preference: form.get("preference"), notes: form.get("notes"), consent: form.get("consent") === "yes", sessionId: websiteState?.sessionId || "", language: websiteState?.preferredLanguage || "en" };
    websiteDom.roomError.textContent = "";
    websiteDom.roomSubmit.disabled = true;
    websiteDom.roomSubmit.textContent = "Sending room enquiry…";
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "We could not record your room enquiry.");
      closeWebsiteEnquiries({ restoreFocus: false });
      setWebsiteStatus("Room enquiry received — reservations follow-up requested");
    } catch (error) {
      websiteDom.roomError.textContent = "The room enquiry could not be sent just now. Please try again shortly.";
    } finally {
      websiteDom.roomSubmit.disabled = false;
      websiteDom.roomSubmit.textContent = "Send room enquiry";
    }
  }

  function resetWebsiteConcierge() {
    try { window.sessionStorage.removeItem(WEBSITE_SESSION_KEY); } catch { /* Storage may be unavailable. */ }
    websiteState = { sessionId: createWebsiteSessionId(), preferredLanguage: "", messages: [] };
    if (websiteDom.input) websiteDom.input.value = "";
    clearWebsiteLoading();
    closeWebsiteEnquiries({ restoreFocus: false });
    closeWebsiteConcierge({ restoreFocus: false });
    setWebsiteBusy(false);
    setWebsiteStatus("Private website conversation");
    renderWebsiteConversation();
  }

  function handleWebsiteEscape() {
    if (closeWebsiteEnquiries()) return true;
    return closeWebsiteConcierge();
  }

  function initWebsiteConcierge() {
    if (!websiteDom.launcher || !websiteDom.panel) return;
    websiteState = readWebsiteState();
    renderWebsiteConversation();
    websiteDom.launcher.addEventListener("click", () => openWebsiteConcierge());
    websiteDom.close?.addEventListener("click", () => closeWebsiteConcierge());
    document.querySelectorAll("[data-website-open]").forEach((button) => button.addEventListener("click", () => openWebsiteConcierge()));
    document.querySelectorAll("[data-website-prompt]").forEach((button) => button.addEventListener("click", () => {
      openWebsiteConcierge();
      if (websiteDom.input) websiteDom.input.value = String(button.dataset.websitePrompt || "");
      websiteDom.input?.focus();
    }));
    document.querySelectorAll("[data-website-room-enquiry]").forEach((button) => button.addEventListener("click", () => openWebsiteRoomEnquiry()));
    websiteDom.form?.addEventListener("submit", (event) => { event.preventDefault(); sendWebsiteMessage(websiteDom.input?.value || ""); });
    websiteDom.input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); websiteDom.form?.requestSubmit(); }
    });
    document.querySelectorAll("[data-website-close-enquiry]").forEach((button) => button.addEventListener("click", () => closeWebsiteEnquiries()));
    websiteDom.serviceForm?.addEventListener("submit", submitWebsiteServiceEnquiry);
    websiteDom.roomForm?.addEventListener("submit", submitWebsiteRoomEnquiry);
  }

  // Multi-Screen Navigation Router. The V2 shell sits around these existing
  // simulator views; it does not replace their session or conversation logic.
  let currentScreen = "entry";

  const sidebarToggle = document.querySelector("#sidebarToggle");
  const sidebarBackdrop = document.querySelector("#sidebarBackdrop");
  const resetDemoButton = document.querySelector("#resetDemo");

  function setSidebarOpen(isOpen) {
    document.body.classList.toggle("sidebar-open", isOpen);
    sidebarToggle?.setAttribute("aria-expanded", String(isOpen));
  }

  function showScreen(screenName, updateHash = true) {
    const targetScreen = document.querySelector(`.app-screen[data-screen="${screenName}"]`);
    if (!targetScreen) return;

    if (screenName !== "website") {
      closeWebsiteEnquiries({ restoreFocus: false });
      closeWebsiteConcierge({ restoreFocus: false });
    }
    currentScreen = screenName;
    document.body.classList.toggle("demo-locked", screenName === "entry");
    setSidebarOpen(false);

    document.querySelectorAll(".app-screen").forEach((screen) => {
      if (screen.dataset.screen === screenName) {
        screen.classList.add("is-active");
        screen.removeAttribute("hidden");
      } else {
        screen.classList.remove("is-active");
        screen.setAttribute("hidden", "true");
      }
    });

    // Keep the compact product navigation in sync with the active workspace.
    document.querySelectorAll(".product-nav-button").forEach((button) => {
      const isActive = button.dataset.nav === screenName;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    if (screenName === "requests") updateRequestSurfaces();

    if (updateHash) {
      window.location.hash = screenName === "entry" ? "" : `#${screenName}`;
    }

    // Screen reader announcement for route change
    const announcer = document.querySelector("#screenAnnouncer");
    if (announcer) {
      const screenTitles = {
        entry: "Private product demonstration access screen",
        dashboard: "ConciergeFlow product overview",
        website: "Website Concierge product preview",
        mission: "Guest journey launcher",
        guest: "Live WhatsApp concierge simulation",
        inbox: "Reception staff view",
        requests: "Hotel requests workspace",
      };
      announcer.textContent = `${screenTitles[screenName] || screenName} view active.`;
    }

    // Accessible focus management: focus main heading without scrolling
    const heading = targetScreen.querySelector("h1, h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }

    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function initScreenRouter() {
    // Theme Toggle Handler (Light / Dark)
    const themeToggle = document.querySelector("#themeToggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("lumiere-demo-theme", next);
      });
      const savedTheme = localStorage.getItem("lumiere-demo-theme");
      if (savedTheme) {
        document.documentElement.setAttribute("data-theme", savedTheme);
      }
    }

    // Cosmetic Entry Form Passcode Submit
    const entryForm = document.querySelector("#entryForm");
    if (entryForm) {
      entryForm.addEventListener("submit", (e) => {
        e.preventDefault();
        showToast("Access verified. Initializing operations suite...");
        showScreen("dashboard");
      });
    }

    // Navigation buttons & cards with [data-nav]
    document.addEventListener("click", (event) => {
      const navTarget = event.target.closest("[data-nav]");
      if (!navTarget) return;
      const targetScreen = navTarget.dataset.nav;
      if (targetScreen) {
        event.preventDefault();
        showScreen(targetScreen);
      }
    });

    document.querySelectorAll(".journey-choice").forEach((choice) => {
      choice.addEventListener("click", () => {
        dom.scenario.value = choice.dataset.journey;
        syncJourneyLauncher();
      });
      choice.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = choice.nextElementSibling || document.querySelector(".journey-choice");
          next?.focus();
          next?.click();
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          const choices = [...document.querySelectorAll(".journey-choice")];
          const previous = choice.previousElementSibling || choices[choices.length - 1];
          previous?.focus();
          previous?.click();
        }
      });
    });
    dom.scenario.addEventListener("change", syncJourneyLauncher);
    syncJourneyLauncher();

    document.querySelectorAll("[data-request-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        requestState.filter = button.dataset.requestFilter || "open";
        renderRequestQueue();
      });
    });
    dom.workspaceRequestOpen?.addEventListener("click", () => {
      const request = activeRequest();
      if (request) selectRequest(request.id);
      showScreen("requests");
    });
    dom.receptionRequestOpen?.addEventListener("click", () => {
      const request = activeRequest();
      if (request) selectRequest(request.id);
      showScreen("requests");
    });

    sidebarToggle?.addEventListener("click", () => setSidebarOpen(!document.body.classList.contains("sidebar-open")));
    sidebarBackdrop?.addEventListener("click", () => setSidebarOpen(false));
    resetDemoButton?.addEventListener("click", () => {
      dom.form.reset();
      launchSimulation();
      resetWebsiteConcierge();
      showScreen("dashboard");
      showToast("Demo reset. Choose a guest journey when you’re ready.");
    });

    // Escape returns to the product overview, without disturbing the existing
    // service sheet and emoji-picker close behaviour above.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (document.body.classList.contains("sidebar-open")) {
          setSidebarOpen(false);
          return;
        }
        if (!dom.sheet.hidden) {
          closeServices();
          return;
        }
        if (handleWebsiteEscape()) return;
        if (currentScreen !== "entry" && currentScreen !== "dashboard") {
          showScreen("dashboard");
          return;
        }
      }
    });

    // Hash change handler for direct links and browser back/forward
    const handleHash = () => {
      const hash = (window.location.hash || "").replace("#", "").trim();
      if (hash && document.querySelector(`.app-screen[data-screen="${hash}"]`)) {
        showScreen(hash, false);
      }
    };
    window.addEventListener("hashchange", handleHash);
    if (window.location.hash) handleHash();
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    launchSimulation();
    showToast("Simulation initialized. Switching to Guest Channel...");
    showScreen("guest");
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

  // The WhatsApp simulator uses a single-line composer. Make Enter an
  // explicit submit action instead of relying on browser-specific implicit
  // form submission, while preserving the existing submit handler.
  dom.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      dom.messageForm.requestSubmit();
    }
  });

  dom.chatMessages.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    if (button.dataset.action === "view-services") {
      disableMessageActions(button);
      sendGuestMessage("View Services");
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

  // Emoji Picker Listeners
  if (dom.emojiPickerBtn) dom.emojiPickerBtn.addEventListener("click", toggleEmojiPicker);
  if (dom.closeEmojiPicker) dom.closeEmojiPicker.addEventListener("click", closeEmojiPicker);
  document.querySelectorAll(".emoji-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => renderEmojiGrid(btn.dataset.cat));
  });
  document.addEventListener("click", (event) => {
    if (dom.emojiPicker && !dom.emojiPicker.hidden) {
      if (!dom.emojiPicker.contains(event.target) && !dom.emojiPickerBtn?.contains(event.target)) {
        closeEmojiPicker();
      }
    }
  });

  // Receptionist Inbox Live Staff Form Listener
  if (dom.inboxStaffForm) {
    dom.inboxStaffForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = (dom.inboxStaffInput?.value || "").trim();
      if (!text) return;
      dom.inboxStaffInput.value = "";
      sendStaffMessage(text);
      showToast("Reply sent to guest chat as Receptionist.");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dom.emojiPicker && !dom.emojiPicker.hidden) {
        closeEmojiPicker();
        return;
      }
      if (!dom.sheet.hidden) {
        closeServices();
        return;
      }
    }
  });

  initSheetGestures();
  initWebsiteConcierge();
  initScreenRouter();
  launchSimulation();
  if (!window.location.hash) {
    showScreen("entry", false);
  }
})();
