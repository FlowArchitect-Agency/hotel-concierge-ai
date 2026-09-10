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

  /* Tested with matches() on the node itself, never closest(): several of the
     wrappers this file targets carry .reveal, and an ancestor test would skip
     everything inside them. */
  var ALREADY = '.reveal';

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
    up:    function (k) { return 'perspective(1100px) translate3d(0,' + (52 * k * amp) + 'px,' + (-160 * k * amp) + 'px) rotateX(' + (7 * k) + 'deg)'; },
    down:  function (k) { return 'perspective(1100px) translate3d(0,' + (-44 * k * amp) + 'px,' + (-120 * k * amp) + 'px) rotateX(' + (-7 * k) + 'deg)'; },
    left:  function (k) { return 'perspective(1100px) translate3d(' + (-78 * k * amp) + 'px,' + (14 * k * amp) + 'px,' + (-200 * k * amp) + 'px) rotateY(' + (11 * k) + 'deg)'; },
    right: function (k) { return 'perspective(1100px) translate3d(' + (78 * k * amp) + 'px,' + (14 * k * amp) + 'px,' + (-200 * k * amp) + 'px) rotateY(' + (-11 * k) + 'deg)'; },
    'in':  function (k) { return 'perspective(1100px) translate3d(0,' + (22 * k * amp) + 'px,' + (-460 * k * amp) + 'px) rotateX(' + (3 * k) + 'deg)'; }
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
    if (el.closest(SKIP) || el.matches(ALREADY)) return false;
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

  if (!items.length) return;

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
      /* Settled: drop the transform rather than leave an identity one behind,
         so the element stops being a containing block and its compositor layer
         can be released. */
      el.style.transform = '';
      el.style.opacity = '';
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
  function tick() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      try {
        var n = items.length, ps = new Array(n), i;
        atEnd = (window.pageYOffset + window.innerHeight) >= (root.scrollHeight - 2);
        for (i = 0; i < n; i++) ps[i] = ease(progress(items[i]));  /* read  */
        for (i = 0; i < n; i++) paint(items[i], ps[i]);            /* write */
      } catch (err) { surrender(err); }
    });
  }

  /* A tab that stops rendering stops painting, and whatever state the elements
     were left in persists. Coming back has to re-derive it. */
  addEventListener('visibilitychange', tick);
  addEventListener('pageshow', tick);
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', function () { measure(); tick(); });
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
