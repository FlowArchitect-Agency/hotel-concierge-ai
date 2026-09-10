/* motion.js — the page's content is moved BY the scroll, not triggered by it.
 *
 * Every tagged element has its own window of scroll, roughly half a viewport
 * long, and its transform is a direct function of where the reader is inside
 * that window. Stop scrolling and it stops. Scroll back and it goes back. The
 * reader is moving the parts, which is the point: a triggered animation plays
 * at its own speed and reads as something the page is doing TO you.
 *
 * Movement is dimensional rather than flat. Elements arrive out of depth, some
 * hinging on an axis, some coming forward from far behind the screen. The
 * perspective lives inside each element's own transform rather than on a
 * parent, so no ancestor's containing block or stacking context is disturbed.
 *
 * Tagging is done here rather than in the markup: several hundred elements
 * would otherwise need presentational attributes threaded through the content,
 * and the direction each one takes is a function of where it sits, which the
 * markup does not know.
 *
 * Deliberately NOT touched:
 *   - #hero-scene and #handoff-monument. Both contain a position:sticky pin,
 *     and a transformed ancestor becomes that pin's containing block, which
 *     silently stops it sticking. Both already animate on their own terms.
 *   - The fixed navigation and the modal dialogs, which have their own states.
 *   - The live conversation threads. script.js appends messages to those after
 *     load, and a child arriving after tagging would never be revealed.
 *   - Nodes already driven by the older `.reveal` system, which still runs.
 */
(function () {
  var root = document.documentElement;

  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var SKIP = '#hero-scene, #handoff-monument, #navbar, .site-nav, .chat-widget,'
           + '.hotel-collection-modal, [role="dialog"], .conversation-thread,'
           + '.night-thread, .prearrival-thread';

  /* The older `.reveal` system is no longer deferred to. Three of the biggest
     panels on the page carry that class -- the demo shell, the control panel
     and the implementation track -- and style.css neutralises `.reveal` inside
     the operating layer, implementation, control and final-cta sections, so
     those panels had no animation whatsoever. Since this file writes transform
     and opacity inline, it wins over `.reveal`'s stylesheet rule wherever both
     apply, and script.js adding `.revealed` on top is harmless. */

  /* container selector, how its children enter.
     'sides'  outer children hinge in from their own side, the middle one comes
              forward out of the background -- a three column panel then
              assembles in depth instead of sliding.
     'up'     rises and tips upright. Prose stacks keep this: hinging a heading
              and its paragraph in from opposite sides reads as a gimmick.
     'down'   drops from above; for the bars that sit on top of a panel.
     'alt'    peers arrive from alternating directions, chosen from how they are
              actually laid out -- a vertical list weaves left and right, a
              horizontal row alternates between rising and coming forward. */
  /* The big panels -- the app mocks and tables -- get the tilt of their own,
     rather than inheriting whatever their container's rule was. These are the
     objects heavy enough for a turn to read on. */
  var PANELS = ['.hero-product .product-app', '.prearrival-app', '.night-demo',
                '.handoff-guest-view', '.reception-desk', '.chat-wrapper',
                '.control-panel', '.implementation-track'];

  var RULES = [
    ['.hero-product .product-app-header', 'down'],
    ['.hero-product .product-app-body',   'sides'],
    ['.journey-intro-inner',              'up'],
    ['.journey-strip',                    'alt'],
    ['.chapter-narrative',                'up'],
    ['.chapter-guest-context',            'up'],
    ['.prearrival-app-body',              'sides'],
    ['.prearrival-signals',               'alt'],
    ['.night-intro',                      'up'],
    ['.night-workspace',                  'sides'],
    ['.night-log ol',                     'alt'],
    ['.night-demo-summary dl',            'alt'],
    ['.handoff-intro',                    'up'],
    ['.handoff-composition',              'sides'],
    ['.handoff-signals',                  'alt'],
    ['.reception-brief',                  'alt'],
    ['.demo-v2-intro',                    'up'],
    ['.operating-surface',                'sides'],
    ['.implementation-track',             'alt'],
    ['.control-intro',                    'up'],
    ['.control-panel',                    'alt'],
    ['.final-cta-layout',                 'up'],
    ['footer .footer-container',          'up']
  ];

  /* How much viewport each element's move is spread across.
     ENTER is above 1, so an element starts moving just BEFORE it appears and is
     already part way in when it first crosses the bottom edge. SETTLE sits low
     on the screen on purpose: settling it half way up meant everything in the
     lower half of the viewport was mid-fade at all times, so reading down the
     page you met text that was not there yet. Now anything above the bottom
     third is fully arrived. */
  var ENTER  = 1.06;   /* progress 0 while the element's top is this far down */
  var SETTLE = 0.55;   /* progress 1 once that edge has risen to here */
  var LAG    = 0.055;  /* each later sibling's window opens this much later */

  /* Opacity finishes well before the movement does. Legibility and motion are
     different jobs: the words should be readable almost immediately, and then
     keep travelling into place while you scroll. Tying them together is what
     makes scroll animation feel like content withheld rather than content
     arriving. */
  var FADE = 2.6;

  /* Travel is scaled to the viewport. A fixed sideways offset that reads well on
     a desktop is most of a phone's width, and since body carries
     overflow-x: hidden the excess is clipped rather than scrolled -- so the
     element appears to be sliced off at the edge instead of flying in. Angles
     are left alone; a hinge looks the same at any size. */
  var amp = 1;
  function measure() {
    amp = Math.max(0.42, Math.min(1, (root.clientWidth || 1440) / 1440));
  }

  /* The shapes. k counts DOWN from 1 (far off) to 0 (in place), so every term
     below is simply how much of the arrival is still left to undo. */
  var SHAPE = {
    /* Amplitudes are deliberately large. Subtle is invisible: at 50px and 7
       degrees these read as a faint settling rather than as movement, which is
       the complaint. A panel should visibly arrive.

       The side shapes carry a roll (rotateZ) on top of the hinge (rotateY), so
       a table comes in tilted and straightens as it lands, the way the discs on
       palmo.co.in turn as they settle. */
    up:    function (k) { return 'perspective(1200px) translate3d(0,' + (96 * k * amp) + 'px,' + (-220 * k * amp) + 'px) rotateX(' + (10 * k) + 'deg)'; },
    down:  function (k) { return 'perspective(1200px) translate3d(0,' + (-78 * k * amp) + 'px,' + (-180 * k * amp) + 'px) rotateX(' + (-10 * k) + 'deg)'; },
    left:  function (k) { return 'perspective(1200px) translate3d(' + (-150 * k * amp) + 'px,' + (26 * k * amp) + 'px,' + (-280 * k * amp) + 'px) rotateY(' + (17 * k) + 'deg) rotateZ(' + (-3 * k) + 'deg)'; },
    right: function (k) { return 'perspective(1200px) translate3d(' + (150 * k * amp) + 'px,' + (26 * k * amp) + 'px,' + (-280 * k * amp) + 'px) rotateY(' + (-17 * k) + 'deg) rotateZ(' + (3 * k) + 'deg)'; },
    'in':  function (k) { return 'perspective(1200px) translate3d(0,' + (34 * k * amp) + 'px,' + (-620 * k * amp) + 'px) rotateX(' + (5 * k) + 'deg)'; },
    /* palmo.co.in: arrives clearly off-axis and turns upright as it lands */
    tilt:  function (k) { return 'perspective(1200px) translate3d(' + (60 * k * amp) + 'px,' + (110 * k * amp) + 'px,' + (-340 * k * amp) + 'px) rotateZ(' + (5.5 * k) + 'deg) rotateX(' + (8 * k) + 'deg)'; }
  };

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /* Barely eased. A strong ease-out spends most of the movement in the first
     part of the window, so by the time the element is legible it has almost
     stopped -- which reads as text popping in rather than travelling. This is
     close to linear, so the distance moved stays proportional to the distance
     scrolled, with just enough curve to land softly. */
  function ease(t) { return 1 - Math.pow(1 - t, 1.4); }

  function tag(el, dir, order) {
    if (!el || el.hasAttribute('data-motion')) return false;
    if (el.closest(SKIP)) return false;
    el.setAttribute('data-motion', dir);
    el._motion = { shape: SHAPE[dir] || SHAPE.up, order: order };
    return true;
  }

  var items = [];
  RULES.forEach(function (rule) {
    document.querySelectorAll(rule[0]).forEach(function (container) {
      if (container.closest(SKIP)) return;
      var kids = Array.prototype.filter.call(container.children, function (k) {
        return k.offsetParent !== null || k.getClientRects().length;
      });
      /* Side by side, or stacked? Two children sharing a top edge decides it,
         and that decides which way 'alt' weaves. */
      var isRow = kids.length > 1 &&
        Math.abs(kids[1].getBoundingClientRect().top - kids[0].getBoundingClientRect().top) < 8;

      kids.forEach(function (kid, i) {
        var dir = rule[1];
        if (dir === 'sides') {
          dir = kids.length < 2 ? 'up'
              : i === 0 ? 'left'
              : i === kids.length - 1 ? 'right'
              : 'in';
        } else if (dir === 'alt') {
          dir = kids.length < 2 ? 'up'
              : isRow ? (i % 2 ? 'in' : 'up')
              : (i % 2 ? 'right' : 'left');
        }
        if (tag(kid, dir, i)) items.push(kid);
      });
    });
  });

  /* Panels are tagged after the container rules so they keep their own tilt if a
     rule has not already claimed them. */
  PANELS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      if (tag(el, 'tilt', 0)) items.push(el);
    });
  });

  if (!items.length) return;

  var DECK = ['#platform', '#chapter-prearrival', '#night-operations',
              '#human-handoff', '#demo', '#operating-layer', '#implementation',
              '#control', '#discovery']
    .map(function (sel) { return document.querySelector(sel); })
    .filter(Boolean);

  /* A sticky section pinned at top:0 that is TALLER than the viewport can never
     show its lower half. It locks the moment its top reaches the top of the
     screen and then stops moving, so everything below the fold is unreachable --
     the chat composer, the rest of the night operations table, the foot of the
     handoff. Pinning it by however much it overflows instead lets it scroll all
     the way through and only lock once its bottom has arrived, so the whole
     section is read before the next one covers it. */
  function fitDeck() {
    var vh = window.innerHeight;
    for (var i = 0; i < DECK.length; i++) {
      DECK[i].style.top = Math.min(0, vh - DECK[i].offsetHeight) + 'px';
    }
  }

  function deckRead(vh) {
    var y = window.pageYOffset, out = [];
    for (var i = 0; i < DECK.length - 1; i++) {
      /* How far the NEXT section has climbed the screen: 0 while it is still
         below the fold, 1 once it has reached the top and fully covered.

         Measured from offsetTop, NOT getBoundingClientRect(). The next section
         is sticky too, so once it has arrived its rect.top reads 0 forever --
         which made every section read as fully covered from the moment it
         appeared, and left the whole deck permanently shrunk and dimmed.
         offsetTop is layout position and ignores the sticky offset. */
      out.push(clamp(1 - (DECK[i + 1].offsetTop - y) / (vh || 1)));
    }
    return out;
  }

  function deckWrite(ps) {
    for (var i = 0; i < ps.length; i++) {
      var p = ease(ps[i]);
      DECK[i].style.transform = p > 0.001 ? 'scale(' + (1 - 0.055 * p) + ')' : '';
      DECK[i].style.filter = p > 0.001 ? 'brightness(' + (1 - 0.22 * p) + ')' : '';
    }
  }

  /* Everything below hides content and then relies on this script to bring it
     back. If any of it throws, the page is left blank rather than merely
     un-animated, so the whole run is guarded and gives the content back on
     failure. Motion is a nicety; the words are the product. */
  function surrender(err) {
    root.classList.remove('motion-on');
    items.forEach(function (el) {
      el.style.transform = '';
      el.style.opacity = '';
    });
    DECK.forEach(function (sec) { sec.style.transform = ''; sec.style.filter = ''; });
    if (err) console.error('motion.js stood down; content restored.', err);
  }

  function progress(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || root.clientHeight;
    /* Later siblings lag behind, so the window is pulled UP the viewport, not
       down: a larger `from` would mean the element starts sooner, which
       reverses the stagger. */
    var lag = el._motion.order * LAG;
    var from = vh * (ENTER - lag);
    var to   = vh * (SETTLE - lag);
    /* At the very foot of the document there is no scroll left to finish with,
       so anything still travelling would be stranded part way. */
    if (atEnd) return 1;
    return clamp((from - r.top) / (from - to || 1));
  }

  function paint(el, p) {
    if (p >= 0.999) {
      /* Drop the transform rather than leave an identity one behind, so the
         element stops being a containing block and its layer can be released.

         The opacity must be written explicitly, NOT cleared. The stylesheet's
         resting state for [data-motion] under .motion-on is opacity 0 -- it is
         what holds content back before the first frame -- so clearing the
         inline value hands the element straight back to that rule and it
         vanishes. Which is precisely what it did: every element disappeared at
         the exact moment it finished arriving. */
      el.style.transform = '';
      el.style.opacity = '1';
      return;
    }
    el.style.transform = el._motion.shape(1 - p);
    el.style.opacity = clamp(p * FADE);
  }

  /* Every element is recomputed on every frame, and its state is derived purely
     from its own position. There is deliberately no IntersectionObserver here.
     Using one to decide what is visible makes correctness depend on an event:
     an element was hidden by a "left the area" callback, and if the matching
     "entered the area" callback was late, coalesced or missed -- which happens
     whenever the tab is not rendering, and on fast jumps -- it stayed hidden
     with nothing to correct it. That is what left whole panels blank mid-page.

     Seventy-odd rects in a batched read pass costs almost nothing, and buys a
     system with no memory: whatever the scroll position, the page is right. */
  var atEnd = false;
  var queued = false;
  var lastPaint = 0;
  function tick() {
    /* Frames can stop arriving while scroll events keep coming -- a throttled
       tab, a starved main thread. Content is hidden until a frame paints it, so
       if the gap gets long enough to notice, give it all back rather than let
       the reader scroll through blank space. */
    /* Only when the document is actually visible. A hidden tab is not starved,
       it is simply not being drawn, and treating that as failure would stand
       the whole system down for good the first time the reader switched tabs. */
    if (!document.hidden && lastPaint && Date.now() - lastPaint > 1200 &&
        root.classList.contains('motion-on')) { surrender(); return; }
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      lastPaint = Date.now();
      try {
        var n = items.length, ps = new Array(n), i;
        atEnd = (window.pageYOffset + window.innerHeight) >= (root.scrollHeight - 2);
        var deck = deckRead(window.innerHeight);                   /* read  */
        for (i = 0; i < n; i++) ps[i] = ease(progress(items[i]));  /* read  */
        deckWrite(deck);                                           /* write */
        for (i = 0; i < n; i++) paint(items[i], ps[i]);            /* write */
      } catch (err) { surrender(err); }
    });
  }

  /* A tab that stops rendering stops painting, and whatever state the elements
     were left in persists. Coming back has to re-derive it. */
  /* ── The deck ──────────────────────────────────────────────────────────
     The stacked sections cover one another. A cover with no depth to it reads
     as a flat swap, so as the next section rises the one being covered is
     pushed back and dimmed: it recedes rather than simply being hidden. Driven
     by the same scroll, in the same read/write passes, so it scrubs with the
     hand like everything else. */
  /* Coming back to a tab that was not being drawn: the clock restarts, or the
     gap since the last paint would look like starvation. */
  addEventListener('visibilitychange', function () { lastPaint = Date.now(); tick(); });
  addEventListener('pageshow', tick);
  addEventListener('load', function () { fitDeck(); tick(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { fitDeck(); tick(); });
  }
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', function () { measure(); fitDeck(); tick(); });
  /* Nothing is hidden until we have proved we can paint.
     `motion-on` is what hides the content, and the only thing that brings it
     back is a rendering frame. Hiding first and painting second means that if
     frames never arrive -- a tab that is never rendered, a browser throttling
     rAF to nothing, a machine under load -- the page stays permanently blank.
     Claiming the class from inside the first frame inverts that: the worst case
     becomes a page with no animation, which is still a page that reads. */
  requestAnimationFrame(function () {
    try {
      root.classList.add('motion-on');
      measure();
      fitDeck();
      var ps0 = items.map(function (el) { return ease(progress(el)); });
      items.forEach(function (el, i) { paint(el, ps0[i]); });
    } catch (err) { surrender(err); }
  });

  /* Last line of defence. If nothing has been painted a moment after load --
     an observer that never fired, a frame that never ran -- give the content
     back rather than leave a page of blank space. */
  setTimeout(function () {
    var stuck = items.filter(function (el) {
      var r = el.getBoundingClientRect();
      var onScreen = r.top < window.innerHeight * 0.75 && r.bottom > 0;
      return onScreen && parseFloat(getComputedStyle(el).opacity) < 0.05;
    });
    if (stuck.length) surrender();
  }, 2500);
})();
