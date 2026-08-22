/*
 * ConciergeFlow AI — Hotel Simulator Dashboard Client Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const chatCanvas = document.getElementById('chatCanvas');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const bottomSheet = document.getElementById('bottomSheet');
  const closeSheetBtn = document.getElementById('closeSheetBtn');
  const handoffBtn = document.getElementById('handoffBtn');
  const handoffStatus = document.getElementById('handoffStatus');
  const transcriptFeed = document.getElementById('transcriptFeed');
  const scenarioSelect = document.getElementById('scenarioSelect');
  const guestNameInput = document.getElementById('guestName');
  const languageSelect = document.getElementById('guestLang');
  const roomNumberInput = document.getElementById('roomNumber');
  const vipSelect = document.getElementById('vipSelect');
  const launchBtn = document.getElementById('launchBtn');
  const presetCards = document.querySelectorAll('.preset-card');

  // Receptionist Panel Labels
  const deskGuestName = document.getElementById('deskGuestName');
  const deskRoom = document.getElementById('deskRoom');
  const deskVip = document.getElementById('deskVip');
  const deskTags = document.getElementById('deskTags');
  const staffAlertBox = document.getElementById('staffAlertBox');
  const staffAlertContent = document.getElementById('staffAlertContent');

  let isHumanHandoff = false;

  // Scenario Presets Data
  const SCENARIOS = {
    pre_arrival: {
      guest: 'Alexander Dupont',
      lang: 'en',
      room: 'Suite 304',
      vip: 'VIP',
      tags: ['10th Anniversary', 'Gluten-Free', 'High Floor'],
      messages: [
        {
          sender: 'ai',
          text: 'Bonjour Mr. Dupont! ✨ We are delighted to welcome you to Hôtel Lumière Paris in 48 hours for your 10th anniversary. May I arrange your private Mercedes S-Class airport transfer or secure a table at our Eiffel View Rooftop?',
          quickReplies: ['🚗 Book Chauffeur (€180)', '🍽️ Rooftop Table', '📋 View Services'],
          time: '10:00 AM'
        }
      ]
    },
    in_stay: {
      guest: 'Marie Laurent',
      lang: 'fr',
      room: 'Deluxe 412',
      vip: 'Standard',
      tags: ['Extra Pillows', 'Late Checkout Inquired'],
      messages: [
        {
          sender: 'guest',
          text: 'Bonjour, pourriez-vous nous apporter 2 serviettes supplémentaires et des oreillers en plus dans la chambre 412 s\'il vous plaît ?',
          time: '14:22'
        },
        {
          sender: 'ai',
          text: 'Avec grand plaisir, Mme Laurent. Notre équipe d\'étage (Gouvernante) vient de recevoir votre demande et vous apporte les serviettes et oreillers dans les 10 prochaines minutes.',
          quickReplies: ['Merci beaucoup', 'Besoin de peignoirs'],
          staffRouting: {
            role: 'Housekeeping',
            staff: 'Maria (Gouvernante)',
            task: '2 extra towels & pillows to Deluxe 412'
          },
          time: '14:23'
        }
      ]
    },
    itinerary: {
      guest: 'Elena Rostova',
      lang: 'en',
      room: 'Penthouse 701',
      vip: 'Celebrity',
      tags: ['Fine Dining', 'Opera Lover', 'Champagne Welcome'],
      messages: [
        {
          sender: 'guest',
          text: 'Hello, what are your top Michelin-starred dinner recommendations near the hotel with a romantic Eiffel Tower view?',
          time: '18:05'
        },
        {
          sender: 'ai',
          text: 'Good evening Ms. Rostova. For an exquisite evening, our private rooftop table overlooks the illuminated Eiffel Tower with Chef Laurent\'s 7-course tasting menu (€240). Alternatively, Jules Verne on the 2nd tier offers unmatched panorama.',
          listMessage: 'View Dining & Spa Catalogue',
          quickReplies: ['Reserve Rooftop (€240)', 'Spa Treatment', 'Private Chauffeur'],
          time: '18:06'
        }
      ]
    },
    checkout: {
      guest: 'Kenji Takahashi',
      lang: 'ja',
      room: 'Suite 201',
      vip: 'VIP',
      tags: ['Express Checkout', 'Private Jet Transfer'],
      messages: [
        {
          sender: 'ai',
          text: '高橋様、オテル・リュミエール・パリをご利用いただき誠にありがとうございました。ご滞在はいかがでしたでしょうか？✨',
          quickReplies: ['⭐⭐⭐⭐⭐ 素晴らしい (Google)', '💬 支配人へメッセージ'],
          time: '11:00 AM'
        }
      ]
    }
  };

  // Helper: Format Time
  function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Append Message to WhatsApp Screen
  function appendMessage({ sender, text, quickReplies, listMessage, time = getCurrentTime() }) {
    const bubble = document.createElement('div');
    bubble.className = `wa-bubble ${sender === 'guest' ? 'outgoing' : 'incoming'}`;

    let html = `<div>${escapeHtml(text)}</div>`;

    // Interactive List Message Button
    if (listMessage) {
      html += `
        <button class="wa-list-message-btn" onclick="document.getElementById('bottomSheet').classList.add('open')">
          📋 ${escapeHtml(listMessage)}
        </button>
      `;
    }

    // Interactive Quick Reply Pills
    if (quickReplies && quickReplies.length) {
      html += '<div class="wa-quick-replies">';
      quickReplies.forEach(qr => {
        html += `<button class="wa-qr-btn" onclick="window.sendQuickReply('${escapeHtml(qr)}')">${escapeHtml(qr)}</button>`;
      });
      html += '</div>';
    }

    // Meta details (time & ticks)
    html += `
      <div class="wa-bubble-meta">
        <span>${time}</span>
        ${sender === 'guest' ? '<span class="wa-ticks">✓✓</span>' : ''}
      </div>
    `;

    bubble.innerHTML = html;
    chatCanvas.appendChild(bubble);
    chatCanvas.scrollTop = chatCanvas.scrollHeight;

    // Append to Receptionist Transcript Feed
    logTranscript(sender === 'guest' ? 'Guest' : (isHumanHandoff ? 'Human Staff' : 'AI Concierge'), text, sender === 'guest' ? 'guest' : (isHumanHandoff ? 'human' : 'ai'));
  }

  // Append to Transcript Log in Panel 3
  function logTranscript(actor, text, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
      <div class="log-meta">[${getCurrentTime()}] ${actor}</div>
      <div class="log-text">${escapeHtml(text)}</div>
    `;
    transcriptFeed.appendChild(entry);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Load and Render Scenario
  function loadScenario(key) {
    const scenario = SCENARIOS[key] || SCENARIOS.pre_arrival;

    // Update Mission Control Inputs
    guestNameInput.value = scenario.guest;
    languageSelect.value = scenario.lang;
    roomNumberInput.value = scenario.room;
    vipSelect.value = scenario.vip;

    // Update Receptionist Panel
    deskGuestName.textContent = scenario.guest;
    deskRoom.textContent = scenario.room;
    deskVip.textContent = scenario.vip;
    deskTags.innerHTML = scenario.tags.map(t => `<span class="tag-pill">${t}</span>`).join('');

    // Clear Chat & Transcript
    chatCanvas.innerHTML = `
      <div class="wa-date-pill">TODAY</div>
      <div class="wa-enc-pill">🔒 Messages and calls are end-to-end encrypted. No one outside of this chat can read or listen to them.</div>
    `;
    transcriptFeed.innerHTML = '';
    staffAlertBox.style.display = 'none';

    // Render Scenario Messages
    scenario.messages.forEach((msg, idx) => {
      setTimeout(() => {
        appendMessage(msg);
        if (msg.staffRouting) {
          staffAlertBox.style.display = 'flex';
          staffAlertContent.innerHTML = `
            <strong>Role:</strong> ${msg.staffRouting.role} (${msg.staffRouting.staff})<br>
            <strong>Task:</strong> ${msg.staffRouting.task}<br>
            <strong>Status:</strong> 🟢 Dispatched via WhatsApp Alert
          `;
          logTranscript('Staff Router', `Task routed to ${msg.staffRouting.staff}: "${msg.staffRouting.task}"`, 'staff');
        }
      }, idx * 400);
    });
  }

  // Handle User Input Submission
  function handleSendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;

    appendMessage({ sender: 'guest', text });
    msgInput.value = '';

    if (isHumanHandoff) {
      logTranscript('System', 'AI Auto-Reply is PAUSED (Human Agent Active)', 'human');
      return;
    }

    // Simulated Smart Response
    setTimeout(() => {
      const lower = text.toLowerCase();
      if (lower.includes('chauffeur') || lower.includes('transfer') || lower.includes('airport')) {
        appendMessage({
          sender: 'ai',
          text: 'Splendid! I have reserved our private Mercedes S-Class Chauffeur for your arrival at Charles de Gaulle. The driver will greet you with a nameboard at baggage claim.',
          quickReplies: ['Confirm Transfer (€180)', 'Add Flight Number']
        });
      } else if (lower.includes('towel') || lower.includes('pillow') || lower.includes('serviette')) {
        appendMessage({
          sender: 'ai',
          text: 'Understood. Housekeeping has been alerted directly and is on their way with fresh plush towels.',
          quickReplies: ['Thank you!', 'Extra Robes too']
        });
        staffAlertBox.style.display = 'flex';
        staffAlertContent.innerHTML = `
          <strong>Role:</strong> Housekeeping (On-Duty)<br>
          <strong>Task:</strong> Extra amenities requested for ${roomNumberInput.value}<br>
          <strong>Status:</strong> 🟢 Instant WhatsApp Dispatch Sent
        `;
        logTranscript('Staff Router', `Housekeeping alert dispatched for ${roomNumberInput.value}`, 'staff');
      } else if (lower.includes('rooftop') || lower.includes('dinner') || lower.includes('menu')) {
        appendMessage({
          sender: 'ai',
          text: 'Our Eiffel View Rooftop has a table reserved for you at 20:00. Would you like our sommelier to prepare a vintage champagne pairing upon arrival?',
          quickReplies: ['Yes, Champagne Pairing', 'View Wine List']
        });
      } else {
        appendMessage({
          sender: 'ai',
          text: 'Certainly! It is my pleasure to assist you. May I also show you our exclusive in-house spa and dining collections?',
          listMessage: 'Explore Hôtel Lumière Services'
        });
      }
    }, 800);
  }

  // Global Quick Reply Handler
  window.sendQuickReply = function(text) {
    appendMessage({ sender: 'guest', text });
    setTimeout(() => {
      appendMessage({
        sender: 'ai',
        text: `Thank you! I have confirmed your selection for "${text}". Is there anything else I may prepare for your stay?`,
        quickReplies: ['All set, thank you', 'Contact Reception']
      });
    }, 600);
  };

  // Global Sheet Selection Handler
  window.selectService = function(serviceName, price) {
    bottomSheet.classList.remove('open');
    appendMessage({ sender: 'guest', text: `I would like to book: ${serviceName} (${price})` });
    setTimeout(() => {
      appendMessage({
        sender: 'ai',
        text: `Excellent choice! I have created a booking inquiry for ${serviceName} (${price}). Our front desk team has been notified.`,
        quickReplies: ['Confirm Booking', 'Add Special Request']
      });
    }, 600);
  };

  // Event Listeners
  sendBtn.addEventListener('click', handleSendMessage);
  msgInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendMessage();
  });

  closeSheetBtn.addEventListener('click', () => {
    bottomSheet.classList.remove('open');
  });

  // Human Handoff Toggle
  handoffBtn.addEventListener('click', () => {
    isHumanHandoff = !isHumanHandoff;
    if (isHumanHandoff) {
      handoffBtn.classList.add('paused');
      handoffBtn.innerHTML = '<span>▶️</span> Resume AI Concierge';
      handoffStatus.className = 'status-indicator human-active';
      handoffStatus.innerHTML = '<div class="pulse-dot" style="background:#f59e0b; box-shadow:0 0 8px #f59e0b;"></div> Human Agent Active (AI Paused)';
      logTranscript('Escape Hatch', 'Human receptionist took over session. AI auto-responses paused.', 'human');
    } else {
      handoffBtn.classList.remove('paused');
      handoffBtn.innerHTML = '<span>✋</span> Take Over Chat (Human Handoff)';
      handoffStatus.className = 'status-indicator ai-active';
      handoffStatus.innerHTML = '<div class="pulse-dot"></div> AI Concierge Active';
      logTranscript('Escape Hatch', 'Human receptionist released control. AI Concierge resumed.', 'ai');
    }
  });

  // Preset Cards Click
  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      presetCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const scenarioKey = card.getAttribute('data-scenario');
      scenarioSelect.value = scenarioKey;
      loadScenario(scenarioKey);
    });
  });

  // Launch Button Click
  launchBtn.addEventListener('click', () => {
    loadScenario(scenarioSelect.value);
  });

  scenarioSelect.addEventListener('change', (e) => {
    presetCards.forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-scenario') === e.target.value);
    });
    loadScenario(e.target.value);
  });

  // Initial Load
  loadScenario('pre_arrival');
});
