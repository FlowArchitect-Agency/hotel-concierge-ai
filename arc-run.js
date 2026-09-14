/* arc-run.js -- slowed runs: the hero preview and the Arc de Triomphe run.

   The glass slides of the run (night operations through control) used to move
   one pixel per pixel of scroll, so the monument run was over in a few flicks.
   Here the whole run sits in a pinned window and its content is moved by
   script at 1/SLOWDOWN of the scroll: the page is made that much taller, and
   each slide takes that much more scrolling to come and go. The Arc behind it
   reads positions from the same moving slides, so it turns slower too.

   Without script, or with reduced motion, none of this applies: the wrapper is
   inert and the sections scroll normally. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var runs = document.querySelectorAll('.arc-run');
  for (var i = 0; i < runs.length; i++) slow(runs[i]);

function slow(run) {
  var SLOWDOWN = parseFloat(run.getAttribute('data-slowdown')) || 3;
  /* A run barely taller than the screen has almost nothing to slow, so it can
     also ask to be held: at least HOLD screens of scroll while it is pinned. */
  var HOLD = parseFloat(run.getAttribute('data-hold')) || 0;
  /* Pin below the fixed navigation rather than under it. */
  var UNDER_NAV = run.hasAttribute('data-under-nav');
  var pin = run.querySelector('.arc-run-pin');
  var track = run.querySelector('.arc-run-track');
  if (!pin || !track) return;

  run.classList.add('is-slow');

  var natural = 0;      // the run's own height, unslowed
  var viewH = 0;        // the pinned window's height
  var offsetTop = 0;    // where the window pins, from the top of the screen
  var lastW = 0;

  function travel() { return Math.max(0, natural - viewH); }
  function span() { return Math.max(travel() * SLOWDOWN, HOLD * viewH); }

  function update() {
    /* Content that grows after the first measure (fonts, the demo chat, a
       reveal) would leave the last slide stranded short of the end. */
    if (track.scrollHeight !== natural) { measure(); return; }
    var r = run.getBoundingClientRect();
    var total = span();
    var s = Math.min(Math.max(offsetTop - r.top, 0), total);
    var moved = total > 0 ? travel() * (s / total) : 0;
    track.style.transform = 'translate3d(0,' + (-moved).toFixed(2) + 'px,0)';
    run.style.setProperty('--run-progress', total > 0 ? (s / total).toFixed(4) : '0');
  }

  function measure() {
    var screenH = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!screenH) return;
    var nav = UNDER_NAV && document.querySelector('.site-nav, #navbar');
    offsetTop = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
    viewH = screenH - offsetTop;
    natural = track.scrollHeight;
    pin.style.top = offsetTop + 'px';
    pin.style.height = viewH + 'px';
    run.style.height = (span() + viewH) + 'px';
    update();
  }

  /* Where an element inside the run ends up once the slowdown is applied. */
  function scrollTopFor(el) {
    var offset = el.getBoundingClientRect().top - track.getBoundingClientRect().top;
    var runTop = run.getBoundingClientRect().top + window.pageYOffset;
    var nav = document.querySelector('.site-nav, #navbar');
    var navH = nav ? nav.getBoundingClientRect().height : 0;
    var t = travel();
    return runTop - offsetTop + (t > 0 ? Math.min(Math.max(0, offset - navH), t) / t * span() : 0);
  }

  function goTo(id, smooth) {
    var el = id && document.getElementById(id);
    if (!el || !track.contains(el)) return false;
    window.scrollTo({ top: scrollTopFor(el), behavior: smooth ? 'smooth' : 'instant' });
    return true;
  }

  /* In-page links into the run would otherwise land at the element's unslowed
     position, which is somewhere else entirely now. */
  document.addEventListener('click', function (event) {
    var a = event.target.closest && event.target.closest('a[href^="#"]');
    if (!a) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (goTo(id, true)) {
      event.preventDefault();
      if (history.replaceState) history.replaceState(null, '', '#' + id);
    }
  });

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', function () {
    var w = window.innerWidth;
    /* A phone keyboard opening shrinks only the height. Re-measuring then
       would change the page length under the reader mid-typing in the demo. */
    var typing = track.contains(document.activeElement) && w === lastW;
    lastW = w;
    if (!typing) measure();
  });
  if (window.ResizeObserver) new ResizeObserver(function () { measure(); }).observe(track);

  lastW = window.innerWidth;
  measure();
  window.addEventListener('load', function () {
    measure();
    if (!location.hash) return;
    var id = decodeURIComponent(location.hash.slice(1));
    if (!goTo(id, false)) return;
    /* The 3D sections above still settle their heights for a moment after
       load, which moves the run. Re-aim twice, unless the reader has already
       taken over the scroll. */
    var touched = false;
    var stop = function () { touched = true; };
    ['wheel', 'touchstart', 'keydown'].forEach(function (type) {
      window.addEventListener(type, stop, { once: true, passive: true });
    });
    [500, 1400].forEach(function (ms) {
      setTimeout(function () { if (!touched) { measure(); goTo(id, false); } }, ms);
    });
  });
}
})();
