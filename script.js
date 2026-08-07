/* H\u00f4tel Lumi\u00e8re Paris \u2014 composed concierge interaction */

const configuredApiUrl = String(window.CONCIERGE_WEBHOOK_URL || '').trim();
const isLocalDevelopmentHost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);
const CONCIERGE_API_URL = configuredApiUrl || (isLocalDevelopmentHost ? 'http://localhost:5678/webhook/concierge/inbound' : '');
const CHAT_STORAGE_KEY = 'conciergeflow-ai-chat-v4';
const MAX_STORED_MESSAGES = 24;
const FALLBACK_CARD_IMAGE = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=84';
const FALLBACK_PARTNER_IMAGE = 'assets/hotel-lumiere-salon.jpg';

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatWidget = document.querySelector('.chat-widget');
const chatWrapper = document.querySelector('.chat-wrapper');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const navbar = document.getElementById('navbar');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toast-msg');
const bookingModal = document.getElementById('booking-modal');
const bookingForm = document.getElementById('booking-form');
const bookingServiceName = document.getElementById('booking-service-name');
const bookingServiceMeta = document.getElementById('booking-service-meta');
const bookingError = document.getElementById('booking-error');
const bookingSubmit = document.getElementById('booking-submit');
const discoveryModal = document.getElementById('discovery-modal');
const discoveryForm = document.getElementById('discovery-form');
const discoveryError = document.getElementById('discovery-error');
const discoverySubmit = document.getElementById('discovery-submit');

let toastTimer;
let isSending = false;

function createSessionId() {
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readChatState() {
  try {
    const state = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY));
    if (state && Array.isArray(state.messages)) return state;
  } catch {
    // A guest can always start a fresh conversation if local storage is unavailable.
  }
  return { sessionId: createSessionId(), messages: [] };
}

let chatState = readChatState();
if (!chatState.sessionId) chatState.sessionId = createSessionId();

function saveChatState() {
  try {
    chatState.messages = chatState.messages.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatState));
  } catch {
    // The live conversation remains usable even when browser storage is disabled.
  }
}

function getCurrentTime() {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

function scrollToLatest() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

function validExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function createMessageElement(message, animate = true) {
  const item = document.createElement('article');
  item.className = `chat-msg ${message.sender}${animate ? ' message-arrival' : ''}`;
  item.setAttribute('aria-label', message.sender === 'user' ? 'Guest message' : 'Concierge reply');

  if (message.sender === 'ai') {
    const label = document.createElement('div');
    label.className = 'chat-msg-label';
    label.textContent = 'H\u00f4tel Lumi\u00e8re concierge';
    item.appendChild(label);
  }

  const paragraphs = String(message.text || '').split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).slice(0, 2);
  paragraphs.forEach((paragraph, index) => {
    const line = document.createElement('p');
    line.className = 'chat-msg-copy';
    line.style.setProperty('--reveal-delay', `${index * 90}ms`);
    line.textContent = paragraph;
    item.appendChild(line);
  });

  const time = document.createElement('time');
  time.className = 'chat-msg-time';
  time.textContent = message.time || getCurrentTime();
  item.appendChild(time);
  return item;
}

function renderRecommendations(recommendations, animate = true) {
  const verified = Array.isArray(recommendations) ? recommendations.filter((item) => item && item.name && validExternalUrl(item.website_url)) : [];
  if (!verified.length) return null;

  const panel = document.createElement('section');
  panel.className = `recommendation-panel${animate ? ' message-arrival' : ''}`;
  panel.setAttribute('aria-label', 'Curated Paris recommendations');

  const heading = document.createElement('p');
  heading.className = 'recommendation-eyebrow';
  heading.textContent = 'Curated Paris addresses';
  panel.appendChild(heading);

  const rail = document.createElement('div');
  rail.className = 'recommendation-rail';
  rail.setAttribute('role', 'list');

  verified.forEach((recommendation) => {
    const card = document.createElement('article');
    card.className = 'recommendation-card';
    card.setAttribute('role', 'listitem');

    const imageWrap = document.createElement('div');
    imageWrap.className = 'recommendation-image-wrap';
    const image = document.createElement('img');
    image.className = 'recommendation-image';
    image.src = validExternalUrl(recommendation.image_url) || FALLBACK_CARD_IMAGE;
    image.alt = `${recommendation.name} dining atmosphere`;
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.src = FALLBACK_CARD_IMAGE; }, { once: true });
    imageWrap.appendChild(image);
    card.appendChild(imageWrap);

    const content = document.createElement('div');
    content.className = 'recommendation-content';
    const name = document.createElement('h3');
    name.textContent = recommendation.name;
    const description = document.createElement('p');
    description.textContent = String(recommendation.description || 'A current Paris address selected from a direct venue listing.').slice(0, 230);
    const details = document.createElement('a');
    details.className = 'recommendation-link';
    details.href = validExternalUrl(recommendation.website_url);
    details.target = '_blank';
    details.rel = 'noopener noreferrer';
    details.textContent = 'View details';
    details.setAttribute('aria-label', `View details for ${recommendation.name}`);
    content.append(name, description, details);
    card.appendChild(content);
    rail.appendChild(card);
  });

  panel.appendChild(rail);
  return panel;
}

function renderPartnerOffers(offers, animate = true) {
  const verified = Array.isArray(offers) ? offers.filter((item) => item && item.name) : [];
  if (!verified.length) return null;

  const panel = document.createElement('section');
  panel.className = `partner-offer-panel${animate ? ' message-arrival' : ''}`;
  panel.setAttribute('aria-label', 'Hotel partner services');

  const heading = document.createElement('p');
  heading.className = 'partner-offer-eyebrow';
  heading.textContent = 'Preferred hotel collection';
  panel.appendChild(heading);

  const rail = document.createElement('div');
  rail.className = 'partner-offer-rail';
  rail.setAttribute('role', 'list');

  verified.forEach((offer) => {
    const card = document.createElement('article');
    card.className = 'partner-offer-card';
    card.setAttribute('role', 'listitem');

    const image = document.createElement('img');
    image.className = 'partner-offer-image';
    image.src = validExternalUrl(offer.image_url) || FALLBACK_PARTNER_IMAGE;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => { image.src = FALLBACK_PARTNER_IMAGE; }, { once: true });

    const content = document.createElement('div');
    content.className = 'partner-offer-content';
    const category = document.createElement('p');
    category.className = 'partner-offer-category';
    category.textContent = String(offer.category || 'Private experience').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const name = document.createElement('h3');
    name.textContent = String(offer.name).slice(0, 110);
    const details = document.createElement('p');
    details.className = 'partner-offer-details';
    const price = Number.isFinite(Number(offer.price_eur)) ? `EUR ${Number(offer.price_eur).toFixed(0)}` : 'On request';
    const duration = Number.isFinite(Number(offer.duration_mins)) && Number(offer.duration_mins) > 0 ? ` \u00b7 ${Number(offer.duration_mins)} min` : '';
    details.textContent = `${price}${duration}`;
    const reserve = document.createElement('button');
    reserve.className = 'partner-offer-book';
    reserve.type = 'button';
    reserve.textContent = 'Enquire';
    const triggerBooking = (event) => {
      event.stopPropagation();
      openBookingForm(offer);
    };
    reserve.addEventListener('click', triggerBooking);
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openBookingForm(offer));
    content.append(category, name, details, reserve);
    card.append(image, content);
    rail.appendChild(card);
  });

  panel.appendChild(rail);
  return panel;
}

function renderMessage(message, animate = true) {
  const bubble = createMessageElement(message, animate);
  chatMessages.appendChild(bubble);
  const cards = renderRecommendations(message.recommendations, animate);
  if (cards) chatMessages.appendChild(cards);
  const partnerCards = renderPartnerOffers(message.partnerOffers, animate);
  if (partnerCards) chatMessages.appendChild(partnerCards);
}

function appendMessage(text, sender, recommendations = [], partnerOffers = [], persist = true) {
  const message = { text: String(text || ''), sender, recommendations, partnerOffers, time: getCurrentTime() };
  renderMessage(message);
  if (persist) {
    chatState.messages.push(message);
    saveChatState();
  }
  scrollToLatest();
}

function removeStatus() {
  document.getElementById('concierge-status')?.remove();
}

function showStatus(message) {
  let status = document.getElementById('concierge-status');
  if (!status) {
    status = document.createElement('p');
    status.id = 'concierge-status';
    status.className = 'concierge-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    chatMessages.appendChild(status);
  }
  status.classList.remove('status-visible');
  window.requestAnimationFrame(() => {
    status.textContent = message;
    status.classList.add('status-visible');
    scrollToLatest();
  });
}

function showToast(message) {
  if (!toast || !toastMsg) return;
  toastMsg.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4500);
}
window.showToast = showToast;

function isApiConfigured() {
  return CONCIERGE_API_URL && !/YOUR_|your-worker/i.test(CONCIERGE_API_URL);
}

function conciergeApiUrl(path) {
  if (!isApiConfigured()) return '';
  try {
    const url = new URL(CONCIERGE_API_URL);
    url.pathname = path;
    url.search = '';
    return url.href;
  } catch {
    return '';
  }
}

function bookingApiUrl() {
  return conciergeApiUrl('/api/booking-enquiry');
}

async function parseEventStream(stream, onStatus) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data) continue;
        let payload;
        try { payload = JSON.parse(data); } catch { continue; }
        if (payload.type === 'status') onStatus(payload.message || 'Considering your request\u2026');
        if (payload.type === 'error') throw new Error(payload.message || 'The concierge service could not complete this request.');
        if (payload.type === 'final') return payload;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error('The concierge did not return a final response.');
}

async function requestConciergeReply(text) {
  if (!isApiConfigured()) throw new Error('The concierge service is not yet configured.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(CONCIERGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        message: text,
        sessionId: chatState.sessionId,
        hotel: 'H\u00f4tel Lumi\u00e8re Paris',
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Concierge returned HTTP ${response.status}`);
    if ((response.headers.get('content-type') || '').includes('text/event-stream') && response.body) {
      return parseEventStream(response.body, showStatus);
    }
    const payload = await response.json();
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function setChatBusy(busy) {
  isSending = busy;
  chatInput.disabled = busy;
  chatSend.disabled = busy;
  document.querySelectorAll('.quick-reply').forEach((button) => { button.disabled = busy; });
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isSending) return;
  appendMessage(text, 'user');
  chatInput.value = '';
  setChatBusy(true);
  showStatus('Receiving your request\u2026');
  try {
    const result = await requestConciergeReply(text);
    removeStatus();
    appendMessage(result.reply || 'Our concierge will return with a considered answer shortly.', 'ai', result.recommendations || [], result.partner_offers || []);
    
    const isCatalogQuery = /\b(partners?|offers?|services?|catalogue?|catalog?|todos los servicios|servicios|offres|partenaires)\b/i.test(text)
      || result.intent === 'partner_catalog'
      || (Array.isArray(result.partner_offers) && result.partner_offers.length >= 3);
      
    if (isCatalogQuery) {
      window.setTimeout(() => {
        openPartnerCatalog();
      }, 500);
    }
  } catch (error) {
    console.error('Concierge request error:', error);
    removeStatus();
    appendMessage('I\u2019m sorry, I could not complete that search just now. Please try again in a moment, and our concierge team will be pleased to assist.', 'ai');
  } finally {
    setChatBusy(false);
    chatInput.focus();
  }
}

function openBookingForm(offer) {
  if (!bookingModal || !bookingForm) return;
  bookingForm.reset();
  bookingError.textContent = '';
  bookingServiceName.textContent = offer.name || 'Selected experience';
  const price = Number.isFinite(Number(offer.price_eur)) ? `EUR ${Number(offer.price_eur).toFixed(0)}` : 'Price on request';
  const duration = Number.isFinite(Number(offer.duration_mins)) && Number(offer.duration_mins) > 0 ? ` \u00b7 ${Number(offer.duration_mins)} min` : '';
  bookingServiceMeta.textContent = `${price}${duration}`;
  bookingForm.elements.serviceName.value = offer.name || '';
  bookingForm.elements.serviceType.value = offer.category || 'other';
  bookingModal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => bookingForm.elements.guestName?.focus(), 80);
}

function closeBookingForm() {
  if (!bookingModal) return;
  bookingModal.hidden = true;
  document.body.classList.remove('modal-open');
}

async function submitBookingForm(event) {
  event.preventDefault();
  const endpoint = bookingApiUrl();
  if (!endpoint || !bookingForm) {
    bookingError.textContent = 'The concierge enquiry service is not configured yet.';
    return;
  }
  const form = new FormData(bookingForm);
  const payload = {
    guestName: form.get('guestName'),
    email: form.get('email'),
    phone: form.get('phone'),
    preferredDate: form.get('preferredDate'),
    preferredTime: form.get('preferredTime'),
    partySize: form.get('partySize'),
    notes: form.get('notes'),
    serviceName: form.get('serviceName'),
    serviceType: form.get('serviceType'),
    consent: form.get('consent') === 'yes',
    sessionId: chatState.sessionId,
    language: document.documentElement.lang || 'en',
  };
  bookingError.textContent = '';
  bookingSubmit.disabled = true;
  bookingSubmit.textContent = 'Sending enquiry\u2026';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'We could not record your enquiry.');
    closeBookingForm();
    showToast('Enquiry received. The concierge team can now follow up using your details.');
  } catch (error) {
    bookingError.textContent = error instanceof Error ? error.message : 'We could not record your enquiry.';
  } finally {
    bookingSubmit.disabled = false;
    bookingSubmit.textContent = 'Send concierge enquiry';
  }
}

function openDiscoveryForm() {
  if (!discoveryModal || !discoveryForm) return;
  discoveryForm.reset();
  discoveryError.textContent = '';
  discoveryModal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => discoveryForm.elements.contactName?.focus(), 80);
}

function closeDiscoveryForm() {
  if (!discoveryModal) return;
  discoveryModal.hidden = true;
  document.body.classList.remove('modal-open');
}

async function submitDiscoveryForm(event) {
  event.preventDefault();
  const endpoint = conciergeApiUrl('/api/discovery-lead');
  if (!endpoint || !discoveryForm) {
    discoveryError.textContent = 'The discovery request service is not configured yet.';
    return;
  }
  if (!discoveryForm.reportValidity()) return;
  const form = new FormData(discoveryForm);
  const payload = {
    contactName: form.get('contactName'),
    email: form.get('email'),
    hotelName: form.get('hotelName'),
    phone: form.get('phone'),
    city: form.get('city'),
    roomCount: form.get('roomCount'),
    website: form.get('website'),
    message: form.get('message'),
    consent: form.get('consent') === 'yes',
    sessionId: chatState.sessionId,
  };
  discoveryError.textContent = '';
  discoverySubmit.disabled = true;
  discoverySubmit.textContent = 'Sending request\u2026';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'We could not record your discovery request.');
    closeDiscoveryForm();
    showToast('Discovery request received. We now have the details needed to contact you.');
  } catch (error) {
    discoveryError.textContent = error instanceof Error ? error.message : 'We could not record your discovery request.';
  } finally {
    discoverySubmit.disabled = false;
    discoverySubmit.textContent = 'Request a discovery call';
  }
}

const showcaseScenes = {
  arrival: {
    guest: '\u201cWe arrive after midnight. Can everything feel effortless?\u201d',
    response: 'A chauffeur, in-room supper and a quiet arrival note are prepared as one considered request.',
    detail: 'One guest message \u00b7 three team-ready actions',
  },
  finale: {
    guest: '\u201cIt is our final day in Paris. What would you suggest?\u201d',
    response: 'The concierge searches current Paris options, then presents a graceful, bookable final-day rhythm.',
    detail: 'Live web discovery \u00b7 composed in the guest\u2019s language',
  },
  celebration: {
    guest: '\u201cWe are celebrating tonight\u2014somewhere intimate?\u201d',
    response: 'A preferred dining option is presented with its details, then the guest can leave a real enquiry in moments.',
    detail: 'Partner offer \u00b7 contact captured in Airtable',
  },
  rare: {
    guest: '\u201cCould you find a very specific Parisian experience?\u201d',
    response: 'An unfamiliar request becomes a focused search\u2014not a dead end or a generic hand-off.',
    detail: 'Open-ended discovery \u00b7 independently verified cards',
  },
};

function setShowcaseScene(name) {
  const scene = showcaseScenes[name];
  if (!scene) return;
  document.getElementById('showcase-guest').textContent = scene.guest;
  document.getElementById('showcase-response').textContent = scene.response;
  document.getElementById('showcase-detail').textContent = scene.detail;
  document.querySelectorAll('.showcase-trigger').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.scene === name);
    button.setAttribute('aria-pressed', button.dataset.scene === name ? 'true' : 'false');
  });
}

function restoreConversation() {
  chatMessages.replaceChildren();
  if (chatState.messages.length) {
    chatState.messages.forEach((message) => renderMessage(message, false));
  } else {
    appendMessage('Bonsoir and welcome to H\u00f4tel Lumi\u00e8re Paris. I\u2019m your private concierge, here whenever you need a considered Paris recommendation.', 'ai');
  }
  scrollToLatest();
}

function setFullscreen(isFullscreen) {
  chatWidget.classList.toggle('fullscreen', isFullscreen);
  if (isFullscreen) {
    document.body.appendChild(chatWidget);
    fullscreenIcon.classList.replace('fa-expand', 'fa-compress');
    document.body.style.overflow = 'hidden';
    if (fullscreenBtn) fullscreenBtn.title = 'Minimize Demo';
  } else {
    chatWrapper.prepend(chatWidget);
    fullscreenIcon.classList.replace('fa-compress', 'fa-expand');
    document.body.style.overflow = '';
    if (fullscreenBtn) fullscreenBtn.title = 'Expand Demo';
  }
  window.requestAnimationFrame(scrollToLatest);
}

window.addEventListener('scroll', () => navbar?.classList.toggle('scrolled', window.scrollY > 30), { passive: true });

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, index) => {
    if (!entry.isIntersecting) return;
    setTimeout(() => entry.target.classList.add('revealed'), index * 70);
    revealObserver.unobserve(entry.target);
  });
}, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));

const partnerCatalogModal = document.getElementById('partner-catalog-modal');
const partnerCatalogGrid = document.getElementById('partner-catalog-grid');
const openCatalogBtn = document.getElementById('open-catalog-btn');
const quickCatalogBtn = document.getElementById('quick-catalog-btn');

const ALL_PARTNER_SERVICES = [
  { name: 'Lumière Spa — Couples Massage', category: 'spa', price_eur: 420, duration_mins: 75, description: 'Private spa suite for two, side-by-side bespoke body treatment & Champagne toast.', image_url: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Lumière Spa — Signature Facial', category: 'spa', price_eur: 260, duration_mins: 60, description: 'Custom anti-aging facial treatment using premium French organic botanical skincare.', image_url: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Le Jardin — Chef’s Table (2 Persons)', category: 'restaurant', price_eur: 580, duration_mins: 180, description: '7-course Michelin-starred gastronomy experience with private sommelier wine pairing.', image_url: 'https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Terrasse Lumière — Rooftop Cocktail Tasting', category: 'restaurant', price_eur: 190, duration_mins: 90, description: 'Reserved front-row Eiffel Tower view table with 4 craft cocktails & caviar pairings.', image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Private Chauffeur — CDG / Orly Airport Transfer', category: 'transport', price_eur: 180, duration_mins: 60, description: 'Luxury Mercedes-Benz S-Class transfer with personal flight tracking and meet & greet.', image_url: 'https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Private Chauffeur — Half-Day Paris Grand Tour', category: 'transport', price_eur: 450, duration_mins: 240, description: 'Bespoke 4-hour Paris city tour with private chauffeur & dedicated English concierge guide.', image_url: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Private Seine Sunset Cruise with Champagne', category: 'tour', price_eur: 650, duration_mins: 120, description: 'Exclusive private mahogany boat tour down the Seine with personal skipper & Laurent-Perrier.', image_url: 'https://images.unsplash.com/photo-1522093007474-d86e9bf7ba6f?auto=format&fit=crop&w=1200&q=85' },
  { name: 'VIP Louvre After-Hours Private Access', category: 'tour', price_eur: 2800, duration_mins: 120, description: 'Private after-hours entry to the Louvre museum led by a senior art historian.', image_url: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Montmartre Walking Food & Wine Tour', category: 'tour', price_eur: 280, duration_mins: 180, description: 'Guided artisanal food walk stopping at top bakeries, cheese affineurs & wine cellars.', image_url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Versailles Private Day Trip & Palace Access', category: 'tour', price_eur: 950, duration_mins: 480, description: 'Skip-the-line private estate tour of Versailles Palace & Gardens with luxury transfer.', image_url: 'https://images.unsplash.com/photo-1584003564911-a7a321c84e1c?auto=format&fit=crop&w=1200&q=85' },
  { name: 'In-Suite Private Chef & Sommelier Dinner', category: 'experience', price_eur: 850, duration_mins: 150, description: 'Private culinary team prepares a 5-course gourmet dinner directly inside your suite.', image_url: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=85' },
  { name: 'Atelier Parfum — Custom Fragrance Workshop', category: 'experience', price_eur: 320, duration_mins: 90, description: 'Master perfumer session creating your personalized 100ml Paris signature fragrance.', image_url: 'https://images.unsplash.com/photo-1615397349754-cfa2066a298e?auto=format&fit=crop&w=1200&q=85' }
];

function renderCatalogGrid(filter = 'all') {
  if (!partnerCatalogGrid) return;
  partnerCatalogGrid.replaceChildren();
  const items = filter === 'all' ? ALL_PARTNER_SERVICES : ALL_PARTNER_SERVICES.filter((item) => item.category === filter);
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'partner-catalog-card';
    const tag = String(item.category || 'experience').toUpperCase();
    const durationText = Number.isFinite(Number(item.duration_mins)) && Number(item.duration_mins) > 0 ? ` · ${item.duration_mins} min` : '';
    card.innerHTML = `
      <img class="partner-catalog-img" src="${item.image_url}" alt="${item.name}" loading="lazy" />
      <div class="partner-catalog-body">
        <span class="partner-catalog-tag">${tag}</span>
        <h3>${item.name}</h3>
        <p class="partner-catalog-desc">${item.description}</p>
        <div class="partner-catalog-footer">
          <span class="partner-catalog-price">EUR ${item.price_eur}${durationText}</span>
          <button class="partner-catalog-action" type="button">Enquire</button>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      closePartnerCatalog();
      openBookingForm(item);
    });
    partnerCatalogGrid.appendChild(card);
  });
}

function openPartnerCatalog() {
  if (!partnerCatalogModal) return;
  renderCatalogGrid('all');
  partnerCatalogModal.hidden = false;
  document.body.classList.add('modal-open');
}

function closePartnerCatalog() {
  if (!partnerCatalogModal) return;
  partnerCatalogModal.hidden = true;
  document.body.classList.remove('modal-open');
}

document.querySelectorAll('.partner-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.partner-filter-btn').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    renderCatalogGrid(btn.dataset.filter || 'all');
  });
});

openCatalogBtn?.addEventListener('click', openPartnerCatalog);
quickCatalogBtn?.addEventListener('click', openPartnerCatalog);
document.querySelectorAll('[data-close-partner-catalog]').forEach((button) => button.addEventListener('click', closePartnerCatalog));
partnerCatalogModal?.addEventListener('click', (event) => { if (event.target === partnerCatalogModal) closePartnerCatalog(); });

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
document.querySelectorAll('.quick-reply').forEach((button) => {
  if (button === quickCatalogBtn) return;
  button.addEventListener('click', () => {
    chatInput.value = button.dataset.message || button.textContent.trim();
    sendMessage();
  });
});
fullscreenBtn?.addEventListener('click', () => setFullscreen(!chatWidget.classList.contains('fullscreen')));
bookingForm?.addEventListener('submit', submitBookingForm);
document.querySelectorAll('[data-close-booking]').forEach((button) => button.addEventListener('click', closeBookingForm));
bookingModal?.addEventListener('click', (event) => { if (event.target === bookingModal) closeBookingForm(); });
discoveryForm?.addEventListener('submit', submitDiscoveryForm);
document.querySelectorAll('.discovery-trigger').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); openDiscoveryForm(); }));
document.querySelectorAll('[data-close-discovery]').forEach((button) => button.addEventListener('click', closeDiscoveryForm));
discoveryModal?.addEventListener('click', (event) => { if (event.target === discoveryModal) closeDiscoveryForm(); });
document.querySelectorAll('.showcase-trigger').forEach((button) => button.addEventListener('click', () => setShowcaseScene(button.dataset.scene)));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && chatWidget.classList.contains('fullscreen')) setFullscreen(false);
  if (event.key === 'Escape' && !bookingModal?.hidden) closeBookingForm();
  if (event.key === 'Escape' && !discoveryModal?.hidden) closeDiscoveryForm();
  if (event.key === 'Escape' && !partnerCatalogModal?.hidden) closePartnerCatalog();
});

restoreConversation();
