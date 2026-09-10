import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const MARGIN = 48;
const FOOTER_Y = 28;
const COLORS = Object.freeze({
  deepGreen: rgb(0.055, 0.19, 0.17),
  navy: rgb(0.06, 0.12, 0.18),
  brass: rgb(0.61, 0.45, 0.20),
  ivory: rgb(0.975, 0.965, 0.93),
  paper: rgb(1, 1, 1),
  ink: rgb(0.12, 0.15, 0.16),
  muted: rgb(0.35, 0.38, 0.38),
  rule: rgb(0.83, 0.80, 0.72),
});

function cleanPdfText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayValue(value) {
  if (Array.isArray(value)) return value.map(cleanPdfText).filter(Boolean);
  const text = cleanPdfText(value);
  return text || '';
}

function nonEmptyQuestion(question, value) {
  const answer = displayValue(value);
  if (!answer || (Array.isArray(answer) && !answer.length)) return null;
  return { question, answer };
}

function bookingShareLines(shares, otherDetail = '') {
  return Object.entries(shares || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([source, value]) => `${source === 'Other' && otherDetail ? `Other - ${otherDetail}` : source}: ${value}%`);
}

function formatOtherSelections(value, otherDetail = '') {
  if (!Array.isArray(value)) return value;
  return value.map((item) => item === 'Other' && otherDetail ? `Other - ${otherDetail}` : item);
}

function formatPms(discovery) {
  if (discovery?.pmsSystem === 'Other' && discovery.pmsOther) return `Other - ${discovery.pmsOther}`;
  return discovery?.pmsSystem || '';
}

export function sanitizeDiscoveryBriefFilename(hotelName) {
  const normalised = cleanPdfText(hotelName)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `ConciergeFlow_Discovery_Brief_${normalised || 'Hotel'}.pdf`;
}

export function deriveInternalPresentationNotes(lead) {
  const discovery = lead?.discovery || {};
  const notes = [];
  const preArrivalMethods = discovery.preArrivalMethods || [];
  const requestHandling = discovery.requestHandling || [];
  const managementInsights = discovery.managementInsights || [];
  const serviceUsage = discovery.serviceUsage || '';

  if (preArrivalMethods.includes('Email')) {
    notes.push('Demonstrate the proactive WhatsApp guest journey and compare it with the hotel\'s current email-led communication.');
  }
  if (['Less than 10%', '10-25%', '10-25%'].includes(cleanPdfText(serviceUsage))) {
    notes.push('Focus on proactive service discovery and ancillary-revenue opportunities.');
  }
  if (['Regularly', 'Very often'].includes(discovery.languageDifficulty)) {
    notes.push('Demonstrate automatic multilingual guest communication.');
  }
  if (requestHandling.some((item) => [
    'Reception handles them directly',
    'Reception calls the appropriate department',
    'Internal phone / radio',
    'WhatsApp staff group',
    'Written notes',
  ].includes(item))) {
    notes.push('Show the structured Requests workflow and front-desk visibility.');
  }
  if (managementInsights.some((item) => [
    'Most common guest questions',
    'Most requested services',
    'Guest complaints',
    'Response times',
    'Service / ancillary revenue',
    'Guest preferences',
    'Staff workload',
  ].includes(item))) {
    notes.push('Emphasize Mission Control and management visibility.');
  }
  if (['No', 'Sometimes'].includes(discovery.postCheckoutContact)) {
    notes.push('Show the post-stay feedback and service-recovery journey.');
  }
  return [...new Set(notes)];
}

export function buildDiscoveryBriefDocumentModel(lead, submittedAt = new Date()) {
  const discovery = lead?.discovery || {};
  const localeLabel = { en: 'English', fr: 'French', es: 'Spanish' }[lead?.locale] || 'English';
  const sections = [
    {
      title: '1. PROPERTY',
      questions: [
        nonEmptyQuestion('Hotel', lead.hotelName),
        nonEmptyQuestion('Brief language', localeLabel),
        nonEmptyQuestion('Number of rooms', lead.roomCount ? `${lead.roomCount}` : ''),
        nonEmptyQuestion('Properties operated', discovery.propertyCount ? `${discovery.propertyCount}` : ''),
        nonEmptyQuestion('PMS / reservation system', formatPms(discovery)),
        nonEmptyQuestion('Website', lead.website),
        nonEmptyQuestion('WhatsApp Business status', discovery.whatsAppBusiness),
      ].filter(Boolean),
    },
    {
      title: '2. GUEST SERVICES & REVENUE',
      questions: [
        nonEmptyQuestion('Estimated additional-service usage', discovery.serviceUsage),
        nonEmptyQuestion('Most requested services', formatOtherSelections(discovery.requestedServices, discovery.requestedServicesOther)),
        nonEmptyQuestion('Reasons for lower service usage', formatOtherSelections(discovery.lowServiceReasons, discovery.lowServiceReasonsOther)),
      ].filter(Boolean),
    },
    {
      title: '3. BOOKINGS & COMMUNICATION',
      questions: [
        nonEmptyQuestion('Reservation source shares', discovery.bookingSourcesNotSure ? 'Not sure' : bookingShareLines(discovery.bookingSources, discovery.bookingOtherDetail)),
        nonEmptyQuestion('Pre-arrival contact', discovery.preArrivalContact),
        ...(['Yes', 'Sometimes'].includes(discovery.preArrivalContact)
          ? [nonEmptyQuestion('Pre-arrival communication channels', formatOtherSelections(discovery.preArrivalMethods, discovery.preArrivalMethodsOther))]
          : []),
      ].filter(Boolean),
    },
    {
      title: '4. SERVICE DISCOVERY',
      questions: [
        nonEmptyQuestion('How guests discover hotel services', formatOtherSelections(discovery.discoveryChannels, discovery.discoveryChannelsOther)),
        nonEmptyQuestion('Services the hotel wants guests to discover more often', discovery.servicesToPromote),
      ].filter(Boolean),
    },
    {
      title: '5. OPERATIONS',
      questions: [
        nonEmptyQuestion('Repeated reception questions', formatOtherSelections(discovery.repeatedQuestions, discovery.repeatedQuestionsOther)),
        nonEmptyQuestion('How requests are currently handled', formatOtherSelections(discovery.requestHandling, discovery.requestHandlingOther)),
        nonEmptyQuestion('Response time during busy periods', discovery.responseSpeed),
        nonEmptyQuestion('Complaint / VIP escalation', discovery.escalationProcess),
        nonEmptyQuestion('Post-checkout feedback contact', discovery.postCheckoutContact),
        ...(['Yes', 'Sometimes'].includes(discovery.postCheckoutContact)
          ? [nonEmptyQuestion('Post-checkout contact methods', formatOtherSelections(discovery.postCheckoutMethods, discovery.postCheckoutMethodsOther))]
          : []),
      ].filter(Boolean),
    },
    {
      title: '6. GUESTS & LANGUAGE',
      questions: [
        nonEmptyQuestion('Main international guest markets', discovery.internationalOrigins),
        nonEmptyQuestion('Language difficulties', discovery.languageDifficulty),
        nonEmptyQuestion('Languages creating difficulty', discovery.difficultLanguages),
      ].filter(Boolean),
    },
    {
      title: '7. MANAGEMENT GOALS',
      questions: [
        nonEmptyQuestion('Information management wants', formatOtherSelections(discovery.managementInsights, discovery.managementInsightsOther)),
        nonEmptyQuestion('Top improvement goals', formatOtherSelections(discovery.improvementGoals, discovery.improvementGoalsOther)),
        nonEmptyQuestion('Presentation focus requested', discovery.presentationFocus),
      ].filter(Boolean),
    },
  ].filter((section) => section.questions.length);

  const date = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  return {
    submittedAt: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    sections,
    notes: deriveInternalPresentationNotes(lead),
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = cleanPdfText(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

class BriefPdfComposer {
  constructor(document, fonts) {
    this.document = document;
    this.fonts = fonts;
    this.page = null;
    this.pageNumber = 0;
    this.y = 0;
  }

  addPage() {
    this.page = this.document.addPage(A4);
    this.pageNumber += 1;
    const [, height] = A4;
    this.page.drawRectangle({ x: 0, y: height - 42, width: A4[0], height: 42, color: COLORS.deepGreen });
    this.page.drawText('FLOWARCHITECT AGENCY', { x: MARGIN, y: height - 20, size: 8.5, font: this.fonts.bold, color: COLORS.brass, characterSpacing: 0.8 });
    this.page.drawText('ConciergeFlow AI', { x: MARGIN, y: height - 33, size: 8.2, font: this.fonts.regular, color: COLORS.ivory });
    this.page.drawText('INTERNAL SALES DOCUMENT', { x: A4[0] - MARGIN - 120, y: height - 25, size: 7.4, font: this.fonts.bold, color: COLORS.ivory });
    this.page.drawLine({ start: { x: MARGIN, y: FOOTER_Y + 10 }, end: { x: A4[0] - MARGIN, y: FOOTER_Y + 10 }, thickness: 0.6, color: COLORS.rule });
    this.page.drawText('FlowArchitect Agency - ConciergeFlow AI', { x: MARGIN, y: FOOTER_Y, size: 7.2, font: this.fonts.regular, color: COLORS.muted });
    this.page.drawText(`${this.pageNumber}`, { x: A4[0] - MARGIN - 4, y: FOOTER_Y, size: 7.2, font: this.fonts.bold, color: COLORS.muted });
    this.y = height - 66;
  }

  ensure(height) {
    if (this.y - height < FOOTER_Y + 24) this.addPage();
  }

  lines(lines, { font, size, color = COLORS.ink, lineHeight = size * 1.35, indent = 0 } = {}) {
    for (const line of lines) {
      this.ensure(lineHeight);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
  }

  paragraph(text, options = {}) {
    const { font = this.fonts.regular, size = 9.4, color = COLORS.ink, lineHeight = size * 1.38, indent = 0 } = options;
    const lines = wrapText(text, font, size, A4[0] - (MARGIN * 2) - indent);
    this.lines(lines, { font, size, color, lineHeight, indent });
  }

  spacer(height = 8) {
    this.ensure(height);
    this.y -= height;
  }

  section(title) {
    this.ensure(30);
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 3 }, end: { x: A4[0] - MARGIN, y: this.y - 3 }, thickness: 0.7, color: COLORS.rule });
    this.y -= 15;
    this.page.drawText(title, { x: MARGIN, y: this.y, size: 10.2, font: this.fonts.bold, color: COLORS.deepGreen, characterSpacing: 0.3 });
    this.y -= 15;
  }

  question(question, answer) {
    const answerLines = Array.isArray(answer) ? answer : [answer];
    this.ensure(28);
    this.paragraph(question, { font: this.fonts.bold, size: 8.5, color: COLORS.muted, lineHeight: 11 });
    this.spacer(1);
    for (const item of answerLines) {
      const text = Array.isArray(answer) ? `- ${item}` : item;
      this.paragraph(text, { font: this.fonts.regular, size: 9.7, color: COLORS.ink, lineHeight: 13, indent: Array.isArray(answer) ? 8 : 0 });
    }
    this.spacer(8);
  }
}

function drawFirstPageHeader(composer, lead, model) {
  const [, height] = A4;
  composer.page.drawRectangle({ x: 0, y: height - 172, width: A4[0], height: 172, color: COLORS.deepGreen });
  composer.page.drawRectangle({ x: 0, y: height - 172, width: A4[0], height: 3, color: COLORS.brass });
  composer.page.drawText('FLOWARCHITECT AGENCY', { x: MARGIN, y: height - 38, size: 9, font: composer.fonts.bold, color: COLORS.brass, characterSpacing: 0.9 });
  composer.page.drawText('ConciergeFlow AI', { x: MARGIN, y: height - 59, size: 14, font: composer.fonts.serif, color: COLORS.ivory });
  composer.page.drawText('HOTEL DISCOVERY BRIEF', { x: MARGIN, y: height - 96, size: 20, font: composer.fonts.bold, color: COLORS.ivory, characterSpacing: 0.2 });
  const hotelLines = wrapText(lead.hotelName || 'Hotel', composer.fonts.serif, 15, A4[0] - (MARGIN * 2));
  hotelLines.slice(0, 2).forEach((line, index) => composer.page.drawText(line, {
    x: MARGIN,
    y: height - 123 - (index * 18),
    size: 15,
    font: composer.fonts.serif,
    color: COLORS.ivory,
  }));
  composer.y = height - 197;

  composer.page.drawText('PREPARED FROM', { x: MARGIN, y: composer.y, size: 8.2, font: composer.fonts.bold, color: COLORS.brass, characterSpacing: 0.6 });
  composer.y -= 15;
  composer.paragraph(cleanPdfText([lead.contactName, lead.role].filter(Boolean).join(' - ')), { font: composer.fonts.bold, size: 11, lineHeight: 14 });
  composer.paragraph(lead.email, { size: 9.4, color: COLORS.muted, lineHeight: 12 });
  if (lead.phone) composer.paragraph(lead.phone, { size: 9.4, color: COLORS.muted, lineHeight: 12 });
  composer.paragraph(`Submitted: ${model.submittedAt.slice(0, 16).replace('T', ' ')} UTC`, { size: 8.2, color: COLORS.muted, lineHeight: 12 });
  composer.spacer(10);
}

function drawPropertySnapshot(composer, lead) {
  const discovery = lead.discovery || {};
  const localeLabel = { en: 'English', fr: 'French', es: 'Spanish' }[lead.locale] || 'English';
  const rows = [
    ['Brief language', localeLabel],
    ['Rooms', lead.roomCount || 'Not provided'],
    ['Properties', discovery.propertyCount || 'Not provided'],
    ['PMS', formatPms(discovery) || 'Not provided'],
    ['Website', lead.website || 'Not provided'],
    ['WhatsApp Business', discovery.whatsAppBusiness || 'Not provided'],
  ];
  const boxHeight = 31 + (rows.length * 16);
  composer.ensure(boxHeight + 8);
  const top = composer.y;
  composer.page.drawRectangle({ x: MARGIN, y: top - boxHeight, width: A4[0] - (MARGIN * 2), height: boxHeight, color: COLORS.ivory, borderColor: COLORS.rule, borderWidth: 0.65 });
  composer.page.drawText('PROPERTY SNAPSHOT', { x: MARGIN + 14, y: top - 18, size: 8.3, font: composer.fonts.bold, color: COLORS.deepGreen, characterSpacing: 0.6 });
  rows.forEach(([label, value], index) => {
    const y = top - 36 - (index * 16);
    composer.page.drawText(cleanPdfText(label), { x: MARGIN + 14, y, size: 8.2, font: composer.fonts.bold, color: COLORS.muted });
    composer.page.drawText(cleanPdfText(value), { x: MARGIN + 142, y, size: 8.8, font: composer.fonts.regular, color: COLORS.ink });
  });
  composer.y -= boxHeight + 15;
}

export async function buildDiscoveryBriefPdf(lead, { submittedAt = new Date() } = {}) {
  const document = await PDFDocument.create();
  document.setTitle(`Hotel Discovery Brief - ${cleanPdfText(lead?.hotelName || 'Hotel')}`);
  document.setAuthor('FlowArchitect Agency - ConciergeFlow AI');
  document.setSubject('Internal hotel discovery brief');
  document.setCreator('ConciergeFlow AI');
  document.setCreationDate(submittedAt instanceof Date ? submittedAt : new Date(submittedAt));

  const fonts = {
    regular: await document.embedFont(StandardFonts.Helvetica),
    bold: await document.embedFont(StandardFonts.HelveticaBold),
    serif: await document.embedFont(StandardFonts.TimesRoman),
  };
  const model = buildDiscoveryBriefDocumentModel(lead, submittedAt);
  const composer = new BriefPdfComposer(document, fonts);
  composer.addPage();
  drawFirstPageHeader(composer, lead, model);
  drawPropertySnapshot(composer, lead);

  for (const section of model.sections) {
    composer.section(section.title);
    for (const item of section.questions) composer.question(item.question, item.answer);
  }

  if (model.notes.length) {
    composer.section('INTERNAL PRESENTATION NOTES');
    composer.paragraph('Derived only from the submitted answers. These notes are for FlowArchitect internal use and should not be presented as hotel facts.', { size: 8.6, color: COLORS.muted, lineHeight: 12 });
    composer.spacer(5);
    for (const note of model.notes) composer.question('Presentation note', [note]);
  }

  const bytes = await document.save({ useObjectStreams: false });
  return {
    bytes,
    filename: sanitizeDiscoveryBriefFilename(lead?.hotelName),
    pageCount: document.getPageCount(),
    model,
  };
}
