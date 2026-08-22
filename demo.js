/**
 * Hotel AI Operations Simulator — Client Engine (Backend Connected)
 * Real-time connection to Cloudflare Worker /api/demo-chat with Is_Demo safety lock.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Configuration ---
  const API_ENDPOINT = 'https://conciergeflow-api.conciergeflow-worker.workers.dev/api/demo-chat';

  // --- DOM Elements ---
  const form = document.getElementById('simulator-form');
  const guestNameInput = document.getElementById('guest-name');
  const languageSelect = document.getElementById('guest-language');
  const scenarioSelect = document.getElementById('scenario-select');

  // WhatsApp DOM Elements
  const chatCanvas = document.getElementById('wa-chat-canvas');
  const msgInput = document.getElementById('wa-input-message');
  const sendBtn = document.getElementById('wa-btn-send');
  const presenceText = document.getElementById('wa-presence');
  const sheetBackdrop = document.getElementById('wa-bottom-sheet-backdrop');
  const sheetCloseBtn = document.getElementById('wa-sheet-close');
  const sheetItemButtons = document.querySelectorAll('.sheet-item-btn');

  // Receptionist Inbox DOM Elements
  const receptionAvatar = document.getElementById('reception-avatar');
  const receptionGuestName = document.getElementById('reception-guest-name');
  const receptionScenario = document.getElementById('reception-scenario');
  const receptionLanguage = document.getElementById('reception-language');
  const handoffBtn = document.getElementById('btn-handoff');
  const handoffBtnText = document.getElementById('btn-handoff-text');
  const handoffStatusBadge = document.getElementById('handoff-status-badge');
  const handoffStatusText = document.getElementById('handoff-status-text');
  const handoffNote = document.getElementById('handoff-note');
  const transcriptFeed = document.getElementById('transcript-feed');

  // System State
  let isHumanHandoff = false;
  let activeTimers = [];
  let conversationHistory = [];
  let typingBubbleEl = null;

  // Multilingual Scenario Fallback Templates (for initial prompt and offline safety)
  const SCENARIO_TEMPLATES = {
    pre_arrival: {
      label: '48h Pre-Arrival',
      en: {
        greeting: (name) => `Bonjour ${name}, we look forward to welcoming you to Hôtel Lumière Paris in 48 hours. May we arrange your airport transfer or assist with dining reservations?`,
        quickReplies: ['Book Airport Transfer', 'Dining Reservations', 'No, thank you'],
        hasServicesBtn: true,
      },
      fr: {
        greeting: (name) => `Bonjour ${name}, nous avons le plaisir de vous accueillir à l'Hôtel Lumière Paris dans 48h. Souhaitez-vous réserver un transfert privé ou une table au restaurant ?`,
        quickReplies: ['Réserver un transfert', 'Table au restaurant', 'Non, merci'],
        hasServicesBtn: true,
      },
      es: {
        greeting: (name) => `Hola ${name}, esperamos darle la bienvenida a Hôtel Lumière Paris en 48 horas. ¿Desea reservar su traslado privado o mesa en nuestro restaurante?`,
        quickReplies: ['Reservar traslado', 'Reservar restaurante', 'No, gracias'],
        hasServicesBtn: true,
      },
      de: {
        greeting: (name) => `Guten Tag ${name}, wir freuen uns, Sie in 48 Stunden im Hôtel Lumière Paris begrüßen zu dürfen. Dürfen wir Ihren Flughafentransfer oder ein Abendessen arrangieren?`,
        quickReplies: ['Flughafentransfer', 'Tisch reservieren', 'Nein, danke'],
        hasServicesBtn: true,
      },
      it: {
        greeting: (name) => `Buongiorno ${name}, siamo lieti di accoglierla all'Hôtel Lumière Paris tra 48 ore. Desidera prenotare un transfer o una cena al ristorante?`,
        quickReplies: ['Prenota transfer', 'Tavolo al ristorante', 'No, grazie'],
        hasServicesBtn: true,
      },
      ja: {
        greeting: (name) => `${name}様、オテル・リュミエール・パリへのお越しを心よりお待ち申し上げております（ご到着まで48時間）。空港送迎やディナーの手配を承りましょうか？`,
        quickReplies: ['空港送迎を予約', 'レストラン予約', '手配不要'],
        hasServicesBtn: true,
      },
      ar: {
        greeting: (name) => `مرحباً ${name}، نتطلع لاستقبالكم في فندق لوميير باريس بعد 48 ساعة. هل ترغبون في حجز خدمة التوصيل الخاصة أو حجز طاولة عشاء؟`,
        quickReplies: ['حجز توصيل خاص', 'حجز طاولة عشاء', 'شكراً، لا داعي'],
        hasServicesBtn: true,
      },
    },
    in_stay: {
      label: 'In-Stay Request',
      en: {
        initialGuestMessage: 'Hello, could we please have additional towels delivered to our room?',
        greeting: (name) => `Certainly, ${name}. I have notified housekeeping, and fresh towels will be brought to your room shortly. May I assist with anything else?`,
        quickReplies: ['Thank you', 'Request Room Cleaning', 'Speak with Reception'],
        hasServicesBtn: true,
      },
      fr: {
        initialGuestMessage: 'Bonjour, pourriez-vous nous apporter des serviettes supplémentaires dans la chambre s\'il vous plaît ?',
        greeting: (name) => `Certainement, ${name}. Notre équipe d'étage vient d'être prévenue et vous apporte des serviettes propres sans délai. Puis-je vous aider pour autre chose ?`,
        quickReplies: ['Merci beaucoup', 'Ménage de la chambre', 'Parler à la réception'],
        hasServicesBtn: true,
      },
      es: {
        initialGuestMessage: 'Hola, ¿podrían traernos toallas adicionales a la habitación por favor?',
        greeting: (name) => `Con gusto, ${name}. He avisado a gobernanta y le llevarán toallas limpias enseguida. ¿Necesita algo más?`,
        quickReplies: ['Muchas gracias', 'Limpieza de habitación', 'Hablar con recepción'],
        hasServicesBtn: true,
      },
      de: {
        initialGuestMessage: 'Hallo, könnten wir bitte zusätzliche Handtücher auf unser Zimmer bekommen?',
        greeting: (name) => `Sehr gerne, ${name}. Der Zimmerservice wurde benachrichtigt und bringt Ihnen umgehend frische Handtücher. Kann ich noch etwas für Sie tun?`,
        quickReplies: ['Vielen Dank', 'Zimmerreinigung', 'Rezeption sprechen'],
        hasServicesBtn: true,
      },
      it: {
        initialGuestMessage: 'Buongiorno, potremmo avere degli asciugamani extra in camera per favore?',
        greeting: (name) => `Certamente, ${name}. Il personale di servizio è stato avvisato e le porterà gli asciugamani a breve. Posso aiutarla in altro?`,
        quickReplies: ['Grazie mille', 'Pulizia camera', 'Parla con la reception'],
        hasServicesBtn: true,
      },
      ja: {
        initialGuestMessage: 'こんにちは、お部屋に追加のタオルを持ってきていただけますか？',
        greeting: (name) => `かしこまりました、${name}様。客室係に連絡いたしましたので、まもなく新しいタオルをお届けいたします。他にご要望はございますか？`,
        quickReplies: ['ありがとうございます', '客室清掃の依頼', 'フロントと話す'],
        hasServicesBtn: true,
      },
      ar: {
        initialGuestMessage: 'مرحباً، هل يمكنكم تزويدنا بمناشف إضافية في الغرفة من فضلكم؟',
        greeting: (name) => `بكل سرور ${name}. تم إبلاغ خدمة الغرف وسيتم إحضار المناشف إلى غرفتكم حالاً. هل تحتاجون لأي خدمة أخرى؟`,
        quickReplies: ['شكراً جزيلاً', 'طلب تنظيف الغرفة', 'التحدث مع الاستقبال'],
        hasServicesBtn: true,
      },
    },
    checkout_review: {
      label: 'Checkout Review',
      en: {
        greeting: (name) => `Dear ${name}, thank you for staying with us at Hôtel Lumière Paris. We hope you had a pleasant journey. How would you rate your stay with us?`,
        quickReplies: ['Excellent — 5 Stars', 'Good', 'Leave Private Feedback'],
        hasServicesBtn: false,
      },
      fr: {
        greeting: (name) => `Cher ${name}, merci d'avoir séjourné à l'Hôtel Lumière Paris. Nous espérons que votre séjour fut remarquable. Comment évaluez-vous votre expérience ?`,
        quickReplies: ['Excellent — 5 Étoiles', 'Bien', 'Remarque pour la direction'],
        hasServicesBtn: false,
      },
      es: {
        greeting: (name) => `Estimado/a ${name}, gracias por su estancia en Hôtel Lumière Paris. ¿Cómo calificaría su experiencia con nosotros?`,
        quickReplies: ['Excelente — 5 Estrellas', 'Buena', 'Comentario privado'],
        hasServicesBtn: false,
      },
      de: {
        greeting: (name) => `Sehr geehrte/r ${name}, vielen Dank für Ihren Aufenthalt im Hôtel Lumière Paris. Wie bewerten Sie Ihren Besuch bei uns?`,
        quickReplies: ['Ausgezeichnet — 5 Sterne', 'Gut', 'Feedback für Direktion'],
        hasServicesBtn: false,
      },
      it: {
        greeting: (name) => `Gentile ${name}, grazie per aver soggiornato all'Hôtel Lumière Paris. Come valuterebbe il suo soggiorno con noi?`,
        quickReplies: ['Eccellente — 5 Stelle', 'Buono', 'Commento alla direzione'],
        hasServicesBtn: false,
      },
      ja: {
        greeting: (name) => `${name}様、オテル・リュミエール・パリにご宿泊いただき誠にありがとうございました。ご滞在はいかがでしたでしょうか？`,
        quickReplies: ['素晴らしい — 5つ星', '満足', '支配人へのご意見'],
        hasServicesBtn: false,
      },
      ar: {
        greeting: (name) => `عزيزنا ${name}، شكراً لإقامتكم في فندق لوميير باريس. نتمنى أنكم قضيتم وقتاً ممتعاً. كيف تقيّمون تجربتكم معنا؟`,
        quickReplies: ['ممتاز — 5 نجوم', 'جيد', 'ملاحظة خاصة للإدارة'],
        hasServicesBtn: false,
      },
    },
  };

  // Helper: Format Time string HH:MM
  function getTimestamp() {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Helper: Generate Initials for Avatar
  function getInitials(name) {
    const clean = String(name || '').trim();
    if (!clean) return 'G';
    const parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // Helper: Clear scheduled timers
  function clearAllTimers() {
    activeTimers.forEach((id) => clearTimeout(id));
    activeTimers = [];
  }

  // Typing Loading State
  function showTypingIndicator() {
    if (typingBubbleEl) return;
    presenceText.textContent = 'typing...';

    typingBubbleEl = document.createElement('div');
    typingBubbleEl.className = 'wa-typing-bubble';
    typingBubbleEl.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;
    chatCanvas.appendChild(typingBubbleEl);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;
  }

  function hideTypingIndicator() {
    presenceText.textContent = isHumanHandoff ? 'Human Staff Active' : 'online';
    if (typingBubbleEl && typingBubbleEl.parentNode) {
      typingBubbleEl.parentNode.removeChild(typingBubbleEl);
    }
    typingBubbleEl = null;
  }

  // Append entry to Receptionist Audit Log
  function logTranscript(actor, text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const meta = document.createElement('div');
    meta.className = 'log-time-actor';
    meta.textContent = `[${getTimestamp()}] ${actor}`;

    const body = document.createElement('div');
    body.className = 'log-body';
    body.textContent = text;

    entry.appendChild(meta);
    entry.appendChild(body);

    transcriptFeed.appendChild(entry);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }

  // Render a Message Bubble to WhatsApp Chat Canvas
  function appendMessage({ sender, text, quickReplies = [], hasServicesBtn = false, time = getTimestamp() }) {
    const container = document.createElement('div');
    container.className = `wa-bubble-container ${sender === 'guest' ? 'outgoing' : 'incoming'}`;

    const bubble = document.createElement('div');
    bubble.className = 'wa-bubble';

    const textContent = document.createElement('div');
    textContent.textContent = text;
    bubble.appendChild(textContent);

    const meta = document.createElement('div');
    meta.className = 'wa-bubble-meta';
    const timeSpan = document.createElement('span');
    timeSpan.textContent = time;
    meta.appendChild(timeSpan);

    if (sender === 'guest') {
      const ticks = document.createElement('span');
      ticks.className = 'wa-ticks';
      ticks.textContent = '✓✓';
      meta.appendChild(ticks);
    }
    bubble.appendChild(meta);
    container.appendChild(bubble);

    // Render "View Services" list message button
    if (hasServicesBtn) {
      const listBtn = document.createElement('button');
      listBtn.type = 'button';
      listBtn.className = 'wa-list-message-btn';
      listBtn.textContent = 'View Services';
      listBtn.setAttribute('aria-haspopup', 'dialog');
      listBtn.addEventListener('click', () => openBottomSheet());
      container.appendChild(listBtn);
    }

    // Render up to 3 Quick Reply real <button> elements
    if (quickReplies && quickReplies.length > 0) {
      const qrWrapper = document.createElement('div');
      qrWrapper.className = 'wa-quick-replies';
      qrWrapper.setAttribute('role', 'group');
      qrWrapper.setAttribute('aria-label', 'Quick reply options');

      quickReplies.slice(0, 3).forEach((qrText) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wa-quick-reply-btn';
        btn.textContent = qrText;
        btn.addEventListener('click', () => handleGuestReply(qrText));
        qrWrapper.appendChild(btn);
      });

      container.appendChild(qrWrapper);
    }

    chatCanvas.appendChild(container);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;

    // Track in conversation history
    conversationHistory.push({
      role: sender === 'guest' ? 'user' : 'assistant',
      content: text,
    });

    // Synchronize to Receptionist Log
    logTranscript(
      sender === 'guest' ? 'Guest' : (isHumanHandoff ? 'Human Staff' : 'AI Concierge'),
      text,
      sender === 'guest' ? 'guest' : 'ai'
    );
  }

  // Handle Guest Reply with Live Backend Fetch
  async function handleGuestReply(text) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    appendMessage({ sender: 'guest', text: cleanText });

    // If human handoff is active, suppress automated AI reply
    if (isHumanHandoff) {
      logTranscript('System Note', 'Automated AI reply suppressed — Human staff is currently handling session.', 'handoff');
      return;
    }

    showTypingIndicator();

    const guestName = guestNameInput.value.trim() || 'Guest';
    const lang = languageSelect.value || 'en';
    const scenarioKey = scenarioSelect.value || 'pre_arrival';

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          guestName,
          language: lang,
          scenario: scenarioKey,
          is_demo: true,
          message: cleanText,
          chatHistory: conversationHistory,
        }),
      });

      hideTypingIndicator();

      if (!response.ok) {
        throw new Error(`Worker responded with ${response.status}`);
      }

      const data = await response.json();
      const reply = data.reply || 'Thank you. Your request has been noted by our concierge team.';
      const quickReplies = Array.isArray(data.quickReplies) ? data.quickReplies : [];
      const hasServicesBtn = scenarioKey !== 'checkout_review';

      appendMessage({
        sender: 'ai',
        text: reply,
        quickReplies,
        hasServicesBtn,
      });

      // If backend tool triggered an operational staff alert, print it to Receptionist Inbox
      if (data.staffAlert) {
        logTranscript(
          'Staff Router',
          `🛎️ Actionable Task Dispatched: [${data.staffAlert.role}] "${data.staffAlert.task}" (${data.staffAlert.status})`,
          'handoff'
        );
      }
    } catch (err) {
      console.warn('Backend fetch failed, using fallback engine:', err);
      hideTypingIndicator();

      // Graceful fallback response if worker is temporarily unreachable
      const lower = cleanText.toLowerCase();
      let fallbackText = '';
      if (lower.includes('transfer') || lower.includes('chauffeur') || lower.includes('mercedes')) {
        fallbackText = 'Splendid choice. I have recorded your private Mercedes S-Class transfer request. Our concierge will coordinate flight details with you shortly.';
      } else if (lower.includes('towel') || lower.includes('linen') || lower.includes('clean')) {
        fallbackText = 'Certainly. Housekeeping has been alerted directly and is delivering fresh amenities to your room.';
        logTranscript('Staff Router', '🛎️ Task Routed: [Housekeeping] Extra amenities to guest room (Dispatched)', 'handoff');
      } else if (lower.includes('dining') || lower.includes('table') || lower.includes('restaurant') || lower.includes('rooftop')) {
        fallbackText = 'A table request for our Eiffel View Rooftop has been created. Our maître d’ will ensure a prime table for your evening.';
      } else if (lower.includes('5 star') || lower.includes('5 stars') || lower.includes('excellent')) {
        fallbackText = 'We are delighted to hear you had a magnificent stay! We would be deeply honored if you could share your kind words on Google Reviews or TripAdvisor.';
      } else {
        fallbackText = `Thank you, ${guestName}. I have noted your request regarding "${cleanText}". Please let us know if there is anything further we can prepare for you.`;
      }

      appendMessage({
        sender: 'ai',
        text: fallbackText,
        quickReplies: ['Confirm details', 'Contact front desk'],
        hasServicesBtn: scenarioKey !== 'checkout_review',
      });
    }
  }

  // Bottom Sheet Open / Close Handlers
  function openBottomSheet() {
    sheetBackdrop.removeAttribute('hidden');
    sheetCloseBtn.focus();
  }

  function closeBottomSheet() {
    sheetBackdrop.setAttribute('hidden', '');
  }

  sheetCloseBtn.addEventListener('click', closeBottomSheet);

  sheetBackdrop.addEventListener('click', (e) => {
    if (e.target === sheetBackdrop) closeBottomSheet();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetBackdrop.hasAttribute('hidden')) {
      closeBottomSheet();
    }
  });

  sheetItemButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.getAttribute('data-service-name');
      const price = btn.getAttribute('data-service-price');
      closeBottomSheet();
      handleGuestReply(`I would like to enquire about: ${name} (${price})`);
    });
  });

  // User input bar handler
  function handleInputSubmit() {
    const text = msgInput.value;
    if (!text.trim()) return;
    msgInput.value = '';
    handleGuestReply(text);
  }

  sendBtn.addEventListener('click', handleInputSubmit);

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputSubmit();
    }
  });

  // Human Handoff Toggle Action
  handoffBtn.addEventListener('click', () => {
    isHumanHandoff = !isHumanHandoff;

    if (isHumanHandoff) {
      handoffBtn.classList.add('active-human');
      handoffBtnText.textContent = 'Resume AI Concierge';
      handoffStatusBadge.className = 'handoff-badge state-human';
      handoffStatusText.textContent = 'Human Agent Active — AI Paused';
      presenceText.textContent = 'Human Staff Active';
      handoffNote.textContent = 'AI automated responses are currently suspended for this conversation.';
      logTranscript('Escape Hatch Action', 'Receptionist took manual control of chat. AI auto-replies paused.', 'handoff');
    } else {
      handoffBtn.classList.remove('active-human');
      handoffBtnText.textContent = 'Take Over Chat (Human Handoff)';
      handoffStatusBadge.className = 'handoff-badge state-ai';
      handoffStatusText.textContent = 'AI Concierge Active';
      presenceText.textContent = 'online';
      handoffNote.textContent = 'Pauses AI automated replies to prevent message collisions during staff intervention.';
      logTranscript('Escape Hatch Action', 'Receptionist released control. AI Concierge resumed.', 'handoff');
    }
  });

  // Launch Simulation Logic
  async function launchSimulation() {
    clearAllTimers();
    conversationHistory = [];

    // Read current form input values strictly
    const guestName = guestNameInput.value.trim() || 'Guest';
    const lang = languageSelect.value || 'en';
    const scenarioKey = scenarioSelect.value || 'pre_arrival';

    // Update Receptionist Panel
    receptionGuestName.textContent = guestName;
    receptionAvatar.textContent = getInitials(guestName);
    receptionLanguage.textContent = languageSelect.options[languageSelect.selectedIndex]?.text || lang.toUpperCase();

    const scenarioDef = SCENARIO_TEMPLATES[scenarioKey] || SCENARIO_TEMPLATES.pre_arrival;
    receptionScenario.textContent = scenarioDef.label;

    // Reset Chat Canvas
    chatCanvas.innerHTML = `
      <div class="wa-date-divider">
        <span>TODAY</span>
      </div>
      <div class="wa-encryption-notice">
        <span>🔒 Messages are end-to-end encrypted. No one outside of this chat can read or listen to them.</span>
      </div>
    `;

    // Clear and Initialize Transcript Log
    transcriptFeed.innerHTML = '';
    logTranscript('System', `Simulation launched for "${guestName}" [Language: ${lang.toUpperCase()}, Scenario: ${scenarioDef.label}]`, 'handoff');

    const localized = scenarioDef[lang] || scenarioDef.en;

    // In-Stay Request Scenario
    if (localized.initialGuestMessage) {
      appendMessage({ sender: 'guest', text: localized.initialGuestMessage });
      showTypingIndicator();

      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            guestName,
            language: lang,
            scenario: scenarioKey,
            is_demo: true,
            message: localized.initialGuestMessage,
            chatHistory: conversationHistory,
          }),
        });

        hideTypingIndicator();
        if (!response.ok) throw new Error(`Worker status: ${response.status}`);
        const data = await response.json();

        appendMessage({
          sender: 'ai',
          text: data.reply || localized.greeting(guestName),
          quickReplies: data.quickReplies?.length ? data.quickReplies : localized.quickReplies,
          hasServicesBtn: localized.hasServicesBtn,
        });

        if (data.staffAlert) {
          logTranscript(
            'Staff Router',
            `🛎️ Actionable Task Dispatched: [${data.staffAlert.role}] "${data.staffAlert.task}" (${data.staffAlert.status})`,
            'handoff'
          );
        }
      } catch {
        hideTypingIndicator();
        appendMessage({
          sender: 'ai',
          text: localized.greeting(guestName),
          quickReplies: localized.quickReplies,
          hasServicesBtn: localized.hasServicesBtn,
        });
      }
    } else {
      // Direct outreach (48h Pre-Arrival or Checkout Review)
      appendMessage({
        sender: 'ai',
        text: localized.greeting(guestName),
        quickReplies: localized.quickReplies,
        hasServicesBtn: localized.hasServicesBtn,
      });
    }
  }

  // Form Submit Handler
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    launchSimulation();
  });

  // Initial load execution
  launchSimulation();
});
