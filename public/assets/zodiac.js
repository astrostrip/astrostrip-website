// Zodiac signs as thin line drawings (astro.strip line style), Aries to Pisces.
// Each path fits a 20 x 20 box centred on 0,0. Stroke only, no fill. Same drawings as the hero ring in index.html.
export const ZODIAC_PATHS = [
  "M-7,-1 C-8,-7 -2,-9 0,-3 C2,-9 8,-7 7,-1 M0,-3 L0,8", // aries
  "M-7,-8 C-6,-3 6,-3 7,-8 M0,3 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0", // taurus
  "M-7,-7.5 Q0,-4.5 7,-7.5 M-7,7.5 Q0,4.5 7,7.5 M-3.2,-5.6 L-3.2,5.6 M3.2,-5.6 L3.2,5.6", // gemini
  "M-8,-2 C-6,-8 4,-8 8,-3 M-4.5,-2.5 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0 M8,2 C6,8 -4,8 -8,3 M4.5,2.5 m-3,0 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0", // cancer
  "M-6,3 m-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0 M-3.4,3 C-3.4,-3 -3,-8 1.5,-8 C6,-8 6.5,-3 4,1 C2,4.5 3,8 6,7.5 C7.5,7.2 8,6 8,5", // leo
  "M-8,-5 L-8,6 M-8,-3 C-8,-7 -4,-7 -4,-3 L-4,6 M-4,-3 C-4,-7 0,-7 0,-3 L0,4 C0,8 5,8 7,3 C8,0 4,-1 3,2 C2,5 4,8 8,9", // virgo
  "M-8,7 L8,7 M-8,3 L-3.5,3 C-6,1 -6,-6 0,-6 C6,-6 6,1 3.5,3 L8,3", // libra
  "M-8,-5 L-8,6 M-8,-3 C-8,-7 -4,-7 -4,-3 L-4,6 M-4,-3 C-4,-7 0,-7 0,-3 L0,5 C0,7 2,8 6,7.5 M4,5.5 L6.5,7.5 L4.5,9.8", // scorpio
  "M-7,7 L7,-7 M0,-7 L7,-7 L7,0 M-5,-1 L1,5", // sagittarius
  "M-8,-6 L-5,5 L-2,-6 C-1,-8 3,-8 3,-4 L3,4 C3,8 8,8 8,4 C8,1 4,0 3,4 C2,8 -1,9 -3,8", // capricorn
  "M-8,-1 L-5,-4 L-2,-1 L1,-4 L4,-1 L7,-4 M-8,5 L-5,2 L-2,5 L1,2 L4,5 L7,2", // aquarius
  "M-6,-8 C-1,-4 -1,4 -6,8 M6,-8 C1,-4 1,4 6,8 M-5,0 L5,0", // pisces
];

// Inline icon for text (tables): 1em square, inherits the text colour.
export const signIcon = i => `<svg class="sign-icon" viewBox="-10 -10 20 20" aria-hidden="true"><path d="${ZODIAC_PATHS[i]}"/></svg>`;
