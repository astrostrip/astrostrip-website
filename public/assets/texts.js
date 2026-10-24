// Big Three texts for the calculator result.
// Source: reference/tierkreiszeichen.md (Archetyp, Stärken, Schatten, Klischee-Check).
// Tone: astro.strip (context/branddesign.md) - sharp, psychological, no healing vocabulary.
// Scorpio, Aquarius, Pisces: traditional ruler first, modern second, each explained in plain words (Sandra, 16.09.2026).
// No author names, no unexplained jargon (Sandra, 06.10.2026). Check: node tools/check-texts.mjs

export const ROLES = {
  rising: { label: 'RISING', role: 'FIRST IMPRESSION' },
  sun: { label: 'SUN', role: 'CORE IDENTITY' },
  moon: { label: 'MOON', role: 'EMOTIONAL PATTERN' },
};

export const TEXTS = {
  Aries: {
    sun: ['Built to start.', 'You find out who you are by doing, not by waiting. Behind the speed there is often fear, and your courage is real because it overrides that fear, not because there is none.'],
    rising: ['Speed first. Then you.', 'People meet your speed before they meet you: direct, quick, allergic to games. What they don’t see: staying busy also keeps you from sitting still with what you feel.'],
    moon: ['Feels it, says it, done.', 'Anger comes out fast and rarely turns into a grudge. What really rattles you is being stuck. Movement is how you feel safe.'],
  },
  Taurus: {
    sun: ['Not slow. Selective.', 'You turn effort into things that are useful and last, like a home, savings or a skill you’ve built over years. Lazy is the cliché: Taurus is the one who actually gets the work done. You just won’t move without a good reason.'],
    rising: ['Calm is what people read first.', 'You come across steady and hard to push, and pressure tends to run out of breath before you do. Behind the calm sits a lot you never say out loud.'],
    moon: ['Safety you can touch.', 'You feel secure through what is tangible: routines, people who stay, things that are real. Anger gets swallowed for a long time. And then it doesn’t.'],
  },
  Gemini: {
    sun: ['Not two-faced. Two-sided.', 'You make sense of the world by comparing, naming, connecting. In the myth the twins never betrayed each other. Your two sides are the light one and the heavier one you rarely show.'],
    rising: ['Three topics ahead.', 'People meet your mind first: fast, funny, easy to talk to. When something gets too close, you make a joke, and it often hits exactly the sore spot, yours or someone else’s.'],
    moon: ['Feelings, translated into words.', 'You process emotion by talking, reading, understanding. You need room to move, and the darker, brooding phases usually stay hidden.'],
  },
  Cancer: {
    sun: ['Soft is the wrong word.', 'You protect what belongs to you and you don’t give up ground. The homebody is the cliché: Cancer is ambitious and at ease in public life. The shell exists so the inside can stay soft.'],
    rising: ['Careful first. Then warm.', 'You come across warm but guarded, and you read a room before you step into it. You approach problems sideways, which is exactly why you see angles others miss.'],
    moon: ['Where am I safe, and who is mine?', 'Your emotional life runs on belonging and memory. The past never fully leaves. When you feel exposed, you tend to withdraw rather than fight.'],
  },
  Leo: {
    sun: ['The proudest sign doubts.', 'You want to be seen as who you really are, not as the role. Behind the big gesture there is often a quieter question: is this enough?'],
    rising: ['Presence before a single word.', 'People notice you, and they notice your warmth: direct, loyal, no games. Criticism lands harder than you let anyone see.'],
    moon: ['Needs to be felt, not flattered.', 'You feel safe when your warmth is received and what you give is actually seen. Flattery doesn’t reach you. You need people who really respond to you, not applause.'],
  },
  Virgo: {
    sun: ['Practical, not perfect.', 'You sort, refine and fix the small thing before it becomes the big one. Virgo originally meant a woman who belongs to herself. Not prim. Your own.'],
    rising: ['You notice what’s off. Instantly.', 'People meet your precision first: clear, useful, a little reserved. The critic they sense is usually aimed at yourself first.'],
    moon: ['Calm comes from order.', 'You feel safe when things make sense and work. When they don’t, worry takes over, and you often feel it in your gut before you can name it.'],
  },
  Libra: {
    sun: ['Not balanced. Weighing.', 'You evaluate: what is fair, what fits, what is true between you and everyone else. Harmony isn’t a mood for you, it’s something you build with rules and patience, sometimes against the current.'],
    rising: ['The smile isn’t agreement.', 'You come across graceful and diplomatic, and people often end up thinking your idea was theirs. Underneath sits a strong will to get your way, one of the most underestimated in the zodiac.'],
    moon: ['Peace, at a price.', 'You feel safe when things between people are right. Anger that feels “ugly” gets held back. Until it isn’t.'],
  },
  Scorpio: {
    sun: ['Feels everything. Shows nothing.', 'You want what is real under the surface, and someone you can trust enough to let in. Ruled by Mars and Pluto: Mars fights, Pluto digs deep. You don’t fight every battle. You wait for the moment that really matters, and then you act decisively.'],
    rising: ['You read people. They can’t read you.', 'People sense intensity and reserve, and you see through pretence early. Trust is earned slowly. Then it holds.'],
    moon: ['Nothing is just forgotten.', 'Feelings don’t pass through you, they are stored. You feel safe with depth and loyalty, and control is how you protect the soft part.'],
  },
  Sagittarius: {
    sun: ['Not lucky. Good at spotting chances.', 'You look for meaning and see the pattern, and the opportunity, before others do. The cliché is the carefree party traveller. The oldest symbol is a figure with a drawn bow: someone who takes aim and says the truth straight out, sometimes harshly.'],
    rising: ['Honest before polite.', 'People meet your enthusiasm and your bluntness at the same time. When you’re busy with big plans for the future, you can easily overlook the person right next to you.'],
    moon: ['Needs room to breathe.', 'You feel safe when life has meaning and space ahead. Narrowness feels like a threat. Conflict gets said out loud, and then it’s over.'],
  },
  Capricorn: {
    sun: ['Built to last.', 'You build what holds over time, and you can wait for the reward. The original symbol is half goat, half fish: the climb to the top, and deep feelings under the cool surface.'],
    rising: ['Composed. Not cold.', 'You come across serious and capable, and people hand you responsibility early. The coolness is control, not emptiness.'],
    moon: ['Care, shown by doing.', 'You show feeling through action and reliability more than words. You feel safe in control, and you often expect more of yourself than anyone else would.'],
  },
  Aquarius: {
    sun: ['Not a rebel. A truth-teller.', 'You want things to be fair and everyone to have a place, you included, without having to give up who you are. Ruled by Saturn and Uranus: Saturn builds structure, Uranus breaks with it. The rebel is the modern half. The older half is courteous, measured and hard to manipulate.'],
    rising: ['Friendly, from a distance.', 'People meet your openness and your independent mind. Belonging is easy for you, as long as you don’t have to disappear into it.'],
    moon: ['Understands feelings first.', 'You process emotion by understanding it, which keeps you fair under pressure. Closeness can feel like losing control, so distance becomes your safety.'],
  },
  Pisces: {
    sun: ['Not weak. Sensitive.', 'You want to feel connected to everything around you, through art, compassion and a sense of meaning. Ruled by Jupiter and Neptune: Jupiter believes, Neptune dissolves borders. But sensitive isn’t passive: when something really matters to you, you can be surprisingly tough.'],
    rising: ['People feel understood around you.', 'You come across gentle and hard to pin down, and you pick up moods before anyone speaks. To avoid a clash, you sometimes say the truth so gently that it barely comes across.'],
    moon: ['Feels what the room feels.', 'Your emotional life has few walls: other people’s moods easily become your own. You need time to drift and dream, and withdrawal is how you protect yourself.'],
  },
};
