# Wellness Voucher · Serial Naming System

**Status:** proposed, 20 Aug 2026 · Kate · **`K` added 24 Aug 2026**
**Supersedes:** the `AEWVDYT-AUH-2026-0001` scheme recorded under "Card numbering, already built" in `index.html`. That scheme was a draft written by Kate, not a convention set by Belle, and it covered the tier card only. The attribution in `index.html` was corrected on 20 Aug.
**Reads from:** the nine Phorest gift card products (Decision 13) and the three validity clocks (19 Aug).

---

## 1. What the 15 cards actually are

Three tiers times five card types. The pack's "nine gift card products" counts only what Phorest holds; the refer-a-friend credit and the kit allowance are business adjustments, so they have artwork but no Phorest product.

| | Dip Your Toes | Season of You | All-In VIP Year |
|---|---|---|---|
| **M** · Main tier card | AED 1,150 credit | AED 3,000 credit | AED 5,400 credit |
| **G** · Gift a friend | AED 100 x 1 | AED 100 x 3 | AED 100 x 5 |
| **B** · Birthday card | Blow-dry, AED 150 | AED 350 | AED 750 |
| **R** · Refer a friend | + AED 100 | + AED 150 | + AED 200 |
| **K** · Home Ritual Kit | AED 100 towards | AED 200 towards | AED 450 towards |

Fifteen artworks. But because the friend card is a stack of individual AED 100 cards, one buyer walks out with more than five:

| Tier | Cards issued to one buyer |
|---|---|
| Dip Your Toes | 5 (1M + 1G + 1B + 1R + 1K) |
| Season of You | 7 (1M + 3G + 1B + 1R + 1K) |
| All-In VIP Year | 9 (1M + 5G + 1B + 1R + 1K) |

**Why `K` exists at all.** The kit allowance was settled on 19 August at AED 100 / 200 / 450 and then had nowhere to live: it was the one thing a client bought that she was never handed. The only place the number was ever stated was reception's mouth at the till, against a standing rule that she must say it *before* the bag is packed. A card says it first, and it says the harder half too, that this is an allowance she tops up rather than a kit she has already paid for.

---

## 2. The format

```
WV-<tier><type>-<branch>-<seq>[-<n>]
```

`WV-SM-KCA-0042`

| Block | Values | Why it is in the code |
|---|---|---|
| `WV` | fixed | Wellness Voucher. Keeps this campaign from colliding with the next one. |
| `<tier>` | `D` `S` `V` | Dip Your Toes · Season of You · All-In VIP Year. Reception sees the tier without opening anything. |
| `<type>` | `M` `G` `B` `R` `K` | Main · Gift · Birthday · Refer · Kit. **This is the block the old scheme was missing.** |
| `<branch>` | `SAA` `KCA` `AQ` `MC` | The branch that **issued** it. Already the estate's codes, so the log joins to branch reporting. |
| `<seq>` | `0001`–`9999` | Per branch. One number per **buyer**, not per card. |
| `<n>` | `1`–`5`, on `G` only | Which friend card in her stack. |

---

## 3. One buyer, one number

The single most useful rule here: **all of a buyer's cards share her sequence number.** The type letter is the only thing that changes.

Sara buys Season of You at Khalifa City A and she is the 42nd voucher that branch has sold:

```
WV-SM-KCA-0042      her main card, AED 3,000 credit
WV-SG-KCA-0042-1    friend card 1, AED 100
WV-SG-KCA-0042-2    friend card 2, AED 100
WV-SG-KCA-0042-3    friend card 3, AED 100
WV-SB-KCA-0042      her birthday card, AED 350
WV-SR-KCA-0042      her refer-a-friend credit, AED 150
WV-SK-KCA-0042      her Home Ritual Kit allowance, AED 200 towards
```

Seven cards, one number to remember. This is the same reasoning behind Kate's 19 Aug call to make both short clocks two months: reception holds one number, not several. When a friend walks in with `WV-SG-KCA-0042-2`, reception reads `0042` and lands on Sara without a search.

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
2. **The R card cannot be printed at purchase.** Its clock starts when the third new client has visited *and paid*, so its "valid until" is unknowable at the till. It carries the buyer's sequence but is issued later, when the referral completes. Three of her four card types print at purchase; this one does not.
3. **The R card has no Phorest product.** It is a business adjustment. Its serial exists in the log and on the artwork, not as a gift card in Phorest.
4. **The K card has no Phorest product either**, and for a different reason: it is an allowance against a home care bag, not credit she can spend. Reception totals the bag at shelf value, takes the allowance off, and takes the difference. Nothing depletes, so there is nothing for Phorest to hold.
5. **The K card is the only one that spends on home care, and the only one that cannot spend on a service.** Every other card in the set is the other way round. That inversion is on the back of the card, because the shared rules block would otherwise tell her the card is not valid on the one thing it buys.
6. **Friend cards number in issue order**, `-1` upward, not by which friend gets which.
7. **One buyer buying twice gets two sequences.** Two separate sets.

---

## 7. Fields the artwork has to carry

This is what the print interface fills, and it is what makes Belle's 19 Aug requirement work: *"ilagay nio n din sa e-voucher ung validity saka date of purchase ung editable sa side nmin"*. Flat JPG exports cannot satisfy this. Live text over the artwork can.

| Field | M | G | B | R | K |
|---|---|---|---|---|---|
| Serial | yes | yes | yes | yes | yes |
| Client name | yes | blank, friend writes it | yes | yes | yes |
| Gifted by | no | yes, buyer's name | no | no | no |
| Value | yes | AED 100 | yes | yes | yes, and it reads *towards* |
| Date of purchase | yes | yes, buyer's purchase date | yes | date referral completed | yes |
| Valid until | yes | yes | yes | yes, filled on completion | yes |
| Issuing branch | yes | yes | yes | yes | yes |

**Valid until, computed:**

| Card | Clock |
|---|---|
| `M` | purchase + 6 months (D) / 9 (S) / 12 (V) |
| `G` | purchase + 2 months, from **her** purchase date, not the day she hands it over |
| `B` | same as `M`. Usable any time inside the main voucher's validity, not gated to her birthday month. Confirmed 20 Aug. |
| `R` | referral completion + 2 months |
| `K` | same as `M`. **Derived, not ruled on.** Nobody has set a collection window for the kit, so it runs on the main card's clock, which is the only choice that cannot outlive the voucher. If Kate sets a shorter one, this is the line that changes. |

---

## 8. Settled and open

**Settled 20 August:**

1. **The birthday card is not gated to her birthday.** The blow-dry, or the AED 350 or AED 750, is usable any time inside the main voucher's validity period. It therefore runs on the tier card's clock, 6/9/12 months from purchase, and needs no clock of its own. This closes the gap left by the three validity clocks agreed on 19 August.
2. **`index.html` attribution corrected.** The scheme is recorded as Kate's draft, not Belle's convention.
3. **The old scheme is replaced** in `index.html`, with the superseded table kept in place per the pack's house style.

**Still open:**

4. **Relabelling.** Anything already issued or circulated as `AEWVDYT-...` needs relabelling, or the campaign runs two schemes at once. Belle to confirm whether any cards went out under the old scheme.
