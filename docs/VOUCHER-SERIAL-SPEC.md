# Wellness Voucher · Serial Naming System

**Status:** proposed, 20 Aug 2026 · Kate · **`K` added 24 Aug 2026, removed 16 Sep 2026** · **type letter dropped 16 Sep 2026**
**Supersedes:** the `AEWVDYT-AUH-2026-0001` scheme recorded under "Card numbering, already built" in `index.html`. That scheme was a draft written by Kate, not a convention set by Belle, and it covered the tier card only. The attribution in `index.html` was corrected on 20 Aug.
**Reads from:** the nine Phorest gift card products (Decision 13) and the three validity clocks (19 Aug).

---

## 1. What the cards actually are

Three tiers times four card types. **`K`, the Home Ritual Kit card, was removed 16 Sep 2026** — Kate's call, in the same message that dropped the type letter (section 2). The allowance itself is untouched; it just no longer has a printed card of its own in this set. If it needs to come back as a card, treat it as a new decision, not a revert.

| | Dip Your Toes | Season of You | All-In VIP Year |
|---|---|---|---|
| **M** · Main tier card | AED 1,150 credit | AED 3,000 credit | AED 5,400 credit |
| **G** · Gift a friend | AED 100 x 1 | AED 100 x 3 | AED 100 x 5 |
| **B** · Birthday card | Blow-dry, AED 150 | AED 350 | AED 750 |
| **R** · Refer a friend | + AED 100 | + AED 150 | + AED 200 |

Because the friend card is a stack of individual AED 100 cards, one buyer walks out with more than four:

| Tier | Cards issued to one buyer |
|---|---|
| Dip Your Toes | 4 (1M + 1G + 1B + 1R) |
| Season of You | 6 (1M + 3G + 1B + 1R) |
| All-In VIP Year | 8 (1M + 5G + 1B + 1R) |

---

## 2. The format

```
WV-<tier>M-<branch>-<seq>[-<n>]
```

`WV-VM-SAA-0003` (main card) · `WV-VM-SAA-0003-1` (her first other card)

**Rewritten 16 Sep 2026.** The type letter used to vary per card (`M`/`G`/`B`/`R`/`K`, section 2 in the original version of this doc). Kate corrected that: a letter changing in the middle of the code was more confusing at the till than a plain running number at the end, and the card's own printed label already says what it is (Gift 1, Birthday, Refer a friend). So the middle block is now always `M`, and it no longer means "Main" specifically — it is fixed for every card in the set.

| Block | Values | Why it is in the code |
|---|---|---|
| `WV` | fixed | Wellness Voucher. Keeps this campaign from colliding with the next one. |
| `<tier>` | `D` `S` `V` | Dip Your Toes · Season of You · All-In VIP Year. Reception sees the tier without opening anything. |
| `M` | fixed | No longer a type code. Kept only because it was the base identity already, and changing it would ripple further than the fix needed to. |
| `<branch>` | `SAA` `KCA` `AQ` `MC` | The branch that **issued** it. Already the estate's codes, so the log joins to branch reporting. |
| `<seq>` | `0001`–`9999` | Per branch. One number per **buyer**, not per card. |
| `<n>` | `1`–`7` | Absent on the main card. Every other card in the set gets one, counting straight through in a fixed order — gifts first, then birthday, then refer — with no restart between types. |

---

## 3. One buyer, one number, one running count

Sara buys Season of You at Khalifa City A and she is the 42nd voucher that branch has sold:

```
WV-SM-KCA-0042      her main card, AED 3,000 credit
WV-SM-KCA-0042-1    friend card 1, AED 100
WV-SM-KCA-0042-2    friend card 2, AED 100
WV-SM-KCA-0042-3    friend card 3, AED 100
WV-SM-KCA-0042-4    her birthday card, AED 350
WV-SM-KCA-0042-5    her refer-a-friend credit, AED 150
```

Six cards, one number to remember and a count to five. This is the same reasoning behind Kate's 19 Aug call to make both short clocks two months: reception holds one number, not several. The card's own label (printed on its face) says which one it is; the serial only has to say it is hers and which of her cards this one is.

---

## 4. Why the sequence is per branch

Four branches issuing from one shared counter needs live shared state. Two tills could both write `0043` on the same afternoon and nothing would show an error, which is the same silent-failure shape as the missing-tier problem on the reception sheet.

Per-branch counters remove the problem instead of managing it. Each branch only ever increments its own block, so a cross-branch collision is impossible by construction. Four counters, each starting at `0001`. No network call needed to issue a code, which matters at a busy till.

**The branch letter means issued at, not valid at.** The offer is emirate-wide: an Abu Dhabi voucher spends at both Saadiyat and Khalifa City A. `KCA` on the card does not tie it to Khalifa City A.

**Saadiyat gotcha.** Saadiyat has no working Stripe, so those clients pay through the Khalifa City link and the payment lands under KCA. The serial follows the **till she stood at**, so a Saadiyat sale is `SAA` even when the money shows up as KCA. Otherwise every Saadiyat voucher disappears into Khalifa City's numbers.

---

## 5. What the code does not carry, and why

| Left out | Where it lives instead |
|---|---|
| **Emirate** | Derivable: `SAA`/`KCA` are Abu Dhabi, `AQ`/`MC` are Dubai. Encoding both invites the two from disagreeing. |
| **Year** | The campaign is date-bounded: purchases close 30 September 2026. If it runs again, the next campaign gets its own prefix. |
| **Expiry** | A printed field on the artwork, not in the code. Three different clocks, and Belle needs the date **editable**. Baking a date into a serial means a reissued card needs a new serial. |
| **Value** | Implied by tier plus type. Twelve combinations, twelve fixed values. |
| **Check digit** | Deliberately not included. It would catch mistypes into Phorest, but it costs a character and a rule reception has to trust for a six-week campaign. Not worth it. |
| **`AE`** | Single country. Dead weight. |

Length dropped from 21 characters to 14. It is typed by hand at a till, sometimes read aloud over the phone.

---

## 6. Operational rules

1. **Never reuse a sequence.** A refunded or voided voucher is struck in the log and its number retires with it. Gaps are fine; a reused number is not.
2. **The R card cannot be printed at purchase.** Its clock starts when the third new client has visited *and paid*, so its "valid until" is unknowable at the till. It carries the buyer's sequence and its own `-n`, reserved in order even though it is issued later, when the referral completes.
3. **The R card has no Phorest product.** It is a business adjustment. Its serial exists in the log and on the artwork, not as a gift card in Phorest.
4. **The cards' backs read "Not valid on home care or another voucher"** (24 Aug). Naming home care as retail is against Tara's 16 July ruling, and the wording used to do that in client-facing print. "Home care" is the pack's own term for the same things, and it is the term the published terms use.
5. **Friend cards number in issue order**, counting straight into the birthday and refer suffixes after them, not by which friend gets which.
6. **One buyer buying twice gets two sequences.** Two separate sets.

---

## 7. Fields the artwork has to carry

This is what the print interface fills, and it is what makes Belle's 19 Aug requirement work: *"ilagay nio n din sa e-voucher ung validity saka date of purchase ung editable sa side nmin"*. Flat JPG exports cannot satisfy this. Live text over the artwork can.

| Field | M | G | B | R |
|---|---|---|---|---|
| Serial | yes | yes | yes | yes |
| Client name | yes | blank, friend writes it | yes | yes |
| Gifted by | no | yes, buyer's name | no | no |
| Value | yes | AED 100 | yes | yes |
| Date of purchase | yes | yes, buyer's purchase date | yes | date referral completed |
| Valid until | yes | yes | yes | yes, filled on completion |
| Issuing branch | yes | yes | yes | yes |

**Valid until, computed:**

| Card | Clock |
|---|---|
| `M` | purchase + 6 months (D) / 9 (S) / 12 (V) |
| `G` | purchase + 2 months, from **her** purchase date, not the day she hands it over |
| `B` | same as `M`. Usable any time inside the main voucher's validity, not gated to her birthday month. Confirmed 20 Aug. |
| `R` | referral completion + 2 months |

---

## 8. Settled and open

**Settled 20 August:**

1. **The birthday card is not gated to her birthday.** The blow-dry, or the AED 350 or AED 750, is usable any time inside the main voucher's validity period. It therefore runs on the tier card's clock, 6/9/12 months from purchase, and needs no clock of its own. This closes the gap left by the three validity clocks agreed on 19 August.
2. **`index.html` attribution corrected.** The scheme is recorded as Kate's draft, not Belle's convention.
3. **The old scheme is replaced** in `index.html`, with the superseded table kept in place per the pack's house style.

**Settled 16 September:**

5. **The type letter is gone, replaced by one running `-n`.** A same-day correction of an earlier attempt at this that kept the letter and gave every card its own `-1` — Kate: no letters, just one number, counting straight through the whole set (gifts, then birthday, then refer). The main card is the bare base serial; nothing else printed for a buyer is. Landed in `T.serialOf` / `T.faceGroups` / `T.buildSet` in `shared/voucher-card.js`. The log table's `main_serial` and the SQL views (`voucher_mapping.sql`, `voucher_referrals.sql`, `voucher_payment_method.sql`, `voucher_redemptions.sql`) still compute the shorter `WV-<tier>M-<branch>-<seq>` — that string is a per-buyer lookup key across those views, not a printed card serial, and was left alone.
6. **The Home Ritual Kit card (`K`) is removed from the printed set.** Same message from Kate. The allowance itself, its terms, its emails and its automations are untouched — only the card artwork/tab in `T.buildSet` is gone, along with the now-dead kit-only branches in `renderCover`, `renderBack` and `cardTheme`.

**Still open:**

4. **Relabelling.** Anything already issued or circulated as `AEWVDYT-...` needs relabelling, or the campaign runs two schemes at once. Belle to confirm whether any cards went out under the old scheme.
