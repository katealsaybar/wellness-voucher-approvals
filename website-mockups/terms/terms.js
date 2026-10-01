  /* No section[id] on this page, so the anchor prefix keeps these notes distinct from the
     terms list inside the approval pack, which pins under "terms__". */
  window.TRS_ANCHOR_PREFIX = 'termsmock';
  /* every clause is its own note target, and so are the two options inside term 10, since
     that clause is the one Tara has to choose between */
  window.TRS_PIN_TARGETS = [
    { sel: 'ol.terms > li', into: null, labelSel: 'strong.th', float: true },
    { sel: '.site .opt',    into: null, labelSel: '.ol',       float: true }
  ];

  (function () {
    var body = document.body;
    var ad = document.getElementById('btn-ad');
    var dxb = document.getElementById('btn-dxb');
    var diff = document.getElementById('btn-diff');
    if (!ad || !dxb || !diff) return; // switch removed 1 Oct 2026: one UAE page now

    function show(v) {
      body.classList.toggle('v-ad', v === 'ad');
      body.classList.toggle('v-dxb', v === 'dxb');
      ad.classList.toggle('on', v === 'ad');
      dxb.classList.toggle('on', v === 'dxb');
    }
    ad.addEventListener('click', function () { show('ad'); });
    dxb.addEventListener('click', function () { show('dxb'); });

    diff.addEventListener('click', function () {
      var on = body.classList.toggle('diff');
      diff.classList.toggle('on', on);
      diff.textContent = on ? 'Hide what changed' : 'Show what changed';
    });
  })();
