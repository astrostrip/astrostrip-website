#!/usr/bin/env python3
"""Weekly Sun transits for every Sun degree, for the astro.strip calculator.

One JSON file per week (Monday to Sunday, German time) in public/data/transits/.
The calculator reads the visitor's Sun degree and shows the hits of the
current week. Rules follow astro.strip's weekly transit format:

- planets: Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Chiron
  (no Moon, no transiting Sun)
- major aspects only, no orb: a hit counts when the aspect point falls into
  the Sun's Sabian degree (0°00'-0°59' = degree 1)
- houses: whole signs from 0° of the Sun sign
- hourly grid from Monday 00:00 to Sunday 24:00, Europe/Berlin

Texts are written per hit and reused across weeks. Key: planet, the
transiting planet's Sabian degree (the fast planets too) and the house. The aspect follows from the house. Texts come from a
JSON file outside public/ and are copied into the week file only for the
hits of that week.

Usage (from the website folder, with pyswisseph installed):
    python3 tools/build-transits.py --from 2026-10-05 --weeks 65 \
        --ephe ../ephe --texts transits/texts.json --out public/data/transits
"""

import argparse
import datetime as dt
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import swisseph as swe

TZ = ZoneInfo('Europe/Berlin')
SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra',
         'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']
PLANETS = [  # name, Swiss Ephemeris id, fast (ranked after the slow ones)
    ('Mercury', swe.MERCURY, True), ('Venus', swe.VENUS, True), ('Mars', swe.MARS, True),
    ('Jupiter', swe.JUPITER, False), ('Saturn', swe.SATURN, False), ('Uranus', swe.URANUS, False),
    ('Neptune', swe.NEPTUNE, False), ('Pluto', swe.PLUTO, False), ('Chiron', swe.CHIRON, False),
]
# offset from the transiting degree to the Sun degree -> aspect
ASPECTS = {0: 'conjunction', 60: 'sextile', 300: 'sextile', 90: 'square', 270: 'square',
           120: 'trine', 240: 'trine', 180: 'opposition'}
# ranking inside a degree (format, section 4): conjunction > opposition/square > trine/sextile,
# slow > fast, whole week > part
ASPECT_RANK = {'conjunction': 0, 'opposition': 1, 'square': 1, 'trine': 2, 'sextile': 2}


def text_key(name, fast, deg):
    # every planet by its single Sabian degree, the fast ones too (Sandra, 04.10.2026);
    # until then Mercury, Venus and Mars were keyed by their five-degree group
    sign, d = SIGNS[deg // 30], deg % 30 + 1
    return f'{name}|{sign} {d}'


def local(t_utc):
    return t_utc.astimezone(TZ).strftime('%Y-%m-%dT%H:%M')


def week(monday, texts):
    start = dt.datetime.combine(monday, dt.time(0), TZ).astimezone(dt.timezone.utc)
    end = dt.datetime.combine(monday + dt.timedelta(days=7), dt.time(0), TZ).astimezone(dt.timezone.utc)
    hours = int((end - start).total_seconds() // 3600)  # 167 or 169 when the clocks change
    # per planet: list of stays in a Sabian degree [deg, first hour, last hour, directions]
    stays = {name: [] for name, _, _ in PLANETS}
    for i in range(hours + 1):
        t = start + dt.timedelta(hours=i)
        if t >= end:
            t = end - dt.timedelta(seconds=1)  # Sunday 23:59:59
        jd = swe.julday(t.year, t.month, t.day, t.hour + t.minute / 60 + t.second / 3600)
        for name, pid, _ in PLANETS:
            lon, _, _, speed = swe.calc_ut(jd, pid, swe.FLG_SWIEPH | swe.FLG_SPEED)[0][:4]
            deg = int(lon % 360)
            s = stays[name]
            if s and s[-1][0] == deg:
                s[-1][2] = t
                s[-1][3].add('R' if speed < 0 else 'D')
            else:
                s.append([deg, t, t, {'R' if speed < 0 else 'D'}])

    planets = []
    hits = {}
    used = {}
    for name, _, fast in PLANETS:
        rows = []
        for deg, t0, t1, dirs in stays[name]:
            motion = 'S' if len(dirs) == 2 else dirs.pop()  # S = station inside the degree
            whole = t0 == start and t1 >= end - dt.timedelta(seconds=1)
            rows.append({'deg': deg, 'from': local(t0), 'to': local(t1), 'motion': motion, 'whole': whole})
            key = text_key(name, fast, deg)
            for off, asp in ASPECTS.items():
                sun = (deg + off) % 360
                house = (deg // 30 - sun // 30) % 12 + 1
                k = f'{key}|H{house}'
                span = {'from': local(t0), 'to': local(t1), 'motion': motion}
                lst = hits.setdefault(sun, [])
                same = next((h for h in lst if h['key'] == k and h['deg'] == deg), None)
                if same:  # back in the same degree after a station
                    same['spans'].append(span)
                    continue
                lst.append({'planet': name, 'deg': deg, 'aspect': asp, 'house': house,
                            'fast': fast, 'whole': whole, 'key': k, 'spans': [span]})
                if k in texts:
                    used[k] = texts[k]
        planets.append({'planet': name, 'fast': fast, 'stays': rows})

    for lst in hits.values():
        lst.sort(key=lambda h: (ASPECT_RANK[h['aspect']], h['fast'], not h['whole'], h['spans'][0]['from']))

    return {
        'week': monday.isoformat(),
        'until': (monday + dt.timedelta(days=6)).isoformat(),
        'timezone': 'Europe/Berlin',
        'planets': planets,
        'hits': {str(k): v for k, v in sorted(hits.items())},
        'texts': dict(sorted(used.items())),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='first', required=True, help='a Monday, YYYY-MM-DD')
    ap.add_argument('--weeks', type=int, default=1)
    ap.add_argument('--ephe', default='../ephe')
    ap.add_argument('--texts', default='transits/texts.json')
    ap.add_argument('--out', default='public/data/transits')
    a = ap.parse_args()

    monday = dt.date.fromisoformat(a.first)
    if monday.weekday() != 0:
        raise SystemExit(f'{monday} is not a Monday')
    swe.set_ephe_path(a.ephe)
    tp = Path(a.texts)
    texts = json.loads(tp.read_text()) if tp.exists() else {}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for w in range(a.weeks):
        m = monday + dt.timedelta(weeks=w)
        data = week(m, texts)
        (out / f'{m.isoformat()}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        n = sum(len(v) for v in data['hits'].values())
        print(f'{m}  {n} hits on {len(data["hits"])} degrees, {len(data["texts"])} texts')


if __name__ == '__main__':
    main()
