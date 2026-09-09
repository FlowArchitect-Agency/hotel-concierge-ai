/* motion.js — gives the page's own content an entrance as it is scrolled to.
 *
 * Tagging is done here rather than in the markup: there are several hundred
 * elements involved and hand-tagging them would be unmaintainable and would
 * bury the content in presentational attributes. A short rule table names the
 * containers whose children should enter, and how.
 *
 * Deliberately NOT touched:
 *   - #hero-scene and #handoff-monument. Both contain a position:sticky pin,
 *     and a transformed ancestor becomes the pin's containing block, which
 *     silently stops it sticking. Their copy already animates on its own.
 *   - The fixed navigation and the modal dialogs, which have their own states.
 *   - The live conversation threads. script.js appends messages to those while
 *     the page is open; a child that arrives after the observer has run would
 *     never be revealed, so it would appear blank.
 *
 * The existing `.reveal` system in script.js is left alone and still runs.
 */
(function () {
  var root = document.documentElement;

  /* No JS-driven motion under reduced motion, and none without an observer --
     in both cases motion.css does nothing and the page renders at rest. */
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* Regions this never enters, for the reasons in the header comment. */
  var SKIP = '#hero-scene, #handoff-monument, #navbar, .site-nav, .chat-widget,'
           + '.hotel-collection-modal, [role="dialog"], .conversation-thread,'
           + '.night-thread, .prearrival-thread';

  /* A node already driven by the older `.reveal` system is not given a second
     animation of its own -- but its CHILDREN still are. This has to be tested
     with matches() on the node itself, not closest(): several of the wrappers
     this file targets carry .reveal, and an ancestor test skipped everything
     inside them, leaving the demo, the operating layer, implementation and the
     closing call with nothing moving at all. */
  var ALREADY = '.reveal';

  /* container selector, how its children enter.
     'sides'  outer children come from their own side, the middle lifts --
              this is what makes a multi column panel read as assembling.
     'up'     everything lifts, staggered in document order. Prose stacks keep
              this: alternating sides through a heading and its paragraph reads
              as a gimmick rather than as the page arriving.
     'down'   arrives from above; used for the bars that sit on top of a panel.
     'alt'    lists of peers come from alternating directions, chosen from how
              they are actually laid out: a vertical list weaves in from left
              and right, a horizontal row alternates up and down so the items
              never cross each other on the way in. */
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

  var STEP = 90;          /* ms between siblings */
  var MAX_STAGGER = 6;    /* beyond this a group reads as a queue, not a group */

  function tag(el, dir, index) {
    if (!el || el.hasAttribute('data-motion')) return;
    if (el.closest(SKIP) || el.matches(ALREADY)) return;
    el.setAttribute('data-motion', dir);
    if (index) el.style.setProperty('--motion-delay', Math.min(index, MAX_STAGGER) * STEP + 'ms');
  }

  var tagged = [];
  RULES.forEach(function (rule) {
    document.querySelectorAll(rule[0]).forEach(function (container) {
      if (container.closest(SKIP)) return;
      var kids = Array.prototype.filter.call(container.children, function (k) {
        /* an empty spacer has nothing to animate and would only add delay */
        return k.offsetParent !== null || k.getClientRects().length;
      });
      /* Laid out side by side, or stacked? Two children sharing a top edge is
         enough to tell, and it decides which way 'alt' weaves. */
      var isRow = kids.length > 1 &&
        Math.abs(kids[1].getBoundingClientRect().top - kids[0].getBoundingClientRect().top) < 8;

      kids.forEach(function (kid, i) {
        var dir = rule[1];
        if (dir === 'sides') {
          dir = kids.length < 2 ? 'up'
              : i === 0 ? 'left'
              : i === kids.length - 1 ? 'right'
              : 'up';
        } else if (dir === 'alt') {
          dir = kids.length < 2 ? 'up'
              : isRow ? (i % 2 ? 'down' : 'up')
              : (i % 2 ? 'right' : 'left');
        }
        tag(kid, dir, i);
        if (kid.hasAttribute('data-motion')) tagged.push(kid);
      });
    });
  });

  if (!tagged.length) return;
  root.classList.add('motion-on');

  /* One shot: once a thing has arrived it stays arrived. Re-hiding content on
     the way back up makes a page feel unstable to read. */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-shown');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -8% 0px' });

  tagged.forEach(function (el) { io.observe(el); });

  /* Anything already on screen at load should not wait to be scrolled to. */
  requestAnimationFrame(function () {
    tagged.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) { el.classList.add('is-shown'); io.unobserve(el); }
    });
  });
})();
