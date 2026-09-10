// Wellness Voucher Approval Pack: the front door and the decision queue.
//
// WHY THIS EXISTS. The pack is a long document with thirteen open decisions buried in a
// section near the bottom. That is fine for someone auditing it and wrong for the two
// people who actually have to sign it off: one who stalls when there is no visible finish
// line, and one whose answer to most things is "yes, but change this". So the pack now
// opens on a fork:
//
//   Just my decisions  -> one card at a time, three buttons, resume where you left off
//   Show me everything -> the pack exactly as it was, sidebar and all
//
// Same data behind both doors. Everything either door produces lands in approval_notes,
// so Kate has one inbox regardless of how it was written.
//
// WHY THREE BUTTONS AND NOT A SWIPE. A swipe holds two answers. The real answers are yes,
// no, "yes but change this", and "ask Emma first", and the third is both the most common
// and the only one that creates work. Forced into a binary it collapses into "later",
// which is where a review goes to die. The swipe gesture is still here, but as a shortcut
// over the buttons, never as the mechanism.
//
// Plain script, not a module, for the same reason as notes-widget.js: the pack gets opened
// off disk as file:// and browsers block cross-origin module imports there. Loaded after
// the Supabase UMD build, which exposes a global `supabase.createClient`.
//
// IDENTITY is the same four-name toggle the notes widget uses, read from and written to
// the same localStorage key, so picking a name in either place is picking it in both.
// It is not authentication and is not pretending to be. See sql/notes_setup.sql.

(function () {
  'use strict';

  var SUPABASE_URL = 'https://vlqvefsaxztitcbhirxt.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JlOzwdcK0xjmE6j3nHmwhg_xDKxq1vv';
  var T_NOTES = 'approval_notes';

  // Keep in sync with REVIEWERS in notes-widget.js and public.is_reviewer_name().
  var REVIEWERS = ['Tara', 'Emma', 'Hanneh', 'Kate', 'LID'];
  var NAME_KEY = 'trs-approval-author';   // shared with notes-widget.js on purpose
  var STATE_KEY = 'trs-decide-v1';

  // Five, not thirteen. Three short rounds give three completions instead of one long
  // slog with a single payoff at the end: the difference between finishing and stalling.
  var ROUND = 5;
  var SWIPE_PX = 92;

  var PACK_ID = document.body.dataset.notePack || 'pack';
  // Splits on the colon in "Wellness Voucher: Approval Pack". Keep this in step with the
  // <title> and with notes-widget.js: a separator that matches nothing does not narrow
  // PACK_TITLE, it silently widens it to the whole string.
  var PACK_TITLE = (document.title.split(':')[0] || document.title).trim();

  // Resolved from this script's own URL rather than the page's, the same way
  // shared/mail-preview.js does it, so the logo survives the file moving folders.
  var ASSETS = (function () {
    var s = document.currentScript ||
            (function () { var t = document.getElementsByTagName('script'); return t[t.length - 1]; })();
    return new URL('../assets/', s.src).href;
  })();

  var db = (window.TRS && window.TRS.db) ||
    (typeof supabase !== 'undefined'
      ? supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        })
      : null);

  // ---------------------------------------------------------------- helpers
  // slugify/truncate/cleanLabel are copied verbatim from notes-widget.js rather than
  // shared, because that file is a closure with no exports. They MUST stay identical: the
  // anchor_id they produce is what makes a card's answer land on the same pin as a note
  // left by hand on the same decision. Change one, change both.
  function slugify(s) {
    return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function truncate(s, max) {
    var c = String(s).replace(/\s+/g, ' ').trim();
    return c.length > max ? c.slice(0, max).trim() + '…' : c;
  }
  function cleanLabel(el) {
    var clone = el.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('.badge, .trs-pin-btn, .num, .tick'), function (n) { n.remove(); });
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild;
  }

  // Same rule as notes-widget.js: a signed-in account is the identity and the four-name
  // toggle is only for the anonymous reviewers. Kept identical on purpose, because the
  // decision queue posts into the same table under the same name.
  function authorName() {
    var s = window.TRS && window.TRS.displayName ? window.TRS.displayName() : '';
    if (s && REVIEWERS.indexOf(s) !== -1) return s;
    var n = window.localStorage.getItem(NAME_KEY);
    return n && REVIEWERS.indexOf(n) !== -1 ? n : '';
  }
  function setAuthorName(n) {
    window.localStorage.setItem(NAME_KEY, n);
    // notes-widget.js reads this key on every post, so no cross-notification is needed.
    // Its own toggle re-reads on render; a reload syncs the button styling either way.
  }

  // ---------------------------------------------------------------- the decisions
  // Read out of the page rather than duplicated into a data file. The section IS the
  // source of truth: a decision edited in index.html is edited in the queue, with no
  // second copy to fall out of step.
  function readDecisions() {
    var sec = document.getElementById('decisions');
    if (!sec) return [];
    var out = [];
    Array.prototype.forEach.call(sec.querySelectorAll('.decision'), function (node, i) {
      if (node.classList.contains('done')) return;      // already resolved, shown for the record
      var qEl = node.querySelector('.q');
      var aEl = node.querySelector('.a');
      if (!qEl) return;
      var label = cleanLabel(qEl);
      var numEl = node.querySelector('.num');

      // Strip the widget's floating pin out of the copy we clone into the card, because it is
      // bound to the node in the page, not to this one, and would do nothing here.
      var body = '';
      if (aEl) {
        var c = aEl.cloneNode(true);
        Array.prototype.forEach.call(c.querySelectorAll('.trs-pin-btn'), function (n) { n.remove(); });
        body = c.innerHTML;
      }

      out.push({
        key: 'decisions__' + (slugify(label).slice(0, 60) || ('item-' + i)),
        label: truncate(label, 120),
        num: numEl ? numEl.textContent.trim() : String(i + 1),
        html: body,
        rec: node.dataset.rec || '',
        owners: (node.dataset.owner || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      });
    });
    return out;
  }

  var ALL = readDecisions();
  if (!ALL.length) return;

  // Whose cards are these? A named owner means Emma opens the pack and sees the one thing
  // that is actually hers rather than thirteen things that are mostly Tara's.
  //
  // Someone who owns nothing yet (Hanneh, until a social decision gets tagged to her)
  // gets an EMPTY queue and the front door tells her so. An earlier version fell back to
  // showing her all thirteen, which is precisely the wall of someone else's decisions this
  // screen exists to prevent.
  //
  // A decision with no data-owner at all belongs to everyone, so forgetting the attribute
  // makes a decision over-visible rather than invisible. That is the safe direction to
  // fail in: an extra card is a nuisance, a decision nobody is ever shown is a launch.
  function queueFor(name) {
    if (!name) return ALL;
    return ALL.filter(function (d) {
      return !d.owners.length || d.owners.indexOf(name) !== -1;
    });
  }

  // ---------------------------------------------------------------- state
  // Keyed per pack AND per name: two people reviewing on the same laptop keep separate
  // progress instead of inheriting each other's.
  function stateKey() { return STATE_KEY + '::' + PACK_ID + '::' + (authorName() || 'anon'); }
  function blankState() { return { answers: {}, pass: 1, since: 0 }; }
  var state = blankState();

  function loadState() {
    try {
      var raw = window.localStorage.getItem(stateKey());
      state = raw ? JSON.parse(raw) : blankState();
      if (!state.answers) state = blankState();
    } catch (e) { state = blankState(); }
  }
  function saveState() {
    try { window.localStorage.setItem(stateKey(), JSON.stringify(state)); } catch (e) { /* private mode */ }
  }

  // Everything not yet answered, plus anything deferred on an EARLIER pass. A card put off
  // in the pass you are in stays put off until you choose to run another pass; otherwise
  // "later" just loops the same card back at you, which is the fastest way to make someone
  // close the tab.
  function pending() {
    return queueFor(authorName()).filter(function (d) {
      var a = state.answers[d.key];
      if (!a) return true;
      return a.v === 'later' && a.pass < state.pass;
    });
  }
  function deferredThisPass() {
    return queueFor(authorName()).filter(function (d) {
      var a = state.answers[d.key];
      return a && a.v === 'later' && a.pass === state.pass;
    });
  }
  // ---------------------------------------------------------------- the score
  // Read from the SERVER, not from localStorage. Progress that only exists in one browser
  // is not progress: Tara answers four on her phone, opens the pack on the laptop and the
  // score has to still say four. localStorage is only used to fill the gap between an
  // answer being given and the fetch that follows it.
  //
  // Everything the queue posts is self-labelling, so the breakdown falls straight out of
  // the note bodies without a second table:
  //   'Approved.'              -> approved
  //   'Change requested: …'    -> revised
  //   anything else            -> a comment left by hand from the notes panel
  // The end-of-session summary row is excluded; it is a receipt, not an answer.
  var REMOTE = null;          // null until the first fetch lands
  var remoteFor = null;       // which name REMOTE describes

  function fetchScore(name, done) {
    if (!db || !name) { done(); return; }
    Promise.all([
      db.from(T_NOTES).select('anchor_id,body,parent_id')
        .eq('pack_id', PACK_ID).eq('author_name', name).eq('archived', false),
      db.from('approval_suggestions').select('id')
        .eq('pack_id', PACK_ID).eq('requester_name', name)
    ]).then(function (res) {
      var notes = res[0], sugg = res[1];
      if (notes.error) { done(); return; }
      var r = { touched: {}, ok: 0, change: 0, comments: 0, suggestions: 0 };
      (notes.data || []).forEach(function (n) {
        if (n.parent_id) return;                                    // replies are not answers
        var b = String(n.body || '');
        if (b.indexOf('Ran the decision queue') === 0) return;      // the session receipt
        if (n.anchor_id) r.touched[n.anchor_id] = true;
        // Matched on the WORDS, never the punctuation after them. These two strings have to
        // agree with the writer in post() further down, and a reformatting pass once swapped
        // the dash for a colon in one of them but not the other, which silently
        // reclassified every revision as a plain comment and made the score wrong with no
        // error anywhere. Anchoring on what will not drift is the fix.
        if (/^Approved\b/.test(b)) r.ok++;
        else if (/^Change requested\b/.test(b)) r.change++;
        else r.comments++;
      });
      r.suggestions = (sugg && !sugg.error && sugg.data) ? sugg.data.length : 0;
      REMOTE = r; remoteFor = name;
      done();
    }, function () { done(); });
  }

  // done / total across the decisions assigned to this person. A decision counts as done
  // if the server has a note from them on it, or this browser has an answer for it that
  // has not been read back yet.
  function score() {
    var name = authorName();
    var mine = queueFor(name);
    var remote = (REMOTE && remoteFor === name) ? REMOTE : null;
    var done = 0;
    mine.forEach(function (d) {
      var a = state.answers[d.key];
      if (a && (a.v === 'ok' || a.v === 'change')) { done++; return; }
      if (remote && remote.touched[d.key]) done++;
    });
    return {
      done: done, total: mine.length, left: mine.length - done,
      ok: remote ? remote.ok : 0,
      change: remote ? remote.change : 0,
      comments: remote ? remote.comments : 0,
      suggestions: remote ? remote.suggestions : 0,
      live: !!remote
    };
  }

  function tally() {
    var q = queueFor(authorName()), t = { ok: 0, change: 0, later: 0, total: q.length };
    q.forEach(function (d) {
      var a = state.answers[d.key];
      if (!a) return;
      if (a.v === 'ok') t.ok++;
      else if (a.v === 'change') t.change++;
      else if (a.v === 'later') t.later++;
    });
    return t;
  }

  // ---------------------------------------------------------------- shell
  var root = el('<div id="trsDecide" role="dialog" aria-modal="true" aria-label="Decisions"></div>');
  document.body.appendChild(root);

  function show() { root.classList.add('on'); document.body.classList.add('dq-locked'); }
  function hide() {
    root.classList.remove('on');
    document.body.classList.remove('dq-locked');
    root.innerHTML = '';
    refreshEntryBtn();
  }

  // ---------------------------------------------------------------- fork
  function renderFork() {
    loadState();
    var name = authorName();
    var n = name ? pending().length : ALL.length;
    var mins = Math.max(2, Math.round(n * 1.5));

    root.innerHTML =
      '<div class="dq-fork"><div class="dq-fork-in">' +
        // The rule above the wordmark is clipped off the PNG and redrawn by .dq-logowrap::before
        // in the reader's colour. See decide.css.
        '<span class="dq-logowrap"><img class="dq-logo" src="' + ASSETS + 'tara-rose-logo-white.png" alt="Tara Rose Salon"></span>' +
        '<div class="dq-kicker">Wellness Voucher</div>' +
        '<h2 id="dqForkH"></h2>' +
        '<p class="dq-fork-sub" id="dqForkSub"></p>' +

        '<div class="dq-who">' +
          '<div class="dq-who-lbl">First: who is reading?</div>' +
          '<div class="dq-names" id="dqNames">' +
            REVIEWERS.map(function (r) {
              return '<button type="button" data-n="' + r + '"' + (r === name ? ' class="sel"' : '') + '>' + r + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="dq-doors">' +
          '<button type="button" class="dq-door primary" id="dqGo"' + (name ? '' : ' disabled') + '>' +
            '<div class="dq-door-t"><span id="dqGoT">Just my decisions</span><span class="dq-arrow">&rarr;</span></div>' +
            '<div class="dq-door-d" id="dqGoD">One at a time. Approve it, ask for a change, or put it off.</div>' +
          '</button>' +
          '<button type="button" class="dq-door" id="dqAll">' +
            '<div class="dq-door-t"><span>Show me everything</span><span class="dq-arrow">&rarr;</span></div>' +
            '<div class="dq-door-d">The full pack: every section, the mockups, the calendar. Leave notes anywhere.</div>' +
          '</button>' +
        '</div>' +

        '<div class="dq-fork-foot" id="dqFoot"></div>' +
      '</div></div>';

    function paint() {
      var nm = authorName();
      // Drives --who-active, which recolours the rule above the logo, the "you." in the
      // headline and the primary door. Cleared when no name is picked, so the front door
      // falls back to house turquoise rather than whoever last used this browser.
      root.querySelector('.dq-fork').dataset.who = nm || '';
      var p = nm ? pending().length : ALL.length;
      var t = nm ? tally() : null;
      var done = t ? (t.ok + t.change) : 0;
      var h = document.getElementById('dqForkH');
      var sub = document.getElementById('dqForkSub');
      var go = document.getElementById('dqGo');
      var goT = document.getElementById('dqGoT');
      var goD = document.getElementById('dqGoD');
      var foot = document.getElementById('dqFoot');

      var sc = score();
      if (!nm) {
        h.innerHTML = 'Before Monday, a few things need <em>you</em>.';
        sub.textContent = 'Pick your name above and this will show you only the ones that are actually yours.';
      } else if (sc.done > 0 && sc.left > 0) {
        // Once there is progress, lead with it. "11 of 16" is a smaller thing to face than
        // "16", and it is the same list either way.
        h.innerHTML = sc.left + ' out of ' + sc.total + ' things still need <em>you</em>.';
        sub.textContent = 'You have answered ' + sc.done + '. About ' +
          Math.max(2, Math.round(sc.left * 1.5)) + ' minutes for the rest, and it picks up where you stopped.';
      } else if (p === 0) {
        h.innerHTML = 'Nothing is waiting on <em>you</em>.';
        sub.textContent = done
          ? 'You have answered everything on your list. Have a look around if you want to.'
          : 'Nothing on this pack is assigned to you. You can still read it all and leave notes anywhere.';
      } else {
        /* Deferred cards have to be IN this number, even though they are not in `pending()`.
           They are excluded from the queue on purpose, so that "later" does not loop the same
           card straight back at you, and that part is right. Counting them out of the headline
           as well was not: someone who put fifteen off and left one unopened was told
           "1 thing needs you", which is the one direction this sentence must never be wrong in.
           The queue still serves `p`. The headline states the honest total, and the line under
           it splits the two so the number is never a surprise. */
        var later = nm ? deferredThisPass().length : 0;
        var owed = p + later;
        h.innerHTML = owed + (owed === 1 ? ' thing needs <em>you</em>.' : ' things need <em>you</em>.');
        sub.textContent = (later
            ? p + ' to answer now, and ' + later + ' you put off earlier. '
            : '') +
          'About ' + Math.max(2, Math.round(p * 1.5)) + ' minutes, in rounds of five. ' +
          'You can stop at any point and it will remember where you were.';
      }

      // When there is nothing to answer, the queue door is dead, so hand the highlight to
      // the other one rather than leaving someone looking at a greyed-out primary button
      // and wondering what they did wrong.
      go.disabled = !nm || p === 0;
      var all = document.getElementById('dqAll');
      all.classList.toggle('primary', go.disabled && !!nm);
      go.classList.toggle('primary', !(go.disabled && !!nm));

      if (nm && done > 0 && p > 0) {
        goT.textContent = 'Carry on where I left off';
        goD.textContent = done + ' done, ' + p + ' to go. Approve it, ask for a change, or put it off.';
      } else {
        goT.textContent = 'Just my decisions';
        goD.textContent = 'One at a time. Approve it, ask for a change, or put it off.';
      }

      foot.innerHTML = nm && done > 0
        ? 'Answering as <strong style="color:#D8D5CE">' + esc(nm) + '</strong> · ' +
          '<button type="button" id="dqReset">start these over</button>'
        : 'Prepared by Kate · Campaign closes 31 October 2026';
      var rs = document.getElementById('dqReset');
      if (rs) rs.addEventListener('click', function () {
        if (!window.confirm('Clear your answers on this device and start from the first card?\n\nNotes you have already posted stay where they are. This only resets your place in the queue.')) return;
        state = blankState(); saveState(); paint();
      });
    }
    paint();

    document.getElementById('dqNames').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-n]');
      if (!b) return;
      setAuthorName(b.dataset.n);
      loadState();
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (x) { x.classList.remove('sel'); });
      b.classList.add('sel');
      paint();
    });
    document.getElementById('dqGo').addEventListener('click', function () {
      state.since = 0; saveState();
      renderCard();
    });
    document.getElementById('dqAll').addEventListener('click', function () {
      hide();
    });
    show();
  }

  // ---------------------------------------------------------------- the card
  var current = null;

  function renderCard() {
    var q = pending();
    if (!q.length) return renderRest(deferredThisPass().length ? 'pass' : 'end');

    current = q[0];
    var all = queueFor(authorName());
    var t = tally();
    var resolved = t.ok + t.change;
    var pos = all.length - q.length + 1;
    var rounds = Math.max(1, Math.ceil(all.length / ROUND));
    var roundNow = Math.min(rounds - 1, Math.floor(resolved / ROUND));

    var rec = current.rec
      ? '<div class="dq-rec"><b>Recommended</b><p>' + esc(current.rec) + '</p></div>'
      : '<div class="dq-rec none"><b>No recommendation</b><p>This one is genuinely open. There is no default to fall back on.</p></div>';

    var owner = current.owners.map(function (o) {
      return '<span class="dq-owner" data-n="' + esc(o) + '">' + esc(o) + '</span>';
    }).join('');

    // A decision owned by two people needs two answers. Progress is stored per name
    // (see stateKey), so Tara answering this card does not clear it from Emma's queue and
    // never will, but that has to be SAID, or the second one to open the pack assumes the
    // first already closed it and waves it through. Deliberately does NOT reveal what the
    // other person answered: that turns a second opinion into a rubber stamp.
    var both = current.owners.length > 1
      ? '<div class="dq-both">Both of you are asked on this one. Your answer is recorded ' +
        'separately from ' + current.owners.filter(function (o) { return o !== authorName(); })
          .map(esc).join(' and ') + '’s, so it stays on their list until they answer it too.</div>'
      : '';

    root.innerHTML =
      '<div class="dq-queue">' +
        '<div class="dq-head">' +
          '<div class="dq-head-row">' +
            '<div class="dq-count">' + pos + ' of ' + all.length + ' <span>· ' + q.length + ' left</span></div>' +
            '<button type="button" class="dq-exit" id="dqExit">Stop for now</button>' +
          '</div>' +
          '<div class="dq-bar"><i id="dqBar"></i></div>' +
          '<div class="dq-pips">' +
            Array.apply(null, Array(rounds)).map(function (_, i) {
              return '<i class="' + (i < roundNow ? 'done' : i === roundNow ? 'now' : '') + '"></i>';
            }).join('') +
          '</div>' +
        '</div>' +

        '<div class="dq-stage">' +
          '<article class="dq-card anim" id="dqCard">' +
            '<div class="dq-tag"><span>Decision ' + esc(current.num) + '</span>' + owner + '</div>' +
            '<h2 class="dq-q">' + esc(current.label) + '</h2>' +
            both +
            rec +
            '<div class="dq-why">' + current.html + '</div>' +
            '<details class="dq-more"><summary>Where this sits in the pack</summary>' +
              '<div class="dq-more-body">This is Open Decision ' + esc(current.num) + '. ' +
              'To see it in context, with the section it came out of, ' +
              '<a href="#decisions" id="dqCtx">close the queue and jump to it</a>. ' +
              'Your place here is saved, so you can come straight back.</div>' +
            '</details>' +
            '<div class="dq-say" id="dqSay">' +
              '<label for="dqTxt">What needs to change?</label>' +
              '<textarea id="dqTxt" placeholder="In your own words. Kate actions it from here."></textarea>' +
              '<div class="dq-say-row">' +
                '<button type="button" class="go" id="dqSend">Send to Kate</button>' +
                '<button type="button" id="dqCancel">Cancel</button>' +
              '</div>' +
            '</div>' +
            '<div class="dq-err" id="dqErr"></div>' +
          '</article>' +
          '<div class="dq-swipe l" id="dqSwL">Later</div>' +
          '<div class="dq-swipe r" id="dqSwR">Approve</div>' +
        '</div>' +

        '<div class="dq-acts"><div class="dq-acts-in">' +
          '<button type="button" class="dq-act-later" id="dqLater">Later<kbd>&larr;</kbd></button>' +
          '<button type="button" class="dq-act-change" id="dqChange">Change this<kbd>C</kbd></button>' +
          '<button type="button" class="dq-act-ok" id="dqOk">Approve<kbd>&rarr;</kbd></button>' +
        '</div></div>' +
      '</div>';

    // Painted after insert so the bar animates from its old width rather than snapping.
    window.requestAnimationFrame(function () {
      document.getElementById('dqBar').style.width = Math.round((resolved / all.length) * 100) + '%';
    });

    document.getElementById('dqExit').addEventListener('click', hide);
    document.getElementById('dqCtx').addEventListener('click', function () { hide(); });
    document.getElementById('dqOk').addEventListener('click', function () { answer('ok'); });
    document.getElementById('dqLater').addEventListener('click', function () { answer('later'); });
    document.getElementById('dqChange').addEventListener('click', openSay);
    document.getElementById('dqCancel').addEventListener('click', closeSay);
    document.getElementById('dqSend').addEventListener('click', function () {
      var txt = document.getElementById('dqTxt').value.trim();
      if (!txt) { document.getElementById('dqTxt').focus(); return; }
      answer('change', txt);
    });

    wireSwipe(document.getElementById('dqCard'));
  }

  function openSay() {
    var s = document.getElementById('dqSay');
    if (!s) return;
    s.classList.add('on');
    document.getElementById('dqTxt').focus();
    s.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function closeSay() {
    var s = document.getElementById('dqSay');
    if (s) { s.classList.remove('on'); document.getElementById('dqTxt').value = ''; }
    showErr('');
  }
  function showErr(msg) {
    var e = document.getElementById('dqErr');
    if (!e) return;
    e.textContent = msg || '';
    e.classList.toggle('on', !!msg);
  }
  function busy(on) {
    ['dqOk', 'dqLater', 'dqChange', 'dqSend'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.disabled = on;
    });
  }

  // ---------------------------------------------------------------- answering
  // The local record is written FIRST and kept whatever the network does. Losing an
  // answer because Supabase blinked is the one failure this thing cannot have, because she
  // would have to read the card again to find out what she already decided.
  function answer(verdict, text) {
    var d = current;
    if (!d) return;
    showErr('');

    state.answers[d.key] = { v: verdict, pass: state.pass, at: new Date().toISOString(), note: text || '' };
    if (verdict !== 'later') state.since++;
    saveState();

    if (verdict === 'later') return advance();

    var body = verdict === 'ok'
      ? 'Approved.'
      : 'Change requested: ' + text;

    busy(true);
    post(d.key, d.label, body, function (err) {
      busy(false);
      if (err) {
        // Kept locally, flagged as unsent, and offered again on the end screen.
        state.answers[d.key].unsent = true;
        saveState();
        showErr('Saved here, but it did not reach Kate: ' + err + '. You can send the unsent ones again at the end.');
        window.setTimeout(advance, 1400);
        return;
      }
      advance();
    });
  }

  function advance() {
    if (state.since >= ROUND && pending().length) {
      state.since = 0; saveState();
      return renderRest('round');
    }
    saveState();
    renderCard();
  }

  function post(anchorId, anchorLabel, body, done) {
    if (!db) return done('no connection to the notes database');
    db.from(T_NOTES).insert({
      pack_id: PACK_ID,
      pack_title: PACK_TITLE,
      anchor_id: anchorId,
      anchor_label: anchorLabel,
      author_name: authorName(),
      body: body
    }).select('id').then(function (res) {
      done(res && res.error ? res.error.message : null);
    }, function (e) {
      done((e && e.message) || 'network error');
    });
  }

  // ---------------------------------------------------------------- rest + end
  // mode: 'round' (break beat mid-pass) · 'pass' (offer the put-off ones again) · 'end'
  function renderRest(mode) {
    var t = tally();
    var left = pending().length;
    var deferred = deferredThisPass();
    var unsent = Object.keys(state.answers).filter(function (k) { return state.answers[k].unsent; });

    var head, sub, btns;

    if (mode === 'round') {
      head = 'That is ' + (t.ok + t.change) + ' done.';
      sub = left + (left === 1 ? ' left. ' : ' left. ') + 'Keep going while you are in it, or stop here; it will remember.';
      btns =
        '<button type="button" class="go" id="dqMore">Keep going</button>' +
        '<button type="button" id="dqStop">Stop here for now</button>';
    } else if (mode === 'pass') {
      head = 'The list is clear, bar the ones you put off.';
      sub = deferred.length + (deferred.length === 1 ? ' is waiting.' : ' are waiting.') +
        ' Take them now, or leave them for Kate to chase.';
      btns =
        '<button type="button" class="go" id="dqAgain">Take the ' + deferred.length + ' I put off</button>' +
        '<button type="button" id="dqDone">Leave them for Kate</button>';
    } else {
      head = t.change ? 'Done, and Kate has your changes.' : 'Done.';
      sub = 'Everything you answered is already in the pack as a note against the decision it belongs to.';
      btns =
        (unsent.length ? '<button type="button" class="go" id="dqRetry">Send the ' + unsent.length + ' that did not go through</button>' : '') +
        '<button type="button"' + (unsent.length ? '' : ' class="go"') + ' id="dqBrowse">Back to the full pack</button>';
    }

    root.innerHTML =
      '<div class="dq-rest"><div class="dq-rest-in">' +
        '<div class="dq-tick">' + (mode === 'end' ? '✓' : (t.ok + t.change)) + '</div>' +
        '<h2>' + esc(head) + '</h2>' +
        '<p>' + esc(sub) + '</p>' +
        '<div class="dq-tally">' +
          '<div class="t-ok"><div class="n">' + t.ok + '</div><div class="l">approved</div></div>' +
          '<div class="t-ch"><div class="n">' + t.change + '</div><div class="l">changes asked for</div></div>' +
          '<div class="t-lt"><div class="n">' + (mode === 'end' ? t.later : left) + '</div><div class="l">' + (mode === 'end' ? 'left open' : 'still to go') + '</div></div>' +
        '</div>' +
        (mode === 'end' && t.later
          ? '<div class="dq-open"><b>Still open</b><ol>' +
            queueFor(authorName()).filter(function (d) {
              var a = state.answers[d.key]; return a && a.v === 'later';
            }).map(function (d) { return '<li>' + esc(d.label) + '</li>'; }).join('') +
            '</ol></div>'
          : '') +
        '<div class="dq-rest-btns">' + btns + '</div>' +
      '</div></div>';

    var b;
    if ((b = document.getElementById('dqMore'))) b.addEventListener('click', renderCard);
    if ((b = document.getElementById('dqStop'))) b.addEventListener('click', function () { finish(); hide(); });
    if ((b = document.getElementById('dqAgain'))) b.addEventListener('click', function () {
      state.pass++; state.since = 0; saveState(); renderCard();
    });
    if ((b = document.getElementById('dqDone'))) b.addEventListener('click', function () { finish(); renderRest('end'); });
    if ((b = document.getElementById('dqBrowse'))) b.addEventListener('click', function () { finish(); hide(); });
    if ((b = document.getElementById('dqRetry'))) b.addEventListener('click', function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
      var keys = Object.keys(state.answers).filter(function (k) { return state.answers[k].unsent; });
      var left = keys.length, failed = 0;
      keys.forEach(function (k) {
        var a = state.answers[k];
        var d = ALL.filter(function (x) { return x.key === k; })[0];
        post(k, d ? d.label : k, a.v === 'ok' ? 'Approved.' : 'Change requested: ' + a.note, function (err) {
          if (err) failed++; else { delete a.unsent; saveState(); }
          if (--left === 0) {
            btn.disabled = false;
            if (failed) { btn.textContent = 'Still ' + failed + ' unsent, try again'; }
            else renderRest('end');
          }
        });
      });
    });
  }

  // One row on top of the individual ones, pinned to the section rather than a decision:
  // the record that a session happened, and the named list of what is still open. Posted
  // once per finished pass, and only when there is something to report.
  function finish() {
    if (state.summarised === state.pass) return;
    var t = tally();
    if (!(t.ok + t.change)) return;
    state.summarised = state.pass; saveState();

    var open = queueFor(authorName()).filter(function (d) {
      var a = state.answers[d.key]; return !a || a.v === 'later';
    });
    var body = 'Ran the decision queue: ' + t.ok + ' approved, ' + t.change + ' change' +
      (t.change === 1 ? '' : 's') + ' requested.' +
      (open.length ? ' Still open: ' + open.map(function (d) { return d.label; }).join('; ') + '.' : ' Nothing left open.');

    var h2 = document.querySelector('#decisions h2');
    post('decisions__section', h2 ? cleanLabel(h2) : 'Open Decisions', body, function () { /* best effort */ });
  }

  // ---------------------------------------------------------------- swipe + keys
  // Right is approve, left is later. There is deliberately no gesture for "change this":
  // that one needs words, and a gesture that opens a keyboard is not a shortcut.
  function wireSwipe(card) {
    if (!card || !window.PointerEvent) return;
    var x0 = null, y0 = null, dx = 0, locked = false;
    var L = document.getElementById('dqSwL'), R = document.getElementById('dqSwR');

    card.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;                    // mouse users have buttons
      if (e.target.closest('.dq-say, a, button, summary, textarea')) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; locked = false;
    });
    card.addEventListener('pointermove', function (e) {
      if (x0 === null) return;
      var mx = e.clientX - x0, my = e.clientY - y0;
      // Let a vertical drag scroll the card; only claim the gesture once it is clearly sideways.
      if (!locked && Math.abs(my) > Math.abs(mx)) { x0 = null; return; }
      if (Math.abs(mx) > 12) locked = true;
      if (!locked) return;
      dx = mx;
      card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 34) + 'deg)';
      L.classList.toggle('on', dx < -SWIPE_PX);
      R.classList.toggle('on', dx > SWIPE_PX);
    });
    function release() {
      if (x0 === null) { return; }
      var go = Math.abs(dx) > SWIPE_PX ? (dx > 0 ? 'ok' : 'later') : null;
      card.style.transition = 'transform .18s ease';
      card.style.transform = '';
      window.setTimeout(function () { card.style.transition = ''; }, 200);
      L.classList.remove('on'); R.classList.remove('on');
      x0 = null; dx = 0;
      if (go) answer(go);
    }
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
  }

  document.addEventListener('keydown', function (e) {
    if (!root.classList.contains('on')) return;
    if (!document.getElementById('dqCard')) return;
    var typing = e.target.matches('textarea, input');
    if (e.key === 'Escape') {
      if (typing) { closeSay(); return; }
      hide(); return;
    }
    if (typing) {
      // Ctrl/Cmd+Enter sends, so she never has to reach for the mouse mid-sentence.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); document.getElementById('dqSend').click(); }
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); answer('ok'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); answer('later'); }
    else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openSay(); }
  });

  // ---------------------------------------------------------------- entry point in the pack
  // Once the fork has been answered it should not keep reappearing, so the way back in is
  // a button in the pack's own sticky header, carrying the number still outstanding.
  var entryBtn = null, statRow = null;
  function refreshEntryBtn() {
    loadState();
    var host = document.querySelector('.topbar');
    if (!host) return;
    if (!entryBtn) {
      statRow = el('<div class="dq-stats"></div>');
      entryBtn = el('<button type="button" class="dq-open-btn"></button>');
      entryBtn.addEventListener('click', function () {
        loadState();
        if (authorName() && pending().length) { state.since = 0; saveState(); show(); renderCard(); }
        else renderFork();
      });
      var meta = host.querySelector('.topmeta');
      if (meta) meta.insertAdjacentElement('afterend', entryBtn);
      else host.appendChild(entryBtn);
      entryBtn.insertAdjacentElement('afterend', statRow);

      // The notes widget owns its own copy of the name toggle in this same header, and
      // picking a name there changes who this button is counting for. Without this the
      // button keeps showing the previous person's numbers until the page is reloaded,
      // which is exactly how it read wrong. Deferred a tick so the widget's own handler
      // has written the name before this reads it back.
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.trs-idbar-btns button')) return;
        window.setTimeout(function () { REMOTE = null; remoteFor = null; refreshEntryBtn(); }, 0);
      });
    }
    var name = authorName();
    if (!name) {
      entryBtn.innerHTML = 'Answer my decisions <span class="dq-n">' + ALL.length + '</span>';
      if (statRow) statRow.innerHTML = '';
      return;
    }

    var sc = score();
    entryBtn.innerHTML = sc.total === 0
      ? 'Review the decisions'
      : (sc.left === 0 ? 'All answered ' : 'Answer my decisions ') +
        '<span class="dq-n">' + sc.done + '/' + sc.total + '</span>';

    // The breakdown only appears once the server has answered; showing zeroes while the
    // fetch is in flight reads as "you have done nothing", which is worse than showing
    // nothing at all.
    if (statRow) {
      statRow.innerHTML = !sc.live ? '' :
        [['ok', sc.ok, 'approved'], ['ch', sc.change, sc.change === 1 ? 'revision' : 'revisions'],
         ['co', sc.comments, sc.comments === 1 ? 'comment' : 'comments'],
         ['sg', sc.suggestions, sc.suggestions === 1 ? 'suggestion' : 'suggestions']]
        .filter(function (x) { return x[1] > 0; })
        .map(function (x) { return '<span class="dq-stat s-' + x[0] + '"><b>' + x[1] + '</b> ' + x[2] + '</span>'; })
        .join('') || '<span class="dq-stat s-none">Nothing from you yet</span>';
    }

    // Pull the real numbers once per name, then repaint.
    if (name && remoteFor !== name) fetchScore(name, function () { refreshEntryBtn(); });
  }

  // ---------------------------------------------------------------- boot
  loadState();
  refreshEntryBtn();

  // The fork is the front door EVERY time, not just on a first visit (Kate, 8 Aug). The
  // point of the pack is that the decisions come before the reading, and a front door that
  // only appears once stops doing that job the moment someone reopens the tab, which,
  // over a three-week review, is most of the time. "Show me everything" is one click away
  // for anyone who just wants to browse, and the primary door reads "Carry on where I left
  // off" once there is progress to carry.
  //
  // Deliberately not gated on a seen-flag or a session check: any such gate reintroduces
  // the same problem for whoever comes back second.
  if (window.location.hash === '#decide') {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  renderFork();
})();
