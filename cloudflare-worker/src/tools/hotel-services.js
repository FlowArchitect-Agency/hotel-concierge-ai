import { toolResult } from './schemas.js';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function serviceRecord(record) {
  const source = record?.fields ?? record ?? {};
  const price = source.PriceEUR ?? source['Price EUR'] ?? source.price ?? null;
  const duration = source.DurationMins ?? source['Duration (mins)'] ?? source.duration ?? null;
  return {
    name: clean(source.Name ?? source.name),
    category: normalized(source.Category ?? source.category),
    description: clean(source.Description ?? source.description),
    tags: clean(source.Tags ?? source.tags),
    sub_type: clean(source.SubType ?? source['Sub Type'] ?? source.sub_type),
    price_eur: Number.isFinite(Number(price)) ? Number(price) : null,
    duration_mins: Number.isFinite(Number(duration)) ? Number(duration) : null,
    location: clean(source.Location ?? source.location),
    phone: clean(source.PhoneNumber ?? source['Phone Number'] ?? source.phone),
    image_url: clean(source.ImageURL ?? source['Image URL'] ?? source.image_url),
    website_url: clean(source.WebsiteURL ?? source['Website URL'] ?? source.website_url),
    is_partner: source.IsPartner === true || source.isPartner === true || source.is_partner === true,
    active: source.Active !== false && source.active !== false,
  };
}

export async function runHotelServices({ input, records }) {
  try {
    if (!Array.isArray(records)) return toolResult('hotel_services', 'unavailable', { errorCode: 'services_source_unavailable' });
    const all = records.map(serviceRecord).filter((service) => service.name && service.active);
    const categories = input.categories || [];
    const services = categories.length ? all.filter((service) => categories.includes(service.category)) : all;
    if (!services.length) return toolResult('hotel_services', 'no_results', { data: { services: [], categories } });
    return toolResult('hotel_services', 'success', { data: { services, categories } });
  } catch {
    return toolResult('hotel_services', 'error', { errorCode: 'services_source_error' });
  }
}
