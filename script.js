/* H\u00f4tel Lumi\u00e8re Paris \u2014 composed concierge interaction */

const configuredApiUrl = String(window.CONCIERGE_WEBHOOK_URL || '').trim();
const isLocalDevelopmentHost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);
const CONCIERGE_API_URL = configuredApiUrl || (isLocalDevelopmentHost ? 'http://localhost:5678/webhook/concierge/inbound' : '');
const CHAT_STORAGE_KEY = 'conciergeflow-ai-chat-v6';
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
const roomBookingModal = document.getElementById('room-booking-modal');
const roomBookingForm = document.getElementById('room-booking-form');
const roomBookingError = document.getElementById('room-booking-error');
const roomBookingSubmit = document.getElementById('room-booking-submit');
const roomBookingServiceSummary = document.getElementById('room-booking-service-summary');
const roomBookingServiceName = document.getElementById('room-booking-service-name');
const roomBookingServiceMeta = document.getElementById('room-booking-service-meta');
const discoveryModal = document.getElementById('discovery-modal');
const discoveryForm = document.getElementById('discovery-form');
const discoveryError = document.getElementById('discovery-error');
const discoverySubmit = document.getElementById('discovery-submit');
const hotelCollectionModal = document.getElementById('hotel-collection-modal');
const hotelCollectionDialogGrid = document.getElementById('hotel-collection-dialog-grid');
const hotelCollectionBack = document.getElementById('hotel-collection-back');

let toastTimer;
let isSending = false;
let hotelCollectionRoot = { offers: [], context: {} };
let knownRoomOffers = [];

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
    if (recommendation.booking_enabled === true) {
      const reserve = document.createElement('button');
      reserve.className = 'recommendation-book';
      reserve.type = 'button';
      reserve.textContent = 'Ask concierge to reserve';
      reserve.addEventListener('click', () => openBookingForm({
        name: recommendation.name,
        category: recommendation.service_type || 'other',
        source: recommendation.source || 'external',
      }));
      content.appendChild(reserve);
    }
    card.appendChild(content);
    rail.appendChild(card);
  });

  panel.appendChild(rail);
  return panel;
}

function uniqueOffers(offers) {
  const seen = new Set();
  return (Array.isArray(offers) ? offers : []).filter((offer) => {
    const key = String(offer?.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rememberRoomOffers(offers) {
  knownRoomOffers = uniqueOffers([
    ...knownRoomOffers,
    ...(Array.isArray(offers) ? offers : []).filter((offer) => String(offer?.category || '').toLowerCase() === 'accommodation'),
  ]);
}

function createHotelCollectionCard(offer, { roomPicker = false } = {}) {
  const card = document.createElement('article');
  card.className = 'hotel-collection-card';
  card.setAttribute('role', 'listitem');
  const image = document.createElement('img');
  image.className = 'hotel-collection-image';
  image.src = validExternalUrl(offer.image_url) || FALLBACK_PARTNER_IMAGE;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => { image.src = FALLBACK_PARTNER_IMAGE; }, { once: true });
  const content = document.createElement('div');
  content.className = 'hotel-collection-content';
  const category = document.createElement('p');
  category.className = 'hotel-collection-category';
  category.textContent = String(offer.category || 'Private experience').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const name = document.createElement('h3');
  name.textContent = String(offer.name).slice(0, 120);
  const description = document.createElement('p');
  description.textContent = String(offer.description || 'A considered experience from the hotel collection.').slice(0, 180);
  const meta = document.createElement('p');
  meta.className = 'hotel-collection-meta';
  const isAccommodation = String(offer.category || '').toLowerCase() === 'accommodation';
  const price = Number.isFinite(Number(offer.price_eur)) ? `${isAccommodation ? 'From ' : ''}EUR ${Number(offer.price_eur).toFixed(0)}${isAccommodation ? ' / night' : ''}` : 'On request';
  const duration = !isAccommodation && Number.isFinite(Number(offer.duration_mins)) && Number(offer.duration_mins) > 0 ? ` \u00b7 ${Number(offer.duration_mins)} min` : '';
  meta.textContent = `${price}${duration}`;
  const reserve = document.createElement('button');
  reserve.className = 'hotel-collection-book';
  reserve.type = 'button';
  reserve.textContent = isAccommodation
    ? (roomPicker ? 'Select this room' : 'Explore rooms & suites')
    : 'Make an enquiry';
  reserve.addEventListener('click', () => {
    if (isAccommodation && !roomPicker) {
      openRoomTypeChooser(offer);
      return;
    }
    openOfferBookingForm(offer);
  });
  content.append(category, name, description, meta, reserve);
  card.append(image, content);
  return card;
}

function openHotelCollection(offers, context = {}) {
  const verified = uniqueOffers(offers);
  if (!hotelCollectionModal || !hotelCollectionDialogGrid || !verified.length) return;
  const roomPicker = context.mode === 'room-picker';
  if (!roomPicker) {
    hotelCollectionRoot = { offers: verified, context: { title: context.title, intro: context.intro } };
  }
  rememberRoomOffers(verified);
  const title = document.getElementById('hotel-collection-title');
  const intro = document.getElementById('hotel-collection-dialog-intro');
  if (title) title.textContent = context.title || (roomPicker ? 'Rooms & suites' : 'The hotel collection');
  if (intro) intro.textContent = context.intro || (roomPicker
    ? 'Choose the room style that feels right for your stay. Your final selection is recorded with your enquiry.'
    : 'Every experience below is part of the hotel’s preferred collection. Select one to leave a real enquiry for the concierge team.');
  if (hotelCollectionBack) hotelCollectionBack.hidden = !roomPicker || !hotelCollectionRoot.offers.length;
  hotelCollectionDialogGrid.replaceChildren(...verified.map((offer) => createHotelCollectionCard(offer, { roomPicker })));
  hotelCollectionModal.hidden = false;
  document.body.classList.add('collection-open');
  window.setTimeout(() => hotelCollectionModal.querySelector('[data-close-hotel-collection]')?.focus(), 60);
}

function openRoomTypeChooser(originOffer = {}) {
  const rooms = uniqueOffers([
    ...hotelCollectionRoot.offers,
    ...knownRoomOffers,
    originOffer,
  ]).filter((offer) => String(offer?.category || '').toLowerCase() === 'accommodation');
  if (rooms.length < 2) {
    openRoomBookingForm(originOffer);
    return;
  }
  openHotelCollection(rooms, {
    mode: 'room-picker',
    title: 'Choose your room or suite',
    intro: 'Compare the hotel’s room styles, then select one to continue to your private stay enquiry.',
  });
}

function returnToHotelCollection() {
  if (!hotelCollectionRoot.offers.length) return;
  openHotelCollection(hotelCollectionRoot.offers, hotelCollectionRoot.context);
}

function closeHotelCollection() {
  if (!hotelCollectionModal) return;
  hotelCollectionModal.hidden = true;
  document.body.classList.remove('collection-open');
}

function renderHotelCollection(offers, animate = true) {
  const verified = Array.isArray(offers) ? offers.filter((item) => item && item.name) : [];
  if (!verified.length) return null;

  const panel = document.createElement('section');
  panel.className = `hotel-collection-launcher${animate ? ' message-arrival' : ''}`;
  panel.setAttribute('aria-label', 'Open the full preferred hotel collection');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'hotel-collection-eyebrow';
  eyebrow.textContent = 'Preferred hotel collection';
  const title = document.createElement('h3');
  title.textContent = `${verified.length} experiences, ready to explore`;
  const intro = document.createElement('p');
  intro.textContent = 'Open the private collection to browse every hotel experience in a focused, full-screen view.';
  const open = document.createElement('button');
  open.className = 'hotel-collection-open';
  open.type = 'button';
  open.textContent = 'Explore the collection';
  open.addEventListener('click', () => openHotelCollection(verified));
  panel.append(eyebrow, title, intro, open);
  return panel;
}

function renderPartnerOffers(offers, animate = true) {
  const verified = Array.isArray(offers) ? offers.filter((item) => item && item.name) : [];
  if (!verified.length) return null;
  rememberRoomOffers(verified);

  const panel = document.createElement('section');
  panel.className = `hotel-collection-launcher partner-offer-launcher${animate ? ' message-arrival' : ''}`;
  panel.setAttribute('aria-label', 'Open matching hotel offers');
  const category = String(verified[0].category || 'experience').toLowerCase();
  const labels = { accommodation: 'rooms and suites', restaurant: 'dining options', spa: 'spa rituals', transport: 'chauffeur options', tour: 'private tours', experience: 'private experiences' };
  const label = labels[category] || 'hotel offers';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'hotel-collection-eyebrow';
  eyebrow.textContent = 'Preferred hotel collection';
  const title = document.createElement('h3');
  title.textContent = `${verified.length} ${label}, selected for you`;
  const intro = document.createElement('p');
  intro.textContent = 'View the hotel options and prices, then choose one to leave your reservation details.';
  const open = document.createElement('button');
  open.className = 'hotel-collection-open';
  open.type = 'button';
  open.textContent = category === 'accommodation' ? 'See rooms and suites' : 'See hotel offers';
  open.addEventListener('click', () => openHotelCollection(verified, {
    title: category === 'accommodation' ? 'Rooms and suites' : `Your ${label}`,
    intro: category === 'accommodation'
      ? 'Select a room to continue to your private stay request. The reservations team confirms final availability.'
      : 'These are the hotel’s preferred options for your request. Select one to leave a real concierge enquiry.',
  }));
  panel.append(eyebrow, title, intro, open);
  return panel;
}

function renderRoomBookingAction(enabled, animate = true) {
  if (!enabled) return null;
  const panel = document.createElement('section');
  panel.className = `room-booking-action${animate ? ' message-arrival' : ''}`;
  panel.setAttribute('aria-label', 'Hotel room enquiry');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'room-booking-eyebrow';
  eyebrow.textContent = 'Private stay request';
  const title = document.createElement('h3');
  title.textContent = 'Choose your room or suite';
  const description = document.createElement('p');
  description.textContent = 'Start by choosing a room style, then share the stay details needed to prepare your enquiry.';
  const button = document.createElement('button');
  button.className = 'room-booking-action-button';
  button.type = 'button';
  button.textContent = 'Explore rooms & suites';
  button.addEventListener('click', () => {
    if (knownRoomOffers.length > 1) openRoomTypeChooser(knownRoomOffers[0]);
    else openRoomBookingForm();
  });
  panel.append(eyebrow, title, description, button);
  return panel;
}

function renderMessage(message, animate = true) {
  const bubble = createMessageElement(message, animate);
  chatMessages.appendChild(bubble);
  const cards = renderRecommendations(message.recommendations, animate);
  if (cards) chatMessages.appendChild(cards);
  const partnerCards = renderPartnerOffers(message.partnerOffers, animate);
  if (partnerCards) chatMessages.appendChild(partnerCards);
  const hotelCollection = renderHotelCollection(message.hotelCollection, animate);
  if (hotelCollection) chatMessages.appendChild(hotelCollection);
  const roomBookingAction = renderRoomBookingAction(message.roomBooking, animate);
  if (roomBookingAction) chatMessages.appendChild(roomBookingAction);
}

function appendMessage(text, sender, recommendations = [], partnerOffers = [], roomBooking = false, hotelCollection = [], persist = true) {
  const message = { text: String(text || ''), sender, recommendations, partnerOffers, roomBooking: Boolean(roomBooking), hotelCollection, time: getCurrentTime() };
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

function roomEnquiryApiUrl() {
  return conciergeApiUrl('/api/room-enquiry');
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
        preferredLanguage: chatState.preferredLanguage || '',
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
    if (['en', 'fr', 'es', 'it', 'de', 'ar', 'ja', 'zh'].includes(String(result.language || ''))) {
      chatState.preferredLanguage = result.language;
      saveChatState();
    }
    const roomBooking = result.room_booking === true || result.intent === 'room_enquiry';
    appendMessage(result.reply || 'Our concierge will return with a considered answer shortly.', 'ai', result.recommendations || [], result.partner_offers || [], roomBooking, result.hotel_collection || []);
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
  closeHotelCollection();
  bookingForm.reset();
  bookingError.textContent = '';
  bookingServiceName.textContent = offer.name || 'Selected experience';
  const price = Number.isFinite(Number(offer.price_eur)) ? `EUR ${Number(offer.price_eur).toFixed(0)}` : 'Price on request';
  const duration = Number.isFinite(Number(offer.duration_mins)) && Number(offer.duration_mins) > 0 ? ` \u00b7 ${Number(offer.duration_mins)} min` : '';
  bookingServiceMeta.textContent = `${price}${duration}`;
  bookingForm.elements.serviceName.value = offer.name || '';
  bookingForm.elements.serviceType.value = offer.category || 'other';
  bookingForm.elements.source.value = offer.source === 'external' ? 'external' : 'partner';
  bookingModal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => bookingForm.elements.guestName?.focus(), 80);
}

function openOfferBookingForm(offer) {
  if (String(offer?.category || '').toLowerCase() === 'accommodation') {
    closeHotelCollection();
    openRoomBookingForm(offer);
    return;
  }
  closeHotelCollection();
  openBookingForm(offer);
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
    source: form.get('source'),
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

function openRoomBookingForm(offer = {}) {
  if (!roomBookingModal || !roomBookingForm) return;
  roomBookingForm.reset();
  roomBookingError.textContent = '';
  const selectedRoom = String(offer?.name || '').trim();
  const isSelectedRoom = Boolean(selectedRoom);
  if (roomBookingServiceSummary) roomBookingServiceSummary.hidden = !isSelectedRoom;
  if (isSelectedRoom) {
    roomBookingServiceName.textContent = selectedRoom;
    const roomPrice = Number.isFinite(Number(offer.price_eur)) ? `From EUR ${Number(offer.price_eur).toFixed(0)} / night` : 'Price on request';
    roomBookingServiceMeta.textContent = roomPrice;
  }
  roomBookingForm.elements.serviceName.value = selectedRoom;
  const today = new Date().toISOString().slice(0, 10);
  roomBookingForm.elements.checkIn.min = today;
  roomBookingForm.elements.checkOut.min = today;
  roomBookingForm.elements.adults.value = '2';
  roomBookingForm.elements.children.value = '0';
  roomBookingForm.elements.rooms.value = '1';
  roomBookingModal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => roomBookingForm.elements.firstName?.focus(), 80);
}

function closeRoomBookingForm() {
  if (!roomBookingModal) return;
  roomBookingModal.hidden = true;
  document.body.classList.remove('modal-open');
}

async function submitRoomBookingForm(event) {
  event.preventDefault();
  const endpoint = roomEnquiryApiUrl();
  if (!endpoint || !roomBookingForm) {
    roomBookingError.textContent = 'The room enquiry service is not configured yet.';
    return;
  }
  if (!roomBookingForm.reportValidity()) return;
  const form = new FormData(roomBookingForm);
  const checkIn = String(form.get('checkIn') || '');
  const checkOut = String(form.get('checkOut') || '');
  if (checkOut <= checkIn) {
    roomBookingError.textContent = 'Check-out must be after check-in.';
    return;
  }
  const payload = {
    firstName: form.get('firstName'),
    lastName: form.get('lastName'),
    email: form.get('email'),
    phone: form.get('phone'),
    checkIn,
    checkOut,
    arrivalTime: form.get('arrivalTime'),
    adults: form.get('adults'),
    children: form.get('children'),
    rooms: form.get('rooms'),
    serviceName: form.get('serviceName'),
    preference: form.get('preference'),
    notes: form.get('notes'),
    consent: form.get('consent') === 'yes',
    sessionId: chatState.sessionId,
    language: document.documentElement.lang || 'en',
  };
  roomBookingError.textContent = '';
  roomBookingSubmit.disabled = true;
  roomBookingSubmit.textContent = 'Sending room enquiry\u2026';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'We could not record your room enquiry.');
    closeRoomBookingForm();
    showToast('Room enquiry received. The reservations team can now prepare available options.');
  } catch (error) {
    roomBookingError.textContent = error instanceof Error ? error.message : 'We could not record your room enquiry.';
  } finally {
    roomBookingSubmit.disabled = false;
    roomBookingSubmit.textContent = 'Send room enquiry';
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

async function setFullscreen(isFullscreen, { requestBrowserFullscreen = true } = {}) {
  const alreadyFullscreen = chatWidget.classList.contains('fullscreen');
  if (alreadyFullscreen === isFullscreen && (!isFullscreen || !requestBrowserFullscreen || document.fullscreenElement)) return;
  chatWidget.classList.toggle('fullscreen', isFullscreen);
  if (isFullscreen) {
    document.body.appendChild(chatWidget);
    fullscreenIcon.classList.replace('fa-expand', 'fa-compress');
    document.body.style.overflow = 'hidden';
    fullscreenBtn?.setAttribute('aria-label', 'Exit full presentation mode');
    fullscreenBtn?.setAttribute('title', 'Exit full presentation mode');
    if (requestBrowserFullscreen && document.fullscreenEnabled && !document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // The edge-to-edge presentation view remains available when browser fullscreen is declined.
      }
    }
  } else {
    chatWrapper.prepend(chatWidget);
    fullscreenIcon.classList.replace('fa-compress', 'fa-expand');
    document.body.style.overflow = '';
    fullscreenBtn?.setAttribute('aria-label', 'Enter full presentation mode');
    fullscreenBtn?.setAttribute('title', 'Enter full presentation mode');
    if (requestBrowserFullscreen && document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // The visual mode has already been returned to the page.
      }
    }
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

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
fullscreenBtn?.addEventListener('click', () => setFullscreen(!chatWidget.classList.contains('fullscreen')));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && chatWidget.classList.contains('fullscreen')) {
    setFullscreen(false, { requestBrowserFullscreen: false });
  }
});
chatInput?.addEventListener('focus', () => {
  if (window.matchMedia('(max-width: 620px)').matches && !chatWidget.classList.contains('fullscreen')) setFullscreen(true);
});
bookingForm?.addEventListener('submit', submitBookingForm);
document.querySelectorAll('[data-close-booking]').forEach((button) => button.addEventListener('click', closeBookingForm));
bookingModal?.addEventListener('click', (event) => { if (event.target === bookingModal) closeBookingForm(); });
roomBookingForm?.addEventListener('submit', submitRoomBookingForm);
document.querySelectorAll('[data-close-room-booking]').forEach((button) => button.addEventListener('click', closeRoomBookingForm));
roomBookingModal?.addEventListener('click', (event) => { if (event.target === roomBookingModal) closeRoomBookingForm(); });
discoveryForm?.addEventListener('submit', submitDiscoveryForm);
document.querySelectorAll('.discovery-trigger').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); openDiscoveryForm(); }));
document.querySelectorAll('[data-close-discovery]').forEach((button) => button.addEventListener('click', closeDiscoveryForm));
discoveryModal?.addEventListener('click', (event) => { if (event.target === discoveryModal) closeDiscoveryForm(); });
document.querySelectorAll('[data-close-hotel-collection]').forEach((button) => button.addEventListener('click', closeHotelCollection));
hotelCollectionBack?.addEventListener('click', returnToHotelCollection);
hotelCollectionModal?.addEventListener('click', (event) => { if (event.target === hotelCollectionModal) closeHotelCollection(); });
document.querySelectorAll('.showcase-trigger').forEach((button) => button.addEventListener('click', () => setShowcaseScene(button.dataset.scene)));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Dialogs belong to the presentation layer. Escape closes the visible
  // dialog first, never the entire presentation underneath it.
  if (!hotelCollectionModal?.hidden) { closeHotelCollection(); return; }
  if (!bookingModal?.hidden) { closeBookingForm(); return; }
  if (!roomBookingModal?.hidden) { closeRoomBookingForm(); return; }
  if (!discoveryModal?.hidden) { closeDiscoveryForm(); return; }
  if (chatWidget.classList.contains('fullscreen')) setFullscreen(false);
});

restoreConversation();
