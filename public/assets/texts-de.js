// German Big Three texts for the calculator result on /de/ (plans/website-deutsch.md, section C).
// Translated from texts.js (Sandra's approved English texts), no new interpretation. Keys stay English.
// Tone: du, short, with edge (context/branddesign.md); gender-neutral (context/business.md, 03.10.2026).
// When an English text in texts.js changes, change the German one in the same step. Check: node tools/check-texts.mjs

export const TEXTS = {
  Aries: {
    sun: ['Fürs Anfangen gemacht.', 'Wer du bist, merkst du beim Machen, nicht beim Warten. Hinter dem Tempo steckt oft Angst. Dein Mut ist echt, weil du trotz der Angst losgehst, nicht weil du keine hast.'],
    rising: ['Erst das Tempo. Dann du.', 'Bevor die Leute dich kennenlernen, lernen sie dein Tempo kennen: direkt, schnell, null Geduld für Spielchen. Was sie nicht sehen: Solange du in Bewegung bist, musst du nicht spüren, was dich innerlich beschäftigt.'],
    moon: ['Gefühlt, gesagt, vorbei.', 'Deine Wut ist schnell draußen und wird selten zum Groll. Was dich wirklich fertigmacht, ist Stillstand. Sicher fühlst du dich, solange sich etwas bewegt.'],
  },
  Taurus: {
    sun: ['Nicht langsam. Wählerisch.', 'Aus Mühe machst du etwas, das nützt und bleibt, etwa ein Zuhause, Erspartes oder etwas, das du über Jahre gelernt hast. Faul? Das ist das Klischee. Der Stier packt an. Du bewegst dich nur nicht ohne guten Grund.'],
    rising: ['Die Ruhe sieht man zuerst.', 'Du wirkst gelassen und lässt dich nicht drängen. Meist geht dem Druck eher die Puste aus als dir. Hinter der Ruhe steckt viel, das du nie laut sagst.'],
    moon: ['Sicherheit zum Anfassen.', 'Sicher fühlst du dich mit dem, was greifbar ist: feste Abläufe, Menschen, die bleiben, Dinge, die echt sind. Wut schluckst du lange runter. Bis es knallt.'],
  },
  Gemini: {
    sun: ['Zwei Gesichter? Zwei Seiten.', 'Du verstehst die Welt, indem du vergleichst, benennst und Verbindungen ziehst. Im Mythos haben die Zwillinge einander nie verraten. Deine zwei Seiten: die leichte, die alle kennen, und die schwere, die du selten zeigst.'],
    rising: ['Gedanklich schon drei Themen weiter.', 'Die Leute erleben zuerst deinen Kopf: schnell, witzig, leicht ins Gespräch zu kommen. Wird es dir zu nah, machst du einen Witz, und der trifft oft genau die empfindliche Stelle, deine oder die der anderen.'],
    moon: ['Gefühle? Erst mal in Worte fassen.', 'Was du fühlst, verarbeitest du durch Reden, Lesen und Verstehen. Du brauchst Luft, und deine dunklen, grüblerischen Phasen bekommt kaum jemand mit.'],
  },
  Cancer: {
    sun: ['Weich ist das falsche Wort.', 'Du verteidigst, was dir gehört, und gibst keinen Zentimeter nach. Nur zu Hause glücklich? Klischee. Der Krebs ist ehrgeizig und fühlt sich auch in der Öffentlichkeit wohl. Der Panzer ist dafür da, dass innen alles weich bleiben darf.'],
    rising: ['Erst vorsichtig. Dann herzlich.', 'Du wirkst warm, aber vorsichtig, und checkst erst die Stimmung, bevor du reingehst. Probleme gehst du über Umwege an und siehst genau deshalb, was andere übersehen.'],
    moon: ['Wo bin ich sicher? Und wer gehört zu mir?', 'In deinem Gefühlsleben geht es um Zugehörigkeit und Erinnerung. Die Vergangenheit lässt dich nie ganz los. Fühlst du dich ungeschützt, ziehst du dich eher zurück, als zu kämpfen.'],
  },
  Leo: {
    sun: ['Ausgerechnet das stolzeste Zeichen zweifelt.', 'Du willst gesehen werden, wie du wirklich bist, nicht als Rolle. Hinter der großen Geste steckt oft eine leise Frage: Reicht das?'],
    rising: ['Du kommst rein, und alle merken es.', 'Man bemerkt dich, und man spürt deine Wärme: direkt, loyal, keine Spielchen. Kritik trifft dich härter, als du zeigst.'],
    moon: ['Will gespürt werden, nicht umschmeichelt.', 'Sicher fühlst du dich, wenn deine Wärme ankommt und jemand sieht, was du gibst. Schmeicheleien prallen an dir ab. Du brauchst Menschen, die wirklich auf dich eingehen, keinen Applaus.'],
  },
  Virgo: {
    sun: ['Praktisch, nicht perfekt.', 'Du sortierst, verbesserst und reparierst das Kleine, bevor es groß wird. „Jungfrau“ bedeutete ursprünglich: eine Frau, die sich selbst gehört. Nicht prüde. Unabhängig.'],
    rising: ['Dir fällt sofort auf, was nicht stimmt.', 'Die Leute erleben zuerst deine Genauigkeit: klar, hilfsbereit, ein bisschen zurückhaltend. Die Kritik, die sie bei dir spüren, gilt meistens zuerst dir selbst.'],
    moon: ['Ordnung beruhigt dich.', 'Sicher fühlst du dich, wenn alles Sinn ergibt und funktioniert. Tut es das nicht, übernimmt die Sorge, und oft spürst du sie im Bauch, bevor du sie benennen kannst.'],
  },
  Libra: {
    sun: ['Nicht ausgeglichen. Abwägend.', 'Du wägst ab: Was ist fair, was passt, was stimmt zwischen dir und den anderen? Harmonie ist für dich keine Stimmung, sondern Arbeit: mit Regeln, mit Geduld, manchmal gegen den Strom.'],
    rising: ['Lächeln heißt nicht Ja.', 'Du wirkst charmant und diplomatisch, und oft halten die anderen am Ende deine Idee für ihre. Darunter steckt ein starker Wille, die eigenen Vorstellungen durchzusetzen, einer der am meisten unterschätzten im ganzen Tierkreis.'],
    moon: ['Frieden hat seinen Preis.', 'Sicher fühlst du dich, wenn es zwischen Menschen stimmt. Wut, die sich „hässlich“ anfühlt, hältst du zurück. Bis sie doch rauskommt.'],
  },
  Scorpio: {
    sun: ['Alles fühlen. Nichts zeigen.', 'Du suchst das Echte unter der Oberfläche und Vertrauen, das tief genug geht, um jemanden reinzulassen. Mars und Pluto herrschen über dein Zeichen: Mars kämpft, Pluto gräbt in die Tiefe. Du kämpfst nicht um alles. Du wartest auf den Moment, in dem es wirklich darauf ankommt, und dann handelst du entschlossen.'],
    rising: ['Du durchschaust andere. Sie dich nicht.', 'Die Leute spüren Intensität und Zurückhaltung, und Fassaden durchschaust du früh. Vertrauen braucht bei dir Zeit. Dann hält es.'],
    moon: ['Du vergisst nichts. Gar nichts.', 'Gefühle rauschen nicht einfach durch dich durch, du speicherst sie. Sicher fühlst du dich mit Tiefe und Loyalität, und Kontrolle schützt den weichen Kern.'],
  },
  Sagittarius: {
    sun: ['Kein Glück. Ein Gespür für Chancen.', 'Du suchst nach Sinn und erkennst Muster und Chancen früher als andere. Das Klischee ist die sorglose Partyreise. Das älteste Bild ist eine Gestalt mit gespanntem Bogen: jemand, der ein Ziel ins Auge fasst und die Wahrheit direkt ausspricht, manchmal schonungslos.'],
    rising: ['Lieber ehrlich als höflich.', 'Die Leute erleben deine Begeisterung und deine Direktheit im selben Moment. Bist du mit großen Plänen für die Zukunft beschäftigt, übersiehst du leicht den Menschen direkt neben dir.'],
    moon: ['Du brauchst Luft.', 'Sicher fühlst du dich, wenn das Leben Sinn hat und Weite vor dir liegt. Enge fühlt sich wie eine Bedrohung an. Konflikte sprichst du aus, und dann sind sie vorbei.'],
  },
  Capricorn: {
    sun: ['Auf Dauer angelegt.', 'Du baust, was hält, und kannst auf den Lohn warten. Das ursprüngliche Symbol ist halb Ziege, halb Fisch: der Aufstieg zum Gipfel und tiefe Gefühle unter der kühlen Oberfläche.'],
    rising: ['Beherrscht. Nicht kalt.', 'Du wirkst ernst und kompetent, und man überträgt dir früh Verantwortung. Die Kühle ist Kontrolle, keine Leere.'],
    moon: ['Liebe zeigst du durch Taten.', 'Gefühle zeigst du eher durch Handeln und Verlässlichkeit als durch Worte. Sicher fühlst du dich, wenn du alles im Griff hast, und von dir selbst verlangst du oft mehr als irgendwer sonst.'],
  },
  Aquarius: {
    sun: ['Nicht rebellisch. Unbequem ehrlich.', 'Du willst, dass es fair zugeht und alle ihren Platz haben, auch du, ohne dich dafür verbiegen zu müssen. Saturn und Uranus herrschen über dein Zeichen: Saturn baut Strukturen, Uranus bricht mit ihnen. Das Rebellische ist die moderne Hälfte. Die ältere Hälfte ist höflich, besonnen und schwer zu manipulieren.'],
    rising: ['Freundlich, mit Abstand.', 'Die Leute erleben deine Offenheit und deinen eigenen Kopf. Dazugehören fällt dir leicht, solange du darin nicht verschwinden musst.'],
    moon: ['Erst verstehen, dann fühlen.', 'Gefühle verarbeitest du, indem du sie verstehst, und deshalb bleibst du auch unter Druck fair. Nähe kann sich wie Kontrollverlust anfühlen, also wird Abstand zu deiner Sicherheit.'],
  },
  Pisces: {
    sun: ['Nicht schwach. Feinfühlig.', 'Du willst dich mit allem um dich herum verbunden fühlen: durch Kunst, durch Mitgefühl, durch das Gefühl, dass alles einen Sinn hat. Jupiter und Neptun herrschen über dein Zeichen: Jupiter glaubt, Neptun löst Grenzen auf. Aber feinfühlig heißt nicht passiv: Wenn dir etwas wirklich wichtig ist, kannst du überraschend zäh sein.'],
    rising: ['Bei dir fühlen sich Leute verstanden.', 'Du wirkst sanft und schwer greifbar, und Stimmungen spürst du, bevor jemand etwas sagt. Um Streit aus dem Weg zu gehen, sagst du die Wahrheit manchmal so vorsichtig, dass sie kaum noch ankommt.'],
    moon: ['Du spürst jede Stimmung im Raum.', 'Dein Gefühlsleben hat kaum Wände: Die Stimmung anderer wird schnell zu deiner. Du brauchst Zeit zum Treibenlassen und Träumen, und Rückzug ist dein Schutz.'],
  },
};
