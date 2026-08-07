// Keep credentials in a private environment file, never in source control.
const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;

if (!apiKey || !baseId) {
  throw new Error('Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID before seeding services.');
}

const services = [
  // Spa
  {
    Name: "Lumière Spa — Couples Massage",
    Category: "spa",
    SubType: "Couples Massage",
    Description: "Side-by-side 60-min Swedish massage in private suite with champagne. Includes hammam access.",
    PriceEUR: 420,
    DurationMins: 75,
    Location: "Level -1, Spa Lumière",
    PhoneNumber: "+33140001100",
    Availability: "Daily 10:00-21:00",
    Tags: ["couples", "luxury", "view"],
    Active: true
  },
  {
    Name: "Lumière Spa — Signature Hammam Ritual",
    Category: "spa",
    SubType: "Hammam",
    Description: "Traditional 90-min Moroccan hammam: black soap exfoliation, ghassoul wrap, argan oil massage.",
    PriceEUR: 280,
    DurationMins: 105,
    Location: "Level -1, Spa Lumière",
    PhoneNumber: "+33140001100",
    Availability: "Daily 10:00-21:00",
    Tags: ["couples", "luxury"],
    Active: true
  },
  // Restaurant
  {
    Name: "Le Jardin — Chef's Table (2 Michelin)",
    Category: "restaurant",
    SubType: "Fine Dining",
    Description: "Private kitchen counter experience. 8-course tasting menu with wine pairing. Garden view.",
    PriceEUR: 580,
    DurationMins: 180,
    Location: "Hotel Ground Floor",
    PhoneNumber: "+33140001111",
    Availability: "Tue-Sat 19:30 & 21:00",
    Tags: ["couples", "luxury", "view"],
    Active: true
  },
  {
    Name: "Terrasse Lumière — Rooftop Dinner",
    Category: "restaurant",
    SubType: "Rooftop",
    Description: "Seasonal a la carte on the rooftop with Eiffel Tower views. Vegetarian & vegan menus available.",
    PriceEUR: 180,
    DurationMins: 120,
    Location: "Rooftop, 7th Floor",
    PhoneNumber: "+33140001112",
    Availability: "Daily 19:00-23:00",
    Tags: ["couples", "vegan", "view"],
    Active: true
  },
  // Transport
  {
    Name: "Private Chauffeur — CDG/ORY Transfer",
    Category: "transport",
    SubType: "Airport Transfer",
    Description: "Mercedes S-Class or V-Class. Flight tracking, meet & greet, bottled water, WiFi. Up to 4 passengers + luggage.",
    PriceEUR: 180,
    DurationMins: 60,
    Location: "Hotel Lobby / Airport Terminal",
    PhoneNumber: "+33140001122",
    Availability: "24/7 with 2h notice",
    Tags: ["arrival", "luxury", "family"],
    Active: true
  },
  {
    Name: "Private Chauffeur — Half-Day Disposal",
    Category: "transport",
    SubType: "Hourly",
    Description: "Mercedes S-Class with dedicated chauffeur for 4 hours. Ideal for shopping, sightseeing, meetings.",
    PriceEUR: 450,
    DurationMins: 240,
    Location: "Hotel Lobby",
    PhoneNumber: "+33140001122",
    Availability: "Daily 08:00-20:00",
    Tags: ["luxury", "shopping", "family"],
    Active: true
  },
  // Tours & Experiences
  {
    Name: "Private Seine Sunset Cruise & Champagne",
    Category: "experience",
    SubType: "Private Cruise",
    Description: "2-hour private yacht on Seine at golden hour. Vintage Champagne, private skipper, Eiffel Tower sparkle show.",
    PriceEUR: 1200,
    DurationMins: 120,
    Location: "Port de la Bourdonnais (5 min walk)",
    PhoneNumber: "+33140001133",
    Availability: "Daily sunset (seasonal times)",
    Tags: ["couples", "luxury", "view", "honeymoon"],
    Active: true
  },
  {
    Name: "VIP Louvre After-Hours Private Tour",
    Category: "experience",
    SubType: "Museum Private Tour",
    Description: "Licensed art historian guide. 2-hour private access after closing (max 6 people). Mona Lisa without crowds.",
    PriceEUR: 2800,
    DurationMins: 120,
    Location: "Louvre Pyramid (hotel pickup included)",
    PhoneNumber: "+33140001134",
    Availability: "Wed & Fri 18:00-21:00 (advance booking)",
    Tags: ["couples", "luxury", "culture", "family"],
    Active: true
  },
  {
    Name: "Montmartre Walking Food Tour",
    Category: "tour",
    SubType: "Walking Tour",
    Description: "Private 3-hour culinary walk through Montmartre. 6 tastings: cheese, wine, charcuterie, pastry, chocolate. Local guide.",
    PriceEUR: 280,
    DurationMins: 180,
    Location: "Hotel Lobby Pickup",
    PhoneNumber: "+33140001135",
    Availability: "Daily 10:00 & 15:00",
    Tags: ["food", "culture", "couples", "vegan"],
    Active: true
  },
  {
    Name: "Versailles Private Day Trip",
    Category: "tour",
    SubType: "Day Trip",
    Description: "Full-day private guided tour of Palace & Gardens. Skip-the-line, golf cart in gardens, Marie Antoinette estate.",
    PriceEUR: 950,
    DurationMins: 480,
    Location: "Hotel Lobby Pickup 08:30",
    PhoneNumber: "+33140001136",
    Availability: "Daily except Mon 08:30-16:30",
    Tags: ["family", "culture", "luxury", "history"],
    Active: true
  },
  {
    Name: "In-Suite Private Chef & Sommelier Dinner",
    Category: "experience",
    SubType: "Private Dining",
    Description: "Michelin-background chef prepares bespoke 5-course menu in your suite. Sommelier pairs each course. Service & cleanup included.",
    PriceEUR: 1500,
    DurationMins: 180,
    Location: "Guest Suite",
    PhoneNumber: "+33140001199",
    Availability: "Daily 19:00-22:00 (48h notice)",
    Tags: ["couples", "luxury", "honeymoon", "celebration"],
    Active: true
  },
  {
    Name: "Atelier Parfum — Custom Fragrance Workshop",
    Category: "experience",
    SubType: "Workshop",
    Description: "Private 2-hour session with master perfumer. Create your signature scent (100ml bottle to keep). Max 2 people.",
    PriceEUR: 650,
    DurationMins: 120,
    Location: "Atelier (10 min walk) or In-Suite",
    PhoneNumber: "+33140001144",
    Availability: "Tue-Sat 14:00 & 17:00",
    Tags: ["couples", "luxury", "unique"],
    Active: true
  }
];

const url = `https://api.airtable.com/v0/${baseId}/Services`;

async function createBatch(records, offset = 0) {
  const batch = records.slice(offset, offset + 10);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ records: batch.map(r => ({ fields: r })), typecast: true })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data, null, 2));
  console.log(`Created ${data.records.length} records (total ${offset + data.records.length})`);
  if (offset + 10 < records.length) {
    await new Promise(r => setTimeout(r, 250));
    return createBatch(records, offset + 10);
  }
  return data;
}

createBatch(services)
  .then(() => console.log('All services created!'))
  .catch(e => console.error('Error:', e.message));
