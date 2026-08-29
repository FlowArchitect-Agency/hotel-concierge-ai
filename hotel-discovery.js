(() => {
  const form = document.getElementById('hotel-discovery-form');
  if (!form) return;

  const steps = [...form.querySelectorAll('.brief-step')];
  const stepNames = ['Property', 'Services', 'Bookings', 'Communication', 'Operations', 'Guests', 'Goals'];
  const previous = document.getElementById('brief-previous');
  const continueButton = document.getElementById('brief-continue');
  const submitButton = document.getElementById('brief-submit');
  const error = document.getElementById('brief-error');
  const progressBar = document.getElementById('brief-progress-bar');
  const stepCurrent = document.getElementById('brief-step-current');
  const stepName = document.getElementById('brief-step-name');
  const stepList = [...document.querySelectorAll('#brief-step-list li')];
  const success = document.getElementById('brief-success');
  const reviewList = document.getElementById('brief-review-list');
  const originInput = document.getElementById('origin-input');
  const originAdd = document.getElementById('origin-add');
  const originTags = document.getElementById('origin-tags');
  const mockMode = new URL(window.location.href).searchParams.get('mock') === '1';
  let activeStep = 0;
  let origins = [];

  const field = (name) => form.elements.namedItem(name);
  const value = (name) => String(field(name)?.value || '').trim();
  const selected = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
  const radioValue = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value || '';
  const showError = (message = '') => { error.textContent = message; };

  function setConditional(name, visible) {
    const element = form.querySelector(`[data-conditional="${name}"]`);
    if (!element) return;
    element.hidden = !visible;
    if (!visible) {
      element.querySelectorAll('input, textarea, select').forEach((control) => {
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
        else control.value = '';
      });
    }
  }

  function updateConditions() {
    setConditional('pms-other', value('pmsSystem') === 'Other');
    setConditional('requested-other', selected('requestedServices').includes('Other'));
    const lowerUsage = ['Less than 10%', '10–25%', 'Not sure'].includes(radioValue('serviceUsage'));
    setConditional('low-service-reasons', lowerUsage);
    setConditional('low-services-other', lowerUsage && selected('lowServiceReasons').includes('Other'));
    setConditional('prearrival-methods', ['Yes', 'Sometimes'].includes(radioValue('preArrivalContact')));
    setConditional('postcheckout-methods', ['Yes', 'Sometimes'].includes(radioValue('postCheckoutContact')));
  }

  function updateBookingShare() {
    const entries = [...form.querySelectorAll('[data-booking-share]')]
      .map((input) => Number(input.value || 0))
      .filter((amount) => Number.isFinite(amount) && amount >= 0);
    const total = entries.reduce((sum, amount) => sum + amount, 0);
    const note = document.getElementById('booking-share-note');
    const hasEstimate = [...form.querySelectorAll('[data-booking-share]')].some((input) => input.value !== '');
    note.classList.toggle('is-attention', hasEstimate && (total < 70 || total > 130));
    note.textContent = hasEstimate && (total < 70 || total > 130)
      ? `Your estimates add up to ${total}%. That is completely fine if it reflects the information available; we will treat it as directional.`
      : 'An estimate is perfect. We will only flag totals that are far from 100%.';
  }

  function updateGoalLimit() {
    const group = form.querySelector('[data-max-select="3"]');
    if (!group) return;
    const selectedGoals = [...group.querySelectorAll('input:checked')];
    const atLimit = selectedGoals.length >= 3;
    group.querySelectorAll('input').forEach((input) => { input.disabled = atLimit && !input.checked; });
    const note = document.getElementById('goal-limit-note');
    note.textContent = atLimit ? 'Three priorities selected.' : 'Choose up to three.';
  }

  function renderOrigins() {
    originTags.replaceChildren();
    origins.forEach((origin) => {
      const tag = document.createElement('span');
      tag.className = 'brief-tag';
      tag.append(document.createTextNode(origin));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${origin}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        origins = origins.filter((entry) => entry !== origin);
        renderOrigins();
      });
      tag.append(remove);
      originTags.append(tag);
    });
  }

  function addOrigin() {
    const next = String(originInput.value || '').replace(/\s+/g, ' ').trim();
    if (!next) return;
    if (next.length > 80) { showError('Each guest market should be 80 characters or fewer.'); return; }
    if (origins.length >= 12) { showError('Please add no more than 12 guest markets.'); return; }
    if (!origins.some((origin) => origin.toLowerCase() === next.toLowerCase())) origins.push(next);
    originInput.value = '';
    showError('');
    renderOrigins();
  }

  function appendReviewItem(label, content) {
    if (!content) return;
    const wrapper = document.createElement('div');
    const title = document.createElement('dt');
    const detail = document.createElement('dd');
    title.textContent = label;
    detail.textContent = content;
    wrapper.append(title, detail);
    reviewList.append(wrapper);
  }

  function updateReview() {
    reviewList.replaceChildren();
    appendReviewItem('Property', value('hotelName') || 'Your hotel');
    appendReviewItem('Primary focus', selected('improvementGoals').join(', '));
    appendReviewItem('Service usage', radioValue('serviceUsage'));
    appendReviewItem('Pre-arrival', radioValue('preArrivalContact'));
    appendReviewItem('Language', radioValue('languageDifficulty'));
    appendReviewItem('Operations', selected('requestHandling').slice(0, 2).join(', '));
  }

  function renderStep({ focus = false } = {}) {
    steps.forEach((step, index) => { step.hidden = index !== activeStep; });
    previous.hidden = activeStep === 0;
    continueButton.hidden = activeStep === steps.length - 1;
    submitButton.hidden = activeStep !== steps.length - 1;
    stepCurrent.textContent = String(activeStep + 1).padStart(2, '0');
    stepName.textContent = stepNames[activeStep];
    progressBar.style.width = `${((activeStep + 1) / steps.length) * 100}%`;
    stepList.forEach((item, index) => {
      item.classList.toggle('is-active', index === activeStep);
      item.classList.toggle('is-complete', index < activeStep);
    });
    showError('');
    updateConditions();
    updateBookingShare();
    updateGoalLimit();
    if (activeStep === steps.length - 1) updateReview();
    if (focus) {
      const target = steps[activeStep].querySelector('input:not([type="hidden"]), select, textarea');
      target?.focus({ preventScroll: true });
      document.querySelector('.brief-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function validateStep(index) {
    const controls = [...steps[index].querySelectorAll('input, select, textarea')]
      .filter((control) => !control.disabled && !control.closest('[hidden]'));
    const invalid = controls.find((control) => !control.checkValidity());
    if (!invalid) return true;
    invalid.focus();
    invalid.reportValidity();
    return false;
  }

  function sessionId() {
    const key = 'conciergeflow-discovery-session';
    try {
      const known = window.sessionStorage.getItem(key);
      if (known) return known;
      const next = `web_brief_${crypto.randomUUID().replace(/-/g, '')}`;
      window.sessionStorage.setItem(key, next);
      return next;
    } catch {
      return `web_brief_${crypto.randomUUID().replace(/-/g, '')}`;
    }
  }

  function payload() {
    return {
      submissionType: 'hotel_discovery_brief',
      contactName: value('contactName'),
      role: value('role'),
      email: value('email'),
      phone: value('phone'),
      hotelName: value('hotelName'),
      website: value('website'),
      roomCount: value('roomCount'),
      propertyCount: value('propertyCount'),
      pmsSystem: value('pmsSystem'),
      pmsOther: value('pmsOther'),
      whatsAppBusiness: radioValue('whatsAppBusiness'),
      consent: field('consent')?.checked === true,
      sessionId: sessionId(),
      discovery: {
        serviceUsage: radioValue('serviceUsage'),
        requestedServices: selected('requestedServices'),
        requestedServicesOther: value('requestedServicesOther'),
        lowServiceReasons: selected('lowServiceReasons'),
        lowServiceReasonsOther: value('lowServiceReasonsOther'),
        bookingSources: {
          directWebsite: value('bookingDirectWebsite'), bookingCom: value('bookingBookingCom'), expedia: value('bookingExpedia'), otherOtas: value('bookingOtherOtas'), agenciesCorporate: value('bookingAgenciesCorporate'), other: value('bookingOther'),
        },
        bookingSourcesNotSure: field('bookingSourcesNotSure')?.checked === true,
        preArrivalContact: radioValue('preArrivalContact'),
        preArrivalMethods: selected('preArrivalMethods'),
        discoveryChannels: selected('discoveryChannels'),
        servicesToPromote: value('servicesToPromote'),
        internationalOrigins: origins,
        languageDifficulty: radioValue('languageDifficulty'),
        difficultLanguages: value('difficultLanguages'),
        repeatedQuestions: selected('repeatedQuestions'),
        requestHandling: selected('requestHandling'),
        responseSpeed: radioValue('responseSpeed'),
        escalationProcess: value('escalationProcess'),
        postCheckoutContact: radioValue('postCheckoutContact'),
        postCheckoutMethods: selected('postCheckoutMethods'),
        managementInsights: selected('managementInsights'),
        improvementGoals: selected('improvementGoals'),
        presentationFocus: value('presentationFocus'),
      },
    };
  }

  function endpoint() {
    try {
      if (!window.CONCIERGE_WEBHOOK_URL) return '';
      return new URL('/api/discovery-lead', window.CONCIERGE_WEBHOOK_URL).toString();
    } catch { return ''; }
  }

  function showSuccess() {
    form.hidden = true;
    success.hidden = false;
    success.focus({ preventScroll: true });
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submitBrief() {
    if (!validateStep(activeStep)) return;
    if (!field('consent')?.checked) { showError('Please confirm how we may use your responses before sending the brief.'); return; }
    showError('');
    submitButton.disabled = true;
    submitButton.textContent = 'Sending your brief…';
    try {
      if (mockMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        showSuccess();
        return;
      }
      const target = endpoint();
      if (!target) throw new Error('unavailable');
      const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload()) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (response.status >= 400 && response.status < 500 && typeof result.error === 'string') throw new Error(result.error);
        throw new Error('unavailable');
      }
      showSuccess();
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : '';
      showError(message === 'unavailable' ? 'The hotel brief service is temporarily unavailable. Please try again shortly.' : message);
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = 'Send my hotel brief <span aria-hidden="true">→</span>';
    }
  }

  continueButton.addEventListener('click', () => {
    if (!validateStep(activeStep)) return;
    activeStep += 1;
    renderStep({ focus: true });
  });
  previous.addEventListener('click', () => { activeStep = Math.max(0, activeStep - 1); renderStep({ focus: true }); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (activeStep < steps.length - 1) { continueButton.click(); return; }
    submitBrief();
  });
  form.addEventListener('change', () => { updateConditions(); updateBookingShare(); updateGoalLimit(); updateReview(); });
  form.addEventListener('input', () => { updateBookingShare(); updateReview(); });
  originAdd.addEventListener('click', addOrigin);
  originInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addOrigin(); } });
  renderStep();
})();
