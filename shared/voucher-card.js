/* Wellness Card: the campaign's numbers, the serial format, and the card itself.
 *
 * Shared by voucher-issue (the till) and voucher-log (the record). Everything that decides
 * what a card SAYS lives here, so the two pages cannot disagree about a value, an expiry or
 * a serial. Load after voucher-card.css; plain script, no modules, works off disk as file://
 * like the rest of the pack.
 *
 * The rules encoded below are not this file's to change. They come from the pack:
 *   tiers, values and validity     Decision 13 and the tier table
 *   three expiry clocks            19 August, with the birthday card settled 20 August
 *   serial format                  docs/VOUCHER-SERIAL-SPEC.md
 *   three friends for a referral   Kate, 19 August. See needs: below
 */
(function () {
  var T = window.TRSCard = {};

  // The campaign's own dates. opens is not a launch date, it is a floor: anything before it
  // is a mistyped year, which is the error that matters because a serial cannot be corrected
  // afterwards. closes is the real one and it is stated on the till page too, so if it ever
  // moves it moves in both. issue_voucher() in sql/voucher_issues_setup.sql holds the same
  // two dates and is the one that actually refuses.
  T.CAMPAIGN = { opens:'2026-01-01', closes:'2026-09-30' };

  T.BRANCHES = {
    SAA:{name:'Mamsha al Saadiyat', emirate:'Abu Dhabi'},
    KCA:{name:'Khalifa City A',     emirate:'Abu Dhabi'},
    AQ: {name:'Al Quoz',            emirate:'Dubai'},
    MC: {name:'Motor City',         emirate:'Dubai'}
  };

  // needs: how many new friends have to visit AND pay before the referral credit unlocks.
  // THREE, on every tier. Kate settled it on 19 August and the pack says it in five places:
  // the reception and core-team cheat sheets, the floor memo, docs/VOUCHER-SERIAL-SPEC.md and
  // the decision table in index.html. It is a field rather than a literal only so the copy on
  // the R card can be generated from it instead of the word "third" being typed twice.
  //
  // KNOWN CONSEQUENCE, and it is not a bug to be fixed here. Dip Your Toes ships ONE gift
  // card and still needs three friends, so two of her three arrive without one and get logged
  // with gift_serial empty. That is expected on this tier, not a miscount: gift_serial is
  // nullable for exactly this reason. Do not make it required, and do not refuse a friend for
  // arriving without a card.
  //
  // kit is the Home Ritual Kit ALLOWANCE, settled by Kate on 19 August at 100 / 200 / 450,
  // Season of You corrected down from 250 in the same call. See docs/CAPS-AND-ALLOWANCES.md.
  // It is an allowance, never a cap and never a budget she can build inside: the cheapest
  // single item in the whole range is AED 114 against a AED 100 allowance on Dip Your Toes,
  // so she settles a difference on every tier, every time. kitItems is what the sheet
  // prescribes at that tier and is the only honest way to say what she is topping up towards.
  T.TIERS = {
    D:{name:'Dip Your Toes',   places:1000, spends:1150, months:6,  friends:1, needs:3, birthday:150, birthdayWhat:'Birthday blow-dry', refer:100, kit:100, kitItems:2},
    S:{name:'Season of You',   places:2500, spends:3000, months:9,  friends:3, needs:3, birthday:350, birthdayWhat:'Birthday facial',   refer:150, kit:200, kitItems:4},
    V:{name:'All-In VIP Year', places:4500, spends:5400, months:12, friends:5, needs:3, birthday:750, birthdayWhat:'Birthday treat',    refer:200, kit:450, kitItems:6}
  };

  // The back of the card names the salons rather than the emirate, because "Abu Dhabi salons"
  // on the front answers where and this answers which. Derived from BRANCHES rather than typed
  // again, so opening a fifth salon is still a one-line change in one place.
  // WHAT THE BIRTHDAY CARD SAYS SHE CAN HAVE, and it is set by the EMIRATE, not the tier: the
  // two emirates do not run the same facial. Abu Dhabi lets her choose, Dubai runs the Signature
  // Relaxing with lifting massage. Both sentences are the pack's own, from the Abu Dhabi and
  // Dubai voucher sections in index.html, and Hanneh's artwork carries the same two.
  //
  // OPEN, and deliberately NOT settled here. Dip Your Toes is a contradiction inside the pack
  // itself, not a disagreement with the artwork: the tier table (Decision 13) gives that tier a
  // BLOW-DRY at AED 150, while the emirate sections give every tier a facial, and the Dubai
  // facial is priced at AED 350 in the same document. Artwork does not outrank a locked decision,
  // so D keeps the blow-dry until Kate and Tara settle which one a Dip client actually receives.
  T.birthdayTreat = function (tier, emirate) {
    if (tier === 'D') return T.TIERS.D.birthdayWhat;
    return emirate === 'Dubai'
      ? 'Signature Relaxing Facial with lifting massage'
      : 'Full facial of your choice';
  };

  // The birthday facial in Dubai is at AL QUOZ ONLY: Motor City does not do beauty. Everywhere
  // else on a card "redeemable at" means both salons in the emirate, so this is the one card
  // that cannot use salonsIn().
  T.birthdaySalons = function (emirate) {
    return emirate === 'Dubai' ? ['Al Quoz'] : T.salonsIn(emirate);
  };

  T.salonsIn = function (emirate) {
    var out = [], k;
    for (k in T.BRANCHES) if (T.BRANCHES[k].emirate === emirate) out.push(T.BRANCHES[k].name);
    return out;
  };

  // Term 3: the credit stays in the emirate it was bought in, so there are exactly two terms
  // pages and exactly two QR codes. Both were decoded off the rendered PDF, not trusted.
  T.emirateSlug = function (emirate) { return emirate === 'Dubai' ? 'dubai' : 'abu-dhabi'; };
  // The QR and this line have to be the SAME destination. They were not: the QR went to the
  // campaign landing page and the printed line said the same, so a client who scanned and a
  // client who typed both landed on the sales page rather than the terms she was pointed at.
  // Both now end at /terms/, and assets/qr-terms-*.svg were reminted to match on 21 August.
  // The Confidence Mapping. One constant, used by the cover in text and by
  // assets/qr-confidence-mapping.svg as a code: if this ever moves, the SVG has to be reminted
  // in the same pass or the printed line and the scan go to two different places, which is
  // exactly the fault the terms QR had before 21 August.
  T.MAPPING_URL  = 'https://www.tararosesalon.com/en/ae/confidence-mapping/';
  T.MAPPING_PATH = 'tararosesalon.com/en/ae/confidence-mapping';

  T.termsPath = function (emirate) {
    return 'tararosesalon.com/en/ae/wellness-voucher/' + T.emirateSlug(emirate) + '/terms';
  };

  /* ---------- dates ---------- */
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // British English, month spelled out. Deliberately not 26/08/2026: the client base is
  // mostly expat and a numeric 03/05/2026 is read two different ways by two nationalities.
  // A spelled month has exactly one reading, so the desk never has that argument.
  T.fmt = function (d) {
    if (!d) return '';
    if (typeof d === 'string') {
      var p = d.split('-');
      return (+p[2]) + ' ' + MONTHS[(+p[1]) - 1] + ' ' + p[0];
    }
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  // Clamped to the end of the target month, so 31 Mar + 6 lands on 30 Sep rather than
  // rolling into October. Mirrors make_interval() in the SQL, so a date worked out here and
  // a date worked out by Postgres always agree.
  T.addMonths = function (d, n) {
    var day = d.getDate();
    var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    t.setDate(Math.min(day, last));
    return t;
  };

  T.parseDate = function (v) { var p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  T.today = function () { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  T.iso = function (d) {
    var m = String(d.getMonth() + 1), dd = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (dd.length < 2) dd = '0' + dd;
    return d.getFullYear() + '-' + m + '-' + dd;
  };

  T.money = function (n) { return Number(n || 0).toLocaleString('en-GB'); };
  // Only ever used for the referral threshold, so it needs to reach five and no further.
  var ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
  T.ordinal = function (n) { return ORDINALS[n] || (n + 'th'); };
  T.pad4 = function (n) { var s = String(n); while (s.length < 4) s = '0' + s; return s; };
  T.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  // FOUR CARDS, NOT ONE. Every card here used to render on the same black artwork, so a gift
  // card and a referral card were the same object in the hand and only the small print told
  // them apart. Hanneh's artwork does not work that way, and these are her colours, sampled off
  // the exported pages rather than guessed: the gift card is black like the main card (#040404),
  // the referral card is warm taupe (#D5CBC4 to #DAD4CD) and the birthday card is pale lilac
  // (#E4E1EC to #F6F4F9).
  //
  // The two light cards cannot use the white wordmark or the black card's palette, so the theme
  // carries both decisions: the class the CSS themes off, and which logo file to load.
  // The kit card (K) is the fifth, added 24 August, and it has NO Hanneh artwork behind it:
  // her deck was drawn when the set was four cards. The sage below is this file's choice, made
  // to sit beside her taupe and her lilac rather than to match a page she has not drawn. If she
  // draws one, hers replaces it and only .card.wv-t-K in the CSS changes.
  T.cardTheme = function (card) {
    var light = card.type === 'R' || card.type === 'B' || card.type === 'K';
    return {
      cls: ' wv-t-' + card.type + (light ? ' wv-light' : ''),
      logo: light ? 'tara-rose-logo-black.png' : 'tara-rose-logo-card.png'
    };
  };

  /* ---------- the serial ---------- */
  // WV-<tier><type>-<branch>-<seq>[-<n>] for the log, Phorest and the small print. The card
  // face prints the same thing in four groups, which is how it reads as a card number
  // without being encoded down into digits that need a lookup table to read back.
  T.serialOf = function (tier, type, branch, seq, n) {
    var s = 'WV-' + tier + type + '-' + branch + '-' + T.pad4(seq);
    return n ? s + '-' + n : s;
  };
  T.faceGroups = function (tier, type, branch, seq) {
    return ['WV', tier + type, branch, T.pad4(seq)];
  };

  /* ---------- one buyer's whole set ---------- */
  // One buyer, one sequence. The type letter is the only thing that changes, so reception
  // holds a single number for all five, seven or nine cards.
  //
  // alloc carries {seq, mainExpiry, friendExpiry, live, id}. When it came from Postgres the
  // dates are the ones stored against the serial, so the card shows exactly what the log
  // holds rather than a second calculation that could drift from it.
  T.buildSet = function (branch, tier, name, purchase, alloc) {
    var t = T.TIERS[tier], seq = alloc.seq, cards = [], i;
    var mainExpiry = alloc.mainExpiry, friendExpiry = alloc.friendExpiry;

    cards.push({
      type:'M', label:'Main card', serial:T.serialOf(tier,'M',branch,seq),
      face:T.faceGroups(tier,'M',branch,seq),
      lead:t.name, value:t.spends, valueLabel:'Credit',
      expiry:mainExpiry, printable:true
    });

    for (i = 1; i <= t.friends; i++) {
      // Dip Your Toes ships a single card, where "Card 1 of 1" and "All 1 carry the same
      // expiry" both read as a bug at the desk. One card gets neither line.
      cards.push({
        type:'G', label:t.friends === 1 ? 'Gift card' : 'Gift ' + i,
        serial:T.serialOf(tier,'G',branch,seq,i),
        face:T.faceGroups(tier,'G',branch,seq),
        gift:true, value:100, valueLabel:'Gift credit',
        expiry:friendExpiry, printable:true,
        of:t.friends === 1 ? null : 'Card ' + i + ' of ' + t.friends,
        note:'Two months from <b>her</b> purchase date, not from the day she hands it over.' +
             (t.friends === 1 ? '' : ' All ' + t.friends + ' carry the same expiry.')
      });
    }

    cards.push({
      type:'B', label:'Birthday', serial:T.serialOf(tier,'B',branch,seq),
      face:T.faceGroups(tier,'B',branch,seq),
      lead:T.birthdayTreat(tier, T.BRANCHES[branch].emirate), value:t.birthday,
      valueLabel:'Birthday treat',
      expiry:mainExpiry, printable:true,
      note:'Usable <b>any time</b> inside her voucher validity, not only in her birthday ' +
           'month. Same clock as the main card.'
    });

    // THE HOME RITUAL KIT ALLOWANCE, as a card. The allowance has existed since 19 August but
    // had no object in her hand, so the only place it was ever stated was reception's mouth at
    // the till, and the pack's own rule is that reception says the number BEFORE the bag is
    // packed. A card says it before anybody says anything.
    //
    // The wording is not free here. The kit is never called retail, products or an extra: it is
    // home care, and the locked copy rule is TOWARDS her Home Ritual Kit, never "your kit". That
    // is not a style preference, it is arithmetic: the cheapest single item in the whole
    // thirty-five-product range is AED 114 against a AED 100 allowance, so at Dip Your Toes
    // there is no build that fits inside the allowance at all. A card promising "your kit"
    // would be the one printed thing contradicting the till.
    //
    // THE EXPIRY IS RULED ON, not derived. The Home Ritual Kit clause in the published terms
    // says any unused part of the allowance "ends with the validity period of your voucher", so
    // the main card's clock is the terms' own answer rather than this file's guess. See term 8 on
    // website-mockups/terms/terms.html.
    //
    // IT GOES OUT ON THE DAY SHE PAYS, and it did not always: until 25 August the card was
    // held back until someone ticked a mapping box in the log, because the kit is matched to
    // her at the Confidence Mapping and cannot be made up before it. Belle overturned that
    // from the desk on 25 August, and her reasoning stands here so nobody restores the gate
    // thinking it was lost by accident: a welcome file that lists every inclusion is the thing
    // the client is happy to receive, a card held back is a reminder job the branch will not
    // reliably do, and the client herself cannot ask about a card she has never seen. So the
    // card ships with the file and CARRIES its own condition instead: the cover says the
    // mapping comes first, and the card's back leads with it, QR and all. The mapping still
    // gates the KIT, it just no longer gates the card that tells her about it.
    cards.push({
      type:'K', label:'Home Ritual Kit',
      serial:T.serialOf(tier,'K',branch,seq),
      face:T.faceGroups(tier,'K',branch,seq),
      lead:'Towards your Home Ritual Kit', value:t.kit, valueLabel:'Kit allowance',
      expiry:mainExpiry, printable:true,
      note:'An <b>allowance, not a budget</b>. Total the kit at shelf value, take AED ' +
           T.money(t.kit) + ' off, and she settles the difference when she collects it. ' +
           'Say the number before the kit is made up, never after, and tell her she can ask ' +
           'for the fewest items that will work. Same clock as the main card. ' +
           '<b>Her kit still waits on her Confidence Mapping</b>: it is matched to her ' +
           'there and cannot be made up before her answers are in the <b>info@</b> inbox. ' +
           'The card and her cover both tell her so, and the card cannot be redeemed until ' +
           'it is done.'
    });

    cards.push({
      type:'R', label:'Refer a friend', serial:T.serialOf(tier,'R',branch,seq),
      face:T.faceGroups(tier,'R',branch,seq),
      lead:'Thank you for the introduction', value:t.refer, valueLabel:'Referral credit',
      expiry:alloc.referralExpiry || null,
      printable:!!alloc.referralExpiry,
      note:alloc.referralExpiry
        ? 'Earned. The clock started the day her ' + T.ordinal(t.needs) +
          ' friend visited and paid.'
        : '<b>Cannot be printed yet.</b> The clock starts when her ' + T.ordinal(t.needs) +
          ' new friend has visited <i>and paid</i>, so the expiry does not exist until then. ' +
          'It is a business adjustment, so it has no Phorest gift card either.'
    });

    return {
      seq:seq, branch:branch, tier:tier, name:name, purchase:purchase, cards:cards,
      live:!!alloc.live, id:alloc.id || null,
      // A set that is not live is either a practice run or a database that did not answer,
      // and the desk needs those two told apart: one is a choice, the other is a fault.
      practice:!!alloc.practice
    };
  };

  // Rebuild a set straight from a voucher_log row, so the log can show the same cards the
  // till printed without knowing how any of them are put together.
  T.setFromLogRow = function (row) {
    return T.buildSet(row.branch, row.tier, row.client_name, T.parseDate(row.purchase_date), {
      seq: row.seq,
      id: row.id,
      live: true,
      mainExpiry: T.parseDate(row.main_expires_on),
      friendExpiry: T.parseDate(row.friend_expires_on),
      referralExpiry: row.referral_expires_on ? T.parseDate(row.referral_expires_on) : null
      // mapping_confirmed and its two companions are still on the row for anything issued
      // while the log gated the kit card (before 25 August), but nothing reads them now:
      // the card ships in her file from day one and the mapping condition is printed on it.
    });
  };

  /* ---------- render ---------- */
  T.render = function (set, card, extraClass) {
    var b = T.BRANCHES[set.branch];
    var nm = set.name ? set.name : 'Her name';
    var lead = card.gift
      ? '<div class="gift">A gift for you</div>'
      : '<div class="tier">' + T.esc(card.lead) + '</div>';
    var expiry = card.expiry ? T.fmt(card.expiry) : 'Set on referral';
    var theme = T.cardTheme(card);

    return '' +
    '<div class="card' + theme.cls + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="sheen"></div>' +
      // tara-rose-logo-CARD, not -white. The shared white logo carries the mint rule above the
      // wordmark, which is the pack's UI accent and is right on the eight pages that use it.
      // On the black card it is the only cool colour against the gold, and the approved Canva
      // artwork has a plain white rule there: counted, zero mint pixels on it. So the card gets
      // its own copy with that one rule turned white, and the shared asset is left alone.
      '<div class="brand"><img src="../assets/' + theme.logo + '" alt="Tara Rose Salon"></div>' +
      lead +
      '<div class="emv"><i></i><i></i><i></i><i></i></div>' +
      '<div class="val">' +
        '<div class="lb">' + T.esc(card.valueLabel) + '</div>' +
        '<div class="wv-amt"><small>AED</small>' + T.money(card.value) + '</div>' +
      '</div>' +
      '<div class="num">' +
        card.face.map(function (g) { return '<span>' + g + '</span>'; }).join('') +
      '</div>' +
      (card.of ? '<div class="of">' + T.esc(card.of) + '</div>' : '') +
      '<div class="wv-cardfoot">' +
        '<div class="wv-holder">' +
          '<div class="lb">' + (card.gift ? 'Gifted by' : 'Cardholder') + '</div>' +
          '<div class="nm">' + T.esc(nm) + '</div>' +
        '</div>' +
        '<div class="dates">' +
          '<div>Purchased <b>' + T.fmt(set.purchase) + '</b></div>' +
          '<div>Valid until <b>' + expiry + '</b></div>' +
          // The cardholder needs to know where the credit is good, and Term 3 holds it to
          // the emirate it was bought in. The issuing branch is already inside the serial,
          // so printing it twice would cost the one line that answers her actual question.
          '<div>' + T.esc(b.emirate) + ' salons</div>' +
        '</div>' +
      '</div>' +
      // Dawn's wording, term 12. The front stays a pointer rather than an address: the back
      // carries both the QR and the printed path, and repeating it here would cost the line
      // that tells her the credit is not cash.
      '<div class="fine">Cannot be exchanged for cash &middot; Full terms apply</div>' +
    '</div>';
  };

  /* ---------- the cover ---------- */
  // Page one of HER file, and the reason no covering email had to be written: everything
  // reception would otherwise type into WhatsApp is on it.
  //
  // It lists the cards IN THIS FILE rather than the whole set, because her friends' cards are
  // sent as separate files now, one per friend. If it listed all eight she would go looking for
  // five cards that are not in there.
  //
  // Nothing here is a new fact. The tier, the credit, the dates and the salons all come off the
  // same set the cards are drawn from, so the cover cannot disagree with the card behind it.
  T.renderCover = function (set, cards) {
    var b = T.BRANCHES[set.branch];
    var t = T.TIERS[set.tier];
    var slug = T.emirateSlug(b.emirate);
    var main = cards[0];
    var gifts = set.cards.filter(function (c) { return c.gift && c.printable; }).length;

    // c.label is reception's word for the card, and "Main card" and "Birthday" are the wrong
    // words to hand a client. She is not filing them, she is being given them.
    var CLIENT_NAME = { M:'Your card', B:T.birthdayTreat(set.tier, b.emirate), R:'Referral credit',
                        K:'Towards your Home Ritual Kit' };
    var list = cards.map(function (c) {
      return '<li><b>' + T.esc(CLIENT_NAME[c.type] || c.label) + '</b>, AED ' + T.money(c.value) +
             (c.expiry ? ', until ' + T.fmt(c.expiry) : '') + '</li>';
    }).join('');

    // The one number on this page she has not been told yet, and the only one that costs her
    // money later. The kit allowance is not the kit: at every tier the honest build is above
    // the allowance, so she settles a difference on collection. Reception is already required
    // to say that before the bag is packed; putting it in writing means the card and the desk
    // say the same thing, and she reads it before she is standing there.
    // The kit card is in this file from day one (25 August, Belle's call), so this section's
    // job changed with it: it used to tell her a card was coming, now it is the disclaimer
    // that the card in her hand cannot be redeemed before the mapping is done. The heading
    // stays "comes first" because that is still true of the mapping, whatever the card does.
    // NOT "One thing to do first". The friends section two below already carries
    // "One thing to do now", and two near-identical headings on one page make her
    // decide which of them is the real instruction.
    var kitCard = set.cards.filter(function (c) { return c.type === 'K'; })[0];
    var kit = '';
    if (kitCard) {
      kit = '<h2>Your kit allowance</h2>' +
        '<p>AED ' + T.money(kitCard.value) + ' comes off the total when you collect your Home ' +
        'Ritual Kit. It covers part of the kit rather than all of it, so anything above ' +
        'that you settle on the day. If you would rather keep it small, say so before your ' +
        'kit is made up and we will build it to the fewest items that will work.</p>' +
        '<h2>Your Confidence Mapping comes first</h2>' +
        '<p>Your kit card is in this file, but your kit is matched to you at your ' +
        '<b>Confidence Mapping</b>, so the card cannot be redeemed before that is done. ' +
        'It takes a few minutes: <b>' + T.MAPPING_PATH + '</b>, or scan the code on the ' +
        'back of the card. We will tell you the number before anything is made up.</p>';
    }

    // One file per friend is a privacy decision, not a filing preference, so it is explained
    // rather than left for her to notice.
    var friends = gifts
      ? '<h2>Your friends’ cards come separately</h2>' +
        '<p>' + (gifts === 1 ? 'One card, in its own file' : gifts + ' cards, one file each') +
        ', so you can pass one to a friend without sending her the rest.</p>' +
        '<h2>One thing to do now</h2>' +
        '<p>Hand those out early. They run for two months from the day <b>you</b> bought, ' +
        'not from the day you give one away.</p>'
      : '';

    // Named but not promised as an attachment, because on the day she pays it does not exist
    // yet. She gets it as its own card once the third friend has been in.
    var refer = '<h2>Later</h2><p>AED ' + T.money(t.refer) + ' of referral credit reaches you as ' +
      'its own card once your ' + T.ordinal(t.needs) + ' friend has visited and paid.</p>';

    return '' +
    '<div class="wv-cover">' +
      '<div class="wv-brandline"><img src="../assets/tara-rose-logo-black.png" alt="Tara Rose Salon"></div>' +
      '<h1>Your Wellness Voucher</h1>' +
      '<div class="wv-line"><b>' + T.esc(set.name || 'Her name') + '</b> &middot; ' + T.esc(t.name) + '</div>' +
      '<div class="wv-rule"></div>' +
      '<div class="wv-amt"><small>AED</small>' + T.money(main.value) + '</div>' +
      '<div class="wv-sub">Yours until ' + T.fmt(main.expiry) + ', at ' +
        T.esc(T.salonsIn(b.emirate).join(' and ')) + '.</div>' +
      '<h2>In this file</h2>' +
      '<ul>' + list + '</ul>' +
      kit +
      friends +
      refer +
      '<div class="wv-foot">' +
        '<div class="wv-terms"><b>Thank you for placing this with us.</b>' +
          'Full terms: ' + T.termsPath(b.emirate) + '</div>' +
        '<div class="wv-qr"><img src="../assets/qr-terms-' + slug + '.svg" alt="Scan for the full terms"></div>' +
      '</div>' +
    '</div>';
  };

  /* ---------- the back ---------- */
  // The front answers what she holds and what it is worth. The back answers the two questions
  // reception gets asked after that: where exactly can I spend it, and where are the terms.
  //
  // The QR is an SVG, not a PNG, so it stays vector in the saved PDF and survives any zoom.
  // It sits on a CREAM PANEL and that is not decoration: the modules are #2d2e37 and a dark
  // QR on a black card does not scan. The panel is the thing that makes it readable.
  //
  // The wording below is lifted from the approved gift card artwork, which took it from Dawn's
  // terms. Only the clauses that are true of EVERY card in the set are here; anything that
  // varies by card, the value and the expiry, is a row above rather than a sentence.
  T.renderBack = function (set, card, extraClass) {
    var b = T.BRANCHES[set.branch];
    var slug = T.emirateSlug(b.emirate);
    var expiry = card.expiry ? T.fmt(card.expiry) : 'Set on referral';

    function row (label, value) {
      return '<div class="wv-row"><div class="lb">' + label + '</div>' +
             '<div class="vl">' + value + '</div></div>';
    }

    var theme = T.cardTheme(card);

    // Every other card in the set spends on services and cannot touch home care. The kit card is
    // the one that spends the other way, so it cannot carry the shared rules: line one of them
    // would tell her the card is not valid on the only thing it buys.
    //
    // Line one used to read "not valid on home care, RETAIL PRODUCTS or another voucher", which
    // named home care as retail in client-facing print, in the same PDF as a card whose whole job
    // is to treat it as prescribed care. Tara's 16 July ruling is that the client never thought it
    // was retail, so the word only introduces the idea. "Home care" is the pack's own term for the
    // same things and the published terms use it, so nothing is narrowed by dropping it.
    //
    // THREE clauses on the kit card, same as the others, and the first one is the QR's job:
    // the code goes to the Confidence Mapping, not to the terms, because the mapping is the
    // thing standing between her and the kit. The old first two are merged rather than a
    // fourth line added; voucher-card.css says three and never four, and it is right.
    var rules = card.type === 'K'
      ? ['Scan the code to do your Confidence Mapping first. Your kit is matched to you there, so this card cannot be redeemed until it is done.',
         'Home care only. Not valid on services or as credit, and it is an allowance towards the kit, not the full price of it.',
         'Anything above the allowance is settled on collection. No cash value, no change given, and no refund on any unused part.']
      : ['Eligible salon services only. Not valid on home care or another voucher.',
         'No cash value. Cannot be exchanged or refunded, and cannot be combined with another offer.',
         'Subject to appointment availability. Standard booking and cancellation policies apply.'];

    // Which code this card carries, and where it points. Every other card sends her to the
    // terms, which is the only thing she might want to look up. The kit card sends her to the
    // Confidence Mapping instead: she cannot collect the kit until it is done, so a terms link
    // would be the less useful of the two on the one card that has a step attached to it. The
    // terms are still on this face, printed along the bottom.
    var kit = card.type === 'K';
    var qrFile = kit ? 'qr-confidence-mapping.svg' : 'qr-terms-' + slug + '.svg';
    var qrAlt  = kit ? 'Scan to do your Confidence Mapping' : 'Scan for the full terms';
    var qrCap  = kit ? 'Do this first' : 'Scan for the full terms';

    return '' +
    '<div class="card back' + theme.cls + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="sheen"></div>' +
      '<div class="brand"><img src="../assets/' + theme.logo + '" alt="Tara Rose Salon"></div>' +
      '<div class="wv-qrbox"><img src="../assets/' + qrFile + '" alt="' + qrAlt + '"></div>' +
      '<div class="wv-qrcap">' + T.esc(qrCap) + '</div>' +
      '<div class="wv-bk">' +
        row('Redeemable at', T.esc((card.type === 'B' ? T.birthdaySalons(b.emirate)
                                                     : T.salonsIn(b.emirate)).join(' and ')) + ' only') +
        row('Full serial', T.esc(card.serial)) +
        row('Valid until', expiry) +
      '</div>' +
      '<div class="wv-rules">' + rules.map(function (r) { return '<div>' + r + '</div>'; }).join('') + '</div>' +
      '<div class="wv-bkurl">' + T.termsPath(b.emirate) + '</div>' +
    '</div>';
  };

  // The saved page, on screen, at 55%. Same two faces the printer gets, in the same box, so
  // reception can check the page during a practice run rather than spending a serial to see it.
  // The scale lives in CSS, not here, because voucher-card.css is the only thing that is
  // allowed to know how big the page is.
  T.renderPage = function (set, card) {
    return '<div class="wv-pagewrap"><div class="wv-pagescale">' +
             '<div class="wv-sheet wv-preview">' + T.render(set, card) + T.renderBack(set, card) + '</div>' +
           '</div></div>';
  };

  /* ---------- printing ---------- */
  // One function for every page. It fills #trs-printroot, which voucher-card.css is the only
  // thing that knows how to lay out, so no page has to own print rules of its own.
  //
  // The class comes off on afterprint rather than on the line after window.print(). Chrome
  // does not reliably block there, and clearing it early strips the print layout before the
  // preview has rendered, which silently produces the wrong pages.
  T.print = function (set, cards, filename, cover) {
    var root = document.getElementById('trs-printroot');
    if (!root) {
      root = document.createElement('div');
      root.id = 'trs-printroot';
      document.body.appendChild(root);
    }
    // One A4 page per card, both faces on it. The sheet is what carries the page break, so
    // voucher-card.css can size the page and the card independently. See the printing block
    // there for why the card is not printed at its real 85.6mm.
    root.innerHTML =
      (cover ? '<div class="wv-sheet wv-cover-sheet">' + T.renderCover(set, cards) + '</div>' : '') +
      cards.map(function (c) {
        return '<div class="wv-sheet">' + T.render(set, c) + T.renderBack(set, c) + '</div>';
      }).join('');

    // The browser names a Save as PDF after document.title, so reception can find the file
    // again in a folder of attachments rather than opening four called Untitled.
    var restore = document.title;
    if (filename) document.title = filename;
    document.body.classList.add('trs-printing');

    function cleanup() {
      document.body.classList.remove('trs-printing');
      document.title = restore;
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  // HER file: the cards that are hers on the day she pays, behind a cover. The main card,
  // the birthday card and the kit card (in the file since 25 August, with its mapping
  // condition printed on it), and nothing else.
  //
  // NOT the gift cards. There used to be one button that put all eight in one file, and it was
  // the shortest path to a leak in the pack: she forwards that file to a friend, because it is
  // the only file she has, and the friend opens it holding her balance and the other four gift
  // serials, any of which she could then spend. One file per friend costs reception a second
  // Save and closes it.
  //
  // NOT the referral card either, and that one is a timing decision rather than a privacy one.
  // It does not exist on the day she pays: the clock starts when her third friend has visited
  // AND paid, so it is a later delivery. Bundling it here would mean her file held two cards on
  // Monday and three in November, which is the kind of quiet difference nobody can support.
  T.printHers = function (set) {
    var hers = set.cards.filter(function (c) {
      return c.printable && (c.type === 'M' || c.type === 'B' || c.type === 'K');
    });
    T.print(set, hers,
      'WV-' + set.branch + '-' + T.pad4(set.seq) + ' ' + set.name + ' wellness voucher', true);
  };

  // Any one card on its own: a friend's gift card, or her referral card when she has earned it.
  // The gift name is written for the person it is forwarded TO, who never saw the till and should
  // not receive a file called WV-VG-KCA-0042-1.
  T.printOne = function (set, card) {
    var name = card.gift
      ? 'Gift card from ' + set.name + ' ' + card.serial
      : 'WV-' + set.branch + '-' + T.pad4(set.seq) + ' ' + set.name + ' ' + card.label.toLowerCase();
    T.print(set, [card], name);
  };

  // Kept so nothing that still calls these breaks. printSet used to mean the whole set in one
  // file, which is the thing being removed, so it now means her file.
  T.printSet  = T.printHers;
  T.printGift = T.printOne;
})();
