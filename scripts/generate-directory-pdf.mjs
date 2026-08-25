#!/usr/bin/env node
/**
 * scripts/generate-directory-pdf.mjs
 * Generates an Apple-grade, high-typography luxury PDF brochure for Hôtel Lumière Paris
 * featuring all 8 curated services with historical context, photography, and pricing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlTempPath = path.join(projectRoot, 'temp_directory_brochure.html');
const outputPdfPath = path.join(projectRoot, 'Lumiere_Guest_Directory_2026.pdf');
const assetPdfPath = path.join(projectRoot, 'assets', 'brochures', 'Lumiere_Guest_Directory_2026.pdf');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Hôtel Lumière Paris — Digital Guest Directory 2026</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap');

  @page {
    size: A4 portrait;
    margin: 0;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Display", "Helvetica Neue", sans-serif;
    background-color: #121820;
    color: #121820;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    width: 210mm;
    height: 297mm;
    page-break-after: always;
    position: relative;
    overflow: hidden;
    background: #faf9f6;
    display: flex;
    flex-direction: column;
  }

  /* COVER PAGE */
  .page-cover {
    background: #0f141c;
    color: #ffffff;
    padding: 50mm 24mm 24mm 24mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .cover-bg {
    position: absolute;
    inset: 0;
    background-image: linear-gradient(180deg, rgba(15, 20, 28, 0.45) 0%, rgba(15, 20, 28, 0.92) 80%),
                      url('https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1600&q=85');
    background-size: cover;
    background-position: center;
    z-index: 1;
  }

  .cover-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    height: 100%;
    justify-content: space-between;
  }

  .hotel-brand {
    letter-spacing: 0.28em;
    text-transform: uppercase;
    font-size: 13px;
    font-weight: 600;
    color: #b3894b;
  }

  .cover-title-group h1 {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 54px;
    line-height: 1.05;
    font-weight: 500;
    color: #ffffff;
    margin-top: 24px;
    letter-spacing: -0.01em;
  }

  .cover-title-group p {
    font-size: 16px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
    max-width: 480px;
    margin-top: 18px;
    font-weight: 300;
  }

  .cover-footer {
    border-top: 1px solid rgba(179, 137, 75, 0.35);
    padding-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .cover-badge {
    background: rgba(179, 137, 75, 0.18);
    border: 1px solid rgba(179, 137, 75, 0.5);
    backdrop-filter: blur(12px);
    padding: 8px 18px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #f1dfc3;
  }

  /* INNER PAGES */
  .page-header {
    height: 38mm;
    padding: 16mm 22mm 0 22mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }

  .header-brand {
    font-family: 'Cormorant Garamond', serif;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #121820;
  }

  .header-category {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #b3894b;
  }

  .page-body {
    flex: 1;
    padding: 18mm 22mm;
    display: flex;
    flex-direction: column;
  }

  .service-hero-image {
    width: 100%;
    height: 82mm;
    border-radius: 14px;
    overflow: hidden;
    position: relative;
    box-shadow: 0 16px 36px -12px rgba(18, 24, 32, 0.18);
  }

  .service-hero-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .service-meta-bar {
    position: absolute;
    bottom: 12px;
    left: 14px;
    right: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(18, 24, 32, 0.72);
    backdrop-filter: blur(18px) saturate(180%);
    padding: 10px 18px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #ffffff;
  }

  .service-number {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #f1dfc3;
  }

  .service-price {
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
  }

  .service-details {
    margin-top: 16mm;
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .service-title {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 32px;
    line-height: 1.1;
    font-weight: 600;
    color: #121820;
    letter-spacing: -0.01em;
  }

  .service-tagline {
    font-size: 13px;
    font-weight: 600;
    color: #b3894b;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 6px;
  }

  .service-history-box {
    margin-top: 14px;
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-left: 3px solid #b3894b;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 12.5px;
    line-height: 1.55;
    color: #4a5568;
    font-style: italic;
  }

  .service-highlights-title {
    margin-top: 18px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: #121820;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .service-highlights-grid {
    margin-top: 10px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .highlight-item {
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .highlight-icon {
    font-size: 16px;
    line-height: 1;
  }

  .highlight-text h4 {
    font-size: 12px;
    font-weight: 600;
    color: #121820;
  }

  .highlight-text p {
    font-size: 11px;
    line-height: 1.4;
    color: #5c6875;
    margin-top: 2px;
  }

  .page-footer {
    height: 18mm;
    padding: 0 22mm 10mm 22mm;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    font-size: 10.5px;
    color: #8b97a4;
  }

  .page-footer strong {
    color: #121820;
    font-weight: 600;
  }

  /* CONTENTS OVERVIEW PAGE */
  .overview-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 16px;
  }

  .overview-card {
    background: #ffffff;
    border: 1px solid rgba(0, 0, 0, 0.07);
    border-radius: 10px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .overview-card-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .overview-card h3 {
    font-family: 'Cormorant Garamond', serif;
    font-size: 18px;
    font-weight: 600;
    color: #121820;
  }

  .overview-card-price {
    font-size: 13px;
    font-weight: 700;
    color: #b3894b;
  }

  .overview-card p {
    font-size: 11.5px;
    line-height: 1.45;
    color: #5c6875;
    margin-top: 6px;
  }
</style>
</head>
<body>

  <!-- PAGE 1: COVER PAGE -->
  <div class="page page-cover">
    <div class="cover-bg"></div>
    <div class="cover-content">
      <div>
        <div class="hotel-brand">Hôtel Lumière Paris · 5-Star Palace</div>
        <div class="cover-title-group">
          <h1>Digital Guest Directory &amp;<br>Signature Experiences</h1>
          <p>An exquisite curation of two-Michelin starred gastronomy, holistic thermal wellness, bespoke private mobility, and exclusive after-hours cultural access across Paris.</p>
        </div>
      </div>
      <div class="cover-footer">
        <div>
          <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: rgba(255, 255, 255, 0.6);">Edition 2026</div>
          <div style="font-size: 13px; font-weight: 500; color: #ffffff; margin-top: 2px;">Curated by the Head Concierge · Les Clefs d'Or</div>
        </div>
        <div class="cover-badge">8 Signature Privileges</div>
      </div>
    </div>
  </div>

  <!-- PAGE 2: TABLE OF CONTENTS & PROTOCOL -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">Collection Overview</div>
    </div>
    <div class="page-body">
      <h2 style="font-family: 'Cormorant Garamond', serif; font-size: 34px; font-weight: 500;">Your Dedicated Concierge Experience</h2>
      <p style="font-size: 13px; line-height: 1.6; color: #5c6875; margin-top: 8px;">
        Welcome to Hôtel Lumière Paris. Every experience in this collection has been personally vetted and negotiated exclusively for our guests. To book any privilege, simply reply to our AI Concierge on WhatsApp with your desired time and party size.
      </p>

      <div class="overview-grid">
        <div class="overview-card">
          <div class="overview-card-header">
            <h3>1. Le Jardin — Chef's Table</h3>
            <span class="overview-card-price">€580</span>
          </div>
          <p>2-Michelin starred dining by Chef Alexandre Mercier with 7-course seasonal tasting and rare wine pairing.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>2. Terrasse Lumière Dinner</h3>
            <span class="overview-card-price">€180</span>
          </div>
          <p>Panoramic rooftop dining overlooking the illuminated Eiffel Tower with vintage Krug champagne.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>3. CDG / ORY Airport Transfer</h3>
            <span class="overview-card-price">€180</span>
          </div>
          <p>Executive Mercedes-Maybach airport transport with airside meet &amp; greet and seamless tarmac escort.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>4. Chauffeur Half-Day Disposal</h3>
            <span class="overview-card-price">€450</span>
          </div>
          <p>4 hours of private Mercedes driver at your continuous disposal for Avenue Montaigne shopping and meetings.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>5. Lumière Couples Massage</h3>
            <span class="overview-card-price">€420</span>
          </div>
          <p>75-minute holistic rejuvenation in our private double sanctuary with customized botanical aromatherapy.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>6. Signature Hammam Ritual</h3>
            <span class="overview-card-price">€280</span>
          </div>
          <p>105-minute marble thermal bath ritual, black soap scrub, rhassoul wrap, and orange blossom infusion.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>7. VIP Louvre After-Hours Tour</h3>
            <span class="overview-card-price">€2,800</span>
          </div>
          <p>Exclusive private museum opening past 6 PM with art historian curator to view the Mona Lisa in complete solitude.</p>
        </div>

        <div class="overview-card">
          <div class="overview-card-header">
            <h3>8. Versailles Private Day Trip</h3>
            <span class="overview-card-price">€950</span>
          </div>
          <p>Full 8-hour royal excursion to the Hall of Mirrors, King's State Apartments, and Marie Antoinette Estate.</p>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Hôtel Lumière Concierge Operations Suite</div>
      <div>Page <strong>2</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 3: LE JARDIN CHEF'S TABLE -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">01 · Haute Gastronomie</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?auto=format&fit=crop&w=1600&q=85" alt="Le Jardin Chef's Table">
        <div class="service-meta-bar">
          <span class="service-number">Service 01 · 2 Michelin Stars</span>
          <span class="service-price">€580 / guest · 180 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Le Jardin — Chef's Table (2 Michelin)</h2>
        <div class="service-tagline">Intimate 7-Course Culinary Symphony &amp; Grand Cru Pairing</div>
        <div class="service-history-box">
          “Gastronomy is the art of using food to create happiness.” Located within the historic vaulted glass conservatory of Hôtel Lumière, Le Jardin showcases contemporary French haute cuisine led by Executive Chef Alexandre Mercier, celebrating terroir and biodiversity.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🍽️</span>
            <div class="highlight-text">
              <h4>7-Course Tasting Menu</h4>
              <p>Hand-dived Saint-Jacques scallops, Brittany blue lobster, and Sologne venison.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🍷</span>
            <div class="highlight-text">
              <h4>Sommelier Wine Pairing</h4>
              <p>Rare vintages from Bordeaux and Burgundy curated by Head Sommelier Éléonore.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">👨‍🍳</span>
            <div class="highlight-text">
              <h4>Front-Row Kitchen View</h4>
              <p>Exclusive seating adjacent to the open pass with personalized chef introductions.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🧀</span>
            <div class="highlight-text">
              <h4>Artisanal Fromage Trolley</h4>
              <p>Affiné raw-milk selections aged specifically for the Palace cellar.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Dress Code: Smart Elegant · Seatings at 19:30 &amp; 20:30</div>
      <div>Page <strong>3</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 4: TERRASSE LUMIÈRE ROOFTOP -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">02 · Panoramic Dining</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=85" alt="Terrasse Lumière Rooftop">
        <div class="service-meta-bar">
          <span class="service-number">Service 02 · Rooftop Vista</span>
          <span class="service-price">€180 / guest · 120 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Terrasse Lumière — Rooftop Dinner</h2>
        <div class="service-tagline">Sunset Vistas Over the Seine &amp; Eiffel Tower Light Show</div>
        <div class="service-history-box">
          Perched on our 7th-floor private rooftop terrace, Terrasse Lumière offers an unobstructed 360-degree panorama of the Paris skyline, the Grand Palais glass dome, and the sparkling Eiffel Tower as twilight descends.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🗼</span>
            <div class="highlight-text">
              <h4>Unrivaled Eiffel Tower Views</h4>
              <p>Front-row candlelit terrace seating for the hourly 20,000-bulb sparkle show.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🥂</span>
            <div class="highlight-text">
              <h4>Champagne Welcome</h4>
              <p>Complimentary glass of chilled Krug Grande Cuvée Brut upon arrival.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🥩</span>
            <div class="highlight-text">
              <h4>3-Course Contemporary Dinner</h4>
              <p>Line-caught sea bass, dry-aged Charolais beef fillet, and Madagascar vanilla soufflé.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🎷</span>
            <div class="highlight-text">
              <h4>Acoustic Live Jazz</h4>
              <p>Subtle Parisian jazz trio performing in the open-air lounge every evening.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Heated Terrace Available Year-Round · Daily 18:30 – 23:30</div>
      <div>Page <strong>4</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 5: CDG/ORY CHAUFFEUR TRANSFER -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">03 · Private Aviation &amp; Mobility</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1600&q=85" alt="VIP Airport Private Jet Tarmac Chauffeur">
        <div class="service-meta-bar">
          <span class="service-number">Service 03 · VIP Airport Tarmac Transfer</span>
          <span class="service-price">€180 flat rate · ~60 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Private Chauffeur — CDG / ORY Airport Transfer</h2>
        <div class="service-tagline">Seamless First-Class Airport Mobility in Mercedes-Maybach S-Class</div>
        <div class="service-history-box">
          Arrive in Paris with complete peace of mind. Your dedicated private chauffeur tracks your flight radar in real-time, meeting you directly at the jet-bridge gate or VIP terminal exit with personalized luggage handling.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🚘</span>
            <div class="highlight-text">
              <h4>Executive Fleet</h4>
              <p>Latest model Mercedes-Maybach S-Class or Mercedes V-Class Extra-Long for families.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">✈️</span>
            <div class="highlight-text">
              <h4>Real-Time Flight Tracking</h4>
              <p>Zero waiting fees for delayed flights; your driver adjusts pickup automatically.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🍾</span>
            <div class="highlight-text">
              <h4>In-Cabin Amenities</h4>
              <p>Chilled Evian water, Oshibori scented towels, fast Wi-Fi, and multi-device chargers.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">👔</span>
            <div class="highlight-text">
              <h4>Multilingual Chauffeur</h4>
              <p>Discreet, licensed Parisian chauffeur fluent in English, French, and Spanish.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Available 24/7 for CDG, Orly, and Le Bourget Private Jet Terminal</div>
      <div>Page <strong>5</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 6: CHAUFFEUR HALF-DAY DISPOSAL -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">04 · Bespoke Transport</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1600&q=85" alt="Mercedes-Benz S-Class Luxury Chauffeur">
        <div class="service-meta-bar">
          <span class="service-number">Service 04 · Dedicated Vehicle</span>
          <span class="service-price">€450 · 4 Hours Disposal</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Private Chauffeur — Half-Day Disposal</h2>
        <div class="service-tagline">4 Hours of Dedicated Luxury Driver on Continuous Standby</div>
        <div class="service-history-box">
          Experience Paris at your own pace without hailing taxis or waiting for ride-shares. Perfect for shopping sprees along Avenue Montaigne and Rue du Faubourg Saint-Honoré, art gallery viewings in Saint-Germain, or business engagements.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🛍️</span>
            <div class="highlight-text">
              <h4>Bespoke Shopping Escort</h4>
              <p>Driver holds all luxury shopping bags securely inside the vehicle trunk between stops.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">⏳</span>
            <div class="highlight-text">
              <h4>Continuous Doorstep Standby</h4>
              <p>Vehicle parked right outside your venue ready to depart the exact second you exit.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🗺️</span>
            <div class="highlight-text">
              <h4>Custom Flexible Route</h4>
              <p>Unlimited itinerary adjustments anywhere across Paris intra-muros.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">➕</span>
            <div class="highlight-text">
              <h4>Flexible Extension</h4>
              <p>Easily extend your booking on-demand via the Concierge at €110/additional hour.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Mercedes-Benz S-Class or V-Class · Chauffeur at Your Command</div>
      <div>Page <strong>6</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 7: LUMIÈRE SPA COUPLES MASSAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">05 · Wellness &amp; Recovery</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1600&q=85" alt="Couples Spa Massage">
        <div class="service-meta-bar">
          <span class="service-number">Service 05 · Private Spa Suite</span>
          <span class="service-price">€420 / couple · 75 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Lumière Spa — Couples Massage</h2>
        <div class="service-tagline">Dual Botanical Massage Sanctuary in Candlelit Suite</div>
        <div class="service-history-box">
          Escape the lively Parisian streets into our subterranean wellness sanctuary. The Couples Massage is an immersive sensory treatment conducted simultaneously by two senior practitioners using bespoke warm floral and organic essential oils.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🕯️</span>
            <div class="highlight-text">
              <h4>Private Dual Sanctuary</h4>
              <p>Exclusive candlelit spa suite with heated memory-foam treatment beds and ambient sound.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🌿</span>
            <div class="highlight-text">
              <h4>Customized Aromatherapy</h4>
              <p>Selection of rare Damask rose, lavender, and sandalwood organic botanical extracts.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🪨</span>
            <div class="highlight-text">
              <h4>Volcanic Hot Stone Therapy</h4>
              <p>Smooth heated basalt stones applied to relieve travel fatigue and muscular tension.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🍓</span>
            <div class="highlight-text">
              <h4>Post-Treatment Delights</h4>
              <p>Fresh raspberries, Ladurée macarons, and artisanal herbal infusions in the relaxation lounge.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Spa Open Daily 08:00 – 21:00 · In-Suite Treatment Available Upon Request</div>
      <div>Page <strong>7</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 8: SIGNATURE HAMMAM RITUAL -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">06 · Hydrotherapy Purification</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1600&q=85" alt="Signature Hammam Ritual">
        <div class="service-meta-bar">
          <span class="service-number">Service 06 · Thermal Hydrotherapy</span>
          <span class="service-price">€280 / guest · 105 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Lumière Spa — Signature Hammam Ritual</h2>
        <div class="service-tagline">Heated Carrara Marble, Black Soap Exfoliation &amp; Rhassoul Wrap</div>
        <div class="service-history-box">
          Dating back to the 19th-century Parisian passion for grand thermal baths, our Signature Hammam Ritual purifies both body and mind. Step into heated mosaic steam chambers that dissolve stress through ancient hydrotherapy traditions.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🧖</span>
            <div class="highlight-text">
              <h4>Eucalyptus Steam Chamber</h4>
              <p>100% steam mist infused with pure eucalyptus to open pores and enhance respiration.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🧼</span>
            <div class="highlight-text">
              <h4>Traditional Savon Noir Scrub</h4>
              <p>Organic olive oil black soap applied with a fine Kessa silk-linen glove for deep exfoliation.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🏺</span>
            <div class="highlight-text">
              <h4>Atlas Mountain Rhassoul Wrap</h4>
              <p>Mineral-rich warm clay mask infused with orange blossom water for skin nourishment.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🍵</span>
            <div class="highlight-text">
              <h4>Cooling Hydration Ritual</h4>
              <p>Cold plunge shower followed by warm Moroccan mint tea and Medjool dates.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Private Hammam Booking · Robes &amp; Artisanal Bath Amenities Provided</div>
      <div>Page <strong>8</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 9: VIP LOUVRE AFTER-HOURS TOUR -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">07 · Exclusive Cultural Access</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1600&q=85" alt="Louvre Pyramid After Hours">
        <div class="service-meta-bar">
          <span class="service-number">Service 07 · Private Museum Opening</span>
          <span class="service-price">€2,800 private group · 120 min</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">VIP Louvre After-Hours Private Tour</h2>
        <div class="service-tagline">Exclusive Access to the World's Greatest Museum Behind Closed Doors</div>
        <div class="service-history-box">
          Built in 1190 as a medieval fortress and transformed into the Palace of French Kings, the Musée du Louvre houses 35,000 masterworks. This rare VIP privilege grants your party private entrance past 18:00 after the public has vacated, led by a renowned Art Historian curator.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">🖼️</span>
            <div class="highlight-text">
              <h4>Mona Lisa in Solitude</h4>
              <p>Stand inches away from Leonardo da Vinci's masterpiece without crowds or queuing.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🏛️</span>
            <div class="highlight-text">
              <h4>Masterpiece Highlights</h4>
              <p>Private walkthrough of the Winged Victory of Samothrace, Venus de Milo, and Raft of the Medusa.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">👑</span>
            <div class="highlight-text">
              <h4>Napoleon III State Apartments</h4>
              <p>Access the opulent gilded salons and crystal chandeliers of the Second Empire.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🎩</span>
            <div class="highlight-text">
              <h4>Private Curator Escort</h4>
              <p>Personalized narrative tailored to your personal interests, historical era, or artists.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Includes Private Chauffeur from Hotel · Available Wednesdays &amp; Fridays</div>
      <div>Page <strong>9</strong> of 10</div>
    </div>
  </div>

  <!-- PAGE 10: VERSAILLES PRIVATE DAY TRIP -->
  <div class="page">
    <div class="page-header">
      <div class="header-brand">Hôtel Lumière Paris</div>
      <div class="header-category">08 · Royal Heritage Excursion</div>
    </div>
    <div class="page-body">
      <div class="service-hero-image">
        <img src="https://images.unsplash.com/photo-1599619351208-3e6c839d6828?auto=format&fit=crop&w=1600&q=85" alt="Château de Versailles Hall of Mirrors">
        <div class="service-meta-bar">
          <span class="service-number">Service 08 · Full-Day Excursion</span>
          <span class="service-price">€950 private group · 8 Hours</span>
        </div>
      </div>
      <div class="service-details">
        <h2 class="service-title">Versailles Private Day Trip &amp; Royal Gardens</h2>
        <div class="service-tagline">Skip-The-Line Grand State Apartments, Hall of Mirrors &amp; Trianon</div>
        <div class="service-history-box">
          Constructed in 1661 by King Louis XIV — the Sun King — the Château de Versailles was the radiant epicenter of European monarchy and royal intrigue. Travel in our private luxury vehicle for a comprehensive 8-hour curated royal exploration.
        </div>
        <div class="service-highlights-title">✨ What You Will Experience</div>
        <div class="service-highlights-grid">
          <div class="highlight-item">
            <span class="highlight-icon">✨</span>
            <div class="highlight-text">
              <h4>The Hall of Mirrors (Galerie des Glaces)</h4>
              <p>Explore the 357 mirrors reflecting the Grand Canal and the King's ceremonial bedroom.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🌳</span>
            <div class="highlight-text">
              <h4>Fountain Gardens &amp; Grand Canal</h4>
              <p>Stroll André Le Nôtre’s classical gardens with musical fountain displays and private golf cart.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🏰</span>
            <div class="highlight-text">
              <h4>The Trianon Palaces &amp; Hameau</h4>
              <p>Visit the Grand Trianon and Queen Marie Antoinette’s picturesque rustic Hamlet retreat.</p>
            </div>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">🚘</span>
            <div class="highlight-text">
              <h4>Full Luxury Transit &amp; Lunch</h4>
              <p>Dedicated chauffeur for 8 hours, VIP line-skip tickets, and reserved table at Ore by Alain Ducasse.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="page-footer">
      <div>Departure from Hotel Lobby at 09:00 · Return at 17:00</div>
      <div>Page <strong>10</strong> of 10</div>
    </div>
  </div>

</body>
</html>
`;

import { execFileSync } from 'node:child_process';

async function generatePdf() {
  console.log('Writing temporary brochure HTML template...');
  fs.writeFileSync(htmlTempPath, htmlContent, 'utf8');

  console.log('Rendering high-resolution PDF via headless browser...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserBinary = fs.existsSync(chromePath) ? chromePath : edgePath;

  execFileSync(browserBinary, [
    '--headless',
    '--disable-gpu',
    `--print-to-pdf=${outputPdfPath}`,
    '--no-pdf-header-footer',
    htmlTempPath,
  ], { stdio: 'inherit' });

  if (fs.existsSync(outputPdfPath)) {
    console.log(`✨ Successfully generated: ${outputPdfPath} (${(fs.statSync(outputPdfPath).size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Also copy to assets/brochures
    fs.mkdirSync(path.dirname(assetPdfPath), { recursive: true });
    fs.copyFileSync(outputPdfPath, assetPdfPath);
    console.log(`✨ Copied to: ${assetPdfPath}`);

    // Remove temp file
    if (fs.existsSync(htmlTempPath)) fs.unlinkSync(htmlTempPath);
  } else {
    throw new Error('PDF output file was not generated.');
  }
}

generatePdf().catch((err) => {
  console.error('Failed to generate PDF:', err);
  process.exit(1);
});
