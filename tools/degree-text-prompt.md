# Vorlage: Agenten-Auftrag für die Gradtexte eines Zeichens

Verwendet am 30.09.2026 für Aries, Taurus, Gemini, Cancer (je ein Agent, parallel, Ergebnis je 90 Texte, 61–84 Wörter, alle Prüfungen bestanden).
Voraussetzung pro Zeichen: eine vollständige Burgess-Datei `reference/sabian-<zeichen-deutsch>-burgess.md` (alle 30 Grade mit Kern, Schatten, Weg, Lichtseite), ggf. Rohbericht `reference/rohberichte/sabian-burgess/<zeichen>-30-grade-*.md`.
Platzhalter ersetzen: `<SIGN>` (englisch, z. B. LEO), `<Sign>` (Leo), `<sign>` (leo), `<QUELLE>` (Pfad der Burgess-Datei), `<ROH>` (Rohbericht oder weglassen).
Nach dem Lauf selbst prüfen: Anzahl (30 × 3), Wortzahl, verbotene Wörter (heal, therap, trauma, wound, cure, medicin, sabian, burgess, jones, rudhyar, soul, incarnat, magick, angel), eine Stichprobe gegen die Quelle lesen.

---

You are writing website copy for astro.strip (psychological astrology brand of Sandra, Instagram @astro.strip). Working directory: /Users/sandrawilluweit/Documents/Claude Gehirn. Work yourself; do NOT start any sub-agents.

TASK: Write the file `website/public/assets/degrees/<sign>.js` containing 90 short texts: for each of the 30 Sabian degrees of <SIGN> (<Sign> 1 to <Sign> 30) one text for each role: rising, sun, moon.

SOURCE (read these completely before writing, do not skim):
1. `<QUELLE>` — the full Burgess material for all 30 <Sign> degrees (Kern, Schatten, Weg, Lichtseite, group arc). Supplementary: `<ROH>`. These are the ONLY sources for degree content. Every statement must be traceable to the entry for that degree (or its five-degree group). Never invent content, never fall back on generic <Sign> clichés.
2. `context/branddesign.md`, section "Ton/Stimme" — brand voice.
3. `website/public/assets/texts.js` — the sign-level texts already on the site, to match tone (your degree text appears on the card directly below the sign text, so don't repeat it).
4. `website/public/assets/degrees/cancer.js` — an approved example of the format and density.

DEGREE RULE: Sabian degree = drop the minutes, add 1 (0°00'–0°59' <Sign> = <Sign> 1).

WHAT EACH TEXT IS: A card on the birth chart calculator result. The visitor has e.g. her Sun at <Sign> 12. The text tells her what that specific degree means for that role.
- rising = first impression, how she meets the world and how others experience her at first.
- sun = core identity, what she is here to build and become.
- moon = emotional pattern: what she needs to feel safe, how she reacts when feelings run high.
The three texts of one degree must genuinely differ through the role lens, not just swap the first words.

EACH TEXT MUST CONTAIN (Sandra's rule: never reduce a degree to half a sentence): the core/light of the degree, its shadow, and the task/way out — in that order of weight. Length 3–4 sentences, about 55–85 words. English, second person ("you"), polished, sharp, down-to-earth, psychologically precise. Brand line: "Astrology without the fluff. Deep, but readable. Psychological, but not therapy-speak. Mystical look, down-to-earth language." A "caught-you" sentence (paradox or shadow) is good; be specific, not generic.

HARD RULES:
- Do NOT name or describe the Sabian image/symbol and do not mention Sabian, Burgess, Jones or Rudhyar. Only the meaning, in your own words. No quotes from the source, no key phrases lifted verbatim.
- No healing/therapy vocabulary: no heal, healing, therapy, therapist, trauma, wounded, cure, medicine. No diagnoses, no health claims.
- Use wiggle room: often, tends to, can. No fortune-telling, no fixed predictions.
- Esoteric terms from Burgess must be translated into plain psychological language.
- Leave out statements on race or nation if the source degree contains them; keep only the psychological meaning.
- The file must be valid JavaScript (double-quoted strings, curly apostrophes inside are fine).

FILE FORMAT (exactly):
```js
// <Sign> degree texts (Sabian degrees after James Burgess, own words, image not named).
// Source: <QUELLE>
export default {
  1: {
    rising: "...",
    sun: "...",
    moon: "...",
  },
  ...
  30: { ... },
};
```

WORKING METHOD: Create the file early and extend it after every five degrees, so nothing is lost if the session breaks off. At the end, validate syntax with `node --check website/public/assets/degrees/<sign>.js`, and confirm all 30 degrees × 3 roles exist.

FINAL REPLY (short, max 150 words): file written yes/no, count of texts, and a list of any degrees where the source material was thin so the text had to stay general. Do not paste the texts into your reply.
