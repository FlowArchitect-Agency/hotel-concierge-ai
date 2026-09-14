(() => {
  const form = document.getElementById('hotel-discovery-form');
  if (!form) return;

  const steps = [...form.querySelectorAll('.brief-step')];
  const translate = (key, variables) => window.CF_I18N?.t?.(key, variables) || key;
  const selectedLocale = () => window.CF_I18N?.getLocale?.() || 'en';
  const displayChoice = (entry) => window.CF_I18N?.choice?.(entry) || entry;
  const stepNames = () => ['brief.step.0', 'brief.step.1', 'brief.step.2', 'brief.step.3', 'brief.step.4', 'brief.step.5', 'brief.step.6'].map((key) => translate(key));
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
    element.querySelectorAll('[data-required-when-visible]').forEach((control) => { control.required = visible; });
    if (!visible) {
      element.querySelectorAll('input, textarea, select').forEach((control) => {
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
        else control.value = '';
        control.required = false;
      });
    }
  }

  function updateConditions() {
    setConditional('pms-other', value('pmsSystem') === 'Other');
    setConditional('requested-other', selected('requestedServices').includes('Other'));
    const lowerUsage = ['Less than 10%', '10–25%', 'Not sure'].includes(radioValue('serviceUsage'));
    setConditional('low-service-reasons', lowerUsage);
    setConditional('low-services-other', lowerUsage && selected('lowServiceReasons').includes('Other'));
    setConditional('booking-other', Number(value('bookingOther')) > 0);
    setConditional('prearrival-methods', ['Yes', 'Sometimes'].includes(radioValue('preArrivalContact')));
    setConditional('prearrival-other', ['Yes', 'Sometimes'].includes(radioValue('preArrivalContact')) && selected('preArrivalMethods').includes('Other'));
    setConditional('discovery-other', selected('discoveryChannels').includes('Other'));
    setConditional('repeated-other', selected('repeatedQuestions').includes('Other'));
    setConditional('handling-other', selected('requestHandling').includes('Other'));
    setConditional('postcheckout-methods', ['Yes', 'Sometimes'].includes(radioValue('postCheckoutContact')));
    setConditional('postcheckout-other', ['Yes', 'Sometimes'].includes(radioValue('postCheckoutContact')) && selected('postCheckoutMethods').includes('Other'));
    setConditional('insights-other', selected('managementInsights').includes('Other'));
    setConditional('goals-other', selected('improvementGoals').includes('Other'));
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
      ? translate('brief.shareAttention', { total })
      : translate('brief.shareNormal');
  }

  function updateGoalLimit() {
    const group = form.querySelector('[data-max-select="3"]');
    if (!group) return;
    const selectedGoals = [...group.querySelectorAll('input:checked')];
    const atLimit = selectedGoals.length >= 3;
    group.querySelectorAll('input').forEach((input) => { input.disabled = atLimit && !input.checked; });
    const note = document.getElementById('goal-limit-note');
    note.textContent = atLimit ? translate('brief.goalsChosen') : translate('brief.goalsHint');
  }

  function renderOrigins() {
    originTags.replaceChildren();
    origins.forEach((origin) => {
      const tag = document.createElement('span');
      tag.className = 'brief-tag';
      tag.append(document.createTextNode(origin));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', `${translate('common.remove')} ${origin}`);
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
    if (next.length > 80) { showError(translate('brief.error.originLength')); return; }
    if (origins.length >= 12) { showError(translate('brief.error.originLimit')); return; }
    if (!origins.some((origin) => origin.toLowerCase() === next.toLowerCase())) origins.push(next);
    originInput.value = '';
    clearValidationState(steps[activeStep]);
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
    appendReviewItem(translate('brief.review.property'), value('hotelName') || translate('brief.review.yourHotel'));
    appendReviewItem(translate('brief.review.focus'), selected('improvementGoals').map(displayChoice).join(', '));
    appendReviewItem(translate('brief.review.serviceUsage'), displayChoice(radioValue('serviceUsage')));
    appendReviewItem(translate('brief.review.preArrival'), displayChoice(radioValue('preArrivalContact')));
    appendReviewItem(translate('brief.review.language'), displayChoice(radioValue('languageDifficulty')));
    appendReviewItem(translate('brief.review.operations'), selected('requestHandling').slice(0, 2).map(displayChoice).join(', '));
    const otherDetails = [
      value('pmsOther'), value('requestedServicesOther'), value('lowServiceReasonsOther'), value('bookingOtherDetail'),
      value('preArrivalMethodsOther'), value('discoveryChannelsOther'), value('repeatedQuestionsOther'), value('requestHandlingOther'),
      value('postCheckoutMethodsOther'), value('managementInsightsOther'), value('improvementGoalsOther'),
    ].filter(Boolean);
    appendReviewItem(translate('brief.review.other'), otherDetails.map((detail) => `${displayChoice('Other')} — ${detail}`).join(' · '));
  }

  function renderStep({ focus = false } = {}) {
    steps.forEach((step, index) => { step.hidden = index !== activeStep; });
    previous.hidden = activeStep === 0;
    continueButton.hidden = activeStep === steps.length - 1;
    submitButton.hidden = activeStep !== steps.length - 1;
    stepCurrent.textContent = String(activeStep + 1).padStart(2, '0');
    stepName.textContent = stepNames()[activeStep];
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

  function clearValidationState(step = steps[activeStep]) {
    step.querySelectorAll('.brief-field-error').forEach((item) => item.remove());
    step.querySelectorAll('.is-invalid').forEach((item) => item.classList.remove('is-invalid'));
    step.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    });
  }

  function markInvalid(container, message, focusTarget) {
    container.classList.add('is-invalid');
    const id = `brief-validation-${Date.now()}`;
    const description = document.createElement('p');
    description.className = 'brief-field-error';
    description.id = id;
    description.setAttribute('role', 'alert');
    description.textContent = message;
    container.append(description);
    const controls = [...container.querySelectorAll('input, select, textarea')].filter((control) => !control.closest('[hidden]') && !control.disabled);
    controls.forEach((control) => {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', id);
    });
    const target = focusTarget || controls[0];
    target?.focus({ preventScroll: true });
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  function visibleContainer(name, selector = 'fieldset') {
    const control = form.querySelector(`[name="${name}"]`);
    return control?.closest(selector) || control?.closest('label') || null;
  }

  function requireText(name) {
    const control = field(name);
    if (control && String(control.value || '').trim() && control.checkValidity()) return true;
    return markInvalid(control?.closest('label') || control?.closest('fieldset') || steps[activeStep], translate('brief.error.question'), control);
  }

  function requireRadio(name) {
    if (radioValue(name)) return true;
    return markInvalid(visibleContainer(name), translate('brief.error.question'));
  }

  function requireMulti(name) {
    if (selected(name).length) return true;
    return markInvalid(visibleContainer(name), translate('brief.error.multiselect'));
  }

  function requireBookingSources() {
    const sources = [...form.querySelectorAll('[data-booking-share]')];
    const hasEstimate = sources.some((control) => String(control.value || '').trim() !== '');
    if (hasEstimate || field('bookingSourcesNotSure')?.checked) return true;
    return markInvalid(document.getElementById('booking-share-grid')?.closest('fieldset') || steps[activeStep], translate('brief.error.bookingSources'));
  }

  function requireOrigins() {
    if (origins.length) return true;
    const container = originTags.closest('fieldset');
    return markInvalid(container, translate('brief.error.multiselect'), originInput);
  }

  function requireVisibleOtherSpecs(step) {
    const visibleSpecs = [...step.querySelectorAll('[data-other-spec]:not([hidden]) [data-required-when-visible]')];
    for (const control of visibleSpecs) {
      if (String(control.value || '').trim() && control.checkValidity()) continue;
      return markInvalid(control.closest('[data-other-spec]'), translate('brief.error.question'), control);
    }
    return true;
  }

  function validateStep(index) {
    const step = steps[index];
    clearValidationState(step);
    showError('');
    const checks = [
      () => index !== 0 || ['contactName', 'role', 'email', 'hotelName', 'website', 'roomCount', 'propertyCount', 'pmsSystem'].every(requireText),
      () => index !== 0 || requireRadio('whatsAppBusiness'),
      () => index !== 1 || requireRadio('serviceUsage'),
      () => index !== 1 || requireMulti('requestedServices'),
      () => index !== 1 || form.querySelector('[data-conditional="low-service-reasons"]')?.hidden || requireMulti('lowServiceReasons'),
      () => index !== 2 || requireBookingSources(),
      () => index !== 2 || requireRadio('preArrivalContact'),
      () => index !== 3 || form.querySelector('[data-conditional="prearrival-methods"]')?.hidden || requireMulti('preArrivalMethods'),
      () => index !== 3 || requireMulti('discoveryChannels'),
      () => index !== 3 || requireText('servicesToPromote'),
      () => index !== 4 || requireMulti('repeatedQuestions'),
      () => index !== 4 || requireMulti('requestHandling'),
      () => index !== 4 || requireRadio('responseSpeed'),
      () => index !== 4 || requireText('escalationProcess'),
      () => index !== 4 || requireRadio('postCheckoutContact'),
      () => index !== 4 || form.querySelector('[data-conditional="postcheckout-methods"]')?.hidden || requireMulti('postCheckoutMethods'),
      () => index !== 5 || requireOrigins(),
      () => index !== 5 || requireRadio('languageDifficulty'),
      () => index !== 5 || requireText('difficultLanguages'),
      () => index !== 6 || requireMulti('managementInsights'),
      () => index !== 6 || requireMulti('improvementGoals'),
      () => index !== 6 || requireText('presentationFocus'),
      () => requireVisibleOtherSpecs(step),
    ];
    return checks.every((check) => check());
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
      locale: selectedLocale(),
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
        bookingOtherDetail: value('bookingOtherDetail'),
        preArrivalContact: radioValue('preArrivalContact'),
        preArrivalMethods: selected('preArrivalMethods'),
        preArrivalMethodsOther: value('preArrivalMethodsOther'),
        discoveryChannels: selected('discoveryChannels'),
        discoveryChannelsOther: value('discoveryChannelsOther'),
        servicesToPromote: value('servicesToPromote'),
        internationalOrigins: origins,
        languageDifficulty: radioValue('languageDifficulty'),
        difficultLanguages: value('difficultLanguages'),
        repeatedQuestions: selected('repeatedQuestions'),
        repeatedQuestionsOther: value('repeatedQuestionsOther'),
        requestHandling: selected('requestHandling'),
        requestHandlingOther: value('requestHandlingOther'),
        responseSpeed: radioValue('responseSpeed'),
        escalationProcess: value('escalationProcess'),
        postCheckoutContact: radioValue('postCheckoutContact'),
        postCheckoutMethods: selected('postCheckoutMethods'),
        postCheckoutMethodsOther: value('postCheckoutMethodsOther'),
        managementInsights: selected('managementInsights'),
        managementInsightsOther: value('managementInsightsOther'),
        improvementGoals: selected('improvementGoals'),
        improvementGoalsOther: value('improvementGoalsOther'),
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
    const calendly = document.getElementById('brief-calendly');
    if (calendly && window.CONCIERGE_CALENDLY_URL) calendly.href = window.CONCIERGE_CALENDLY_URL;
    form.hidden = true;
    success.hidden = false;
    success.focus({ preventScroll: true });
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function submitBrief() {
    if (!validateStep(activeStep)) return;
    if (!field('consent')?.checked) { showError(translate('brief.error.consent')); return; }
    showError('');
    submitButton.disabled = true;
    submitButton.textContent = translate('brief.sending');
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
      showError(message === 'unavailable' ? translate('brief.error.unavailable') : message);
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = `${translate('brief.submit')} <span aria-hidden="true">→</span>`;
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
  function refreshFormState() {
    clearValidationState(steps[activeStep]);
    showError('');
    updateConditions();
    updateBookingShare();
    updateGoalLimit();
    updateReview();
  }
  form.addEventListener('change', refreshFormState);
  form.addEventListener('input', refreshFormState);
  originAdd.addEventListener('click', addOrigin);
  originInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addOrigin(); } });
  document.addEventListener('conciergeflow:localechange', () => renderStep());
  renderStep();
})();
