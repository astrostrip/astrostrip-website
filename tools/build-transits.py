#!/usr/bin/env python3
"""Weekly Sun transits for every Sun degree, for the astro.strip calculator.

One JSON file per week (Monday to Sunday, German time) in public/data/transits/.
The calculator reads the visitor's Sun degree and shows the hits of the
current week. Rules follow astro.strip's weekly transit format:

- planets: Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto, Chiron
  (no Moon and no transiting Sun among the hits; Moon contacts to the slow planets are a separate list, below)
- major aspects only. Exact = the aspect point falls into the Sun's counted
  degree (0°00'-0°59' = degree 1). Orbs only while applying (Sandra, 05.10.2026):
  Mercury, Venus and Mars from 5 counted degrees before exact, Jupiter to Pluto
  and Chiron from 1 degree before, only inside the same sign (house and aspect
  stay the same). Once exact has passed, a fast planet is no longer mentioned;
  a slow planet that is only past exact this week gets status 'separating' and
  no text (the calculator shows one line on integration)
- one hit per Sun degree, planet and aspect: approach and exact stay together,
  the text is the one of the degree where the planet is exact (else the closest)
- houses: whole signs from 0° of the Sun sign
- hourly grid from Monday 00:00 to Sunday 24:00, Europe/Berlin

Texts are written per hit and reused across weeks. Key: planet, the
transiting planet's counted degree (the fast planets too) and the house. The aspect follows from the house. An applying
hit before exact (slow planets one degree, fast planets up to five) also reads the Sun degree and gets its own key with
the Sun degree added, so no text repeats across Sun degrees of one sign (Sandra, 05.10.2026; until then a fast planet's
approach reused the key of the degree it was in). Texts come from a
JSON file outside public/ and are copied into the week file only for the
hits of that week.

Moon contacts (Sandra, 09.10.2026, a deliberate exception to D24 / rule 10 "no Moon"): every major aspect of the
transiting Moon to Jupiter, Saturn, Uranus, Neptune, Pluto or Chiron whose exact moment falls in the week. Only the
24 hours before exact are the window in which it most likely shows (Sandra, 09.10.2026, consensus with Transit
Weekly; until then the applying hours of L15 pp. 14-15 and the day of exact): windowFrom/windowTo, cut to the week, and
a contact belongs to every week that holds at least 6 of its 24 hours [Claude's reading, put to Sandra]. A contact is the same for all Sun degrees of
a sign. Since 09.10.2026 (Sandra: "consider the house the Moon is in for the Sun and link both houses and degrees")
a text reads the Moon's counted degree and house with the slow planet's degree and house and the aspect, key
'Moon|<Moon sign> N|Planet|<sign> N|H<Moon house>|H<planet house>' (houses from the Sun sign, so one key per Sun
sign), from a second JSON file (moon-texts.json); the texts of all 12 Sun signs of a contact go into the week file.
Until then the key was 'Moon|Planet|Sign N|H<house>' without the Moon.

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
# slow > fast, exact > applying > separating, whole week > part
ASPECT_RANK = {'conjunction': 0, 'opposition': 1, 'square': 1, 'trine': 2, 'sextile': 2}
STATUS_RANK = {'exact': 0, 'applying': 1, 'separating': 2}
# applying orbs in counted degrees (Sandra, 05.10.2026): fast planets 5, slow planets and Chiron 1, inside the sign
FAST_ORB, SLOW_ORB = 5, 1


def text_key(name, fast, deg):
    # every planet by its single counted degree, the fast ones too (Sandra, 04.10.2026);
    # until then Mercury, Venus and Mars were keyed by their five-degree group
    sign, d = SIGNS[deg // 30], deg % 30 + 1
    return f'{name}|{sign} {d}'


def local(t_utc):
    return t_utc.astimezone(TZ).strftime('%Y-%m-%dT%H:%M')


def lon_at(t, pid):
    jd = swe.julday(t.year, t.month, t.day, t.hour + t.minute / 60 + t.second / 3600)
    return swe.calc_ut(jd, pid, swe.FLG_SWIEPH)[0][0]


def moon_contacts(start, end, moon_texts):
    """Moon aspects to the slow planets whose 24-hour window reaches into the week (Sandra, 09.10.2026), by time."""
    out = []
    stop = end + dt.timedelta(hours=24)  # exact early next Monday: the window still falls on this Sunday
    for name, pid, fast in PLANETS:
        if fast:
            continue
        for target in (0, 60, 90, 120, 180, 240, 270, 300):  # Moon minus planet at exact
            # signed distance to exact; the Moon gains about 13° a day, so one zero crossing a month per target
            gap = lambda t: (lon_at(t, swe.MOON) - lon_at(t, pid) - target + 180) % 360 - 180
            t, prev = start, gap(start)
            while t < stop:
                t1 = min(t + dt.timedelta(hours=1), stop)
                cur = gap(t1)
                if prev < 0 <= cur:
                    lo, hi = t, t1
                    while hi - lo > dt.timedelta(seconds=30):
                        mid = lo + (hi - lo) / 2
                        lo, hi = (mid, hi) if gap(mid) < 0 else (lo, mid)
                    inside = min(hi, end) - max(hi - dt.timedelta(hours=24), start)
                    if inside >= dt.timedelta(hours=6):
                        deg = int(lon_at(hi, pid) % 360)
                        mdeg = int(lon_at(hi, swe.MOON) % 360)
                        out.append({'planet': name, 'deg': deg, 'moonDeg': mdeg, 'aspect': ASPECTS[target],
                                    'exact': local(hi),
                                    'windowFrom': local(max(hi - dt.timedelta(hours=24), start)),
                                    'windowTo': local(min(hi, end - dt.timedelta(seconds=1))),
                                    'key': f"Moon|{text_key('Moon', False, mdeg)[5:]}|{text_key(name, False, deg)}"})
                t, prev = t1, cur
    out.sort(key=lambda c: c['exact'])
    used = {}
    for c in out:
        for k in moon_keys(c):
            if k in moon_texts:
                used[k] = moon_texts[k]
    return out, used


def moon_keys(c):
    # one text per Sun sign: Moon house and planet house both counted from the Sun sign
    return [f"{c['key']}|H{(c['moonDeg'] // 30 - si) % 12 + 1}|H{(c['deg'] // 30 - si) % 12 + 1}" for si in range(12)]


def week(monday, texts, moon_texts=None):
    start = dt.datetime.combine(monday, dt.time(0), TZ).astimezone(dt.timezone.utc)
    end = dt.datetime.combine(monday + dt.timedelta(days=7), dt.time(0), TZ).astimezone(dt.timezone.utc)
    hours = int((end - start).total_seconds() // 3600)  # 167 or 169 when the clocks change
    # per planet: list of stays in a counted degree [deg, first hour, last hour, directions]
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
    groups = {}  # (Sun degree, planet, aspect) -> parts of the approach
    for name, _, fast in PLANETS:
        rows = []
        reach = FAST_ORB if fast else SLOW_ORB
        for deg, t0, t1, dirs in stays[name]:
            motion = 'S' if len(dirs) == 2 else dirs.pop()  # S = station inside the degree
            whole = t0 == start and t1 >= end - dt.timedelta(seconds=1)
            rows.append({'deg': deg, 'from': local(t0), 'to': local(t1), 'motion': motion, 'whole': whole})
            for off, asp in ASPECTS.items():
                exact = (deg + off) % 360
                for k in range(-reach, reach + 1):
                    # k = degrees the planet still has to travel onto the Sun's degree: ahead of it when direct,
                    # behind it when retrograde, both at a station
                    sun = exact + k
                    if sun // 30 != exact // 30:  # the orb ends at the sign border
                        continue
                    applying = k == 0 or motion == 'S' or (k > 0) == (motion == 'D')
                    if not applying and fast:  # fast planets: after exactness no longer mentioned
                        continue
                    groups.setdefault((sun, name, asp), []).append(
                        {'k': k, 'deg': deg, 'fast': fast, 'whole': whole, 'applying': applying,
                         'span': {'from': local(t0), 'to': local(t1), 'motion': motion}})
        planets.append({'planet': name, 'fast': fast, 'stays': rows})

    hits = {}
    used = {}
    for (sun, name, asp), parts in groups.items():
        exacts = [x for x in parts if x['k'] == 0]
        before = [x for x in parts if x['k'] != 0 and x['applying']]
        if exacts:
            status, keep = 'exact', exacts + before
        elif before:
            status, keep = 'applying', before
        else:  # slow planets only: past exact, at most one line on integration (Sandra, 05.10.2026)
            status, keep = 'separating', parts
        keep.sort(key=lambda x: x['span']['from'])
        # the text is the one of the degree where the planet is exact, else the closest degree it reaches
        main = min(keep, key=lambda x: (abs(x['k']), x['span']['from']))
        deg, fast = main['deg'], main['fast']
        house = (deg // 30 - sun // 30) % 12 + 1
        key = f'{text_key(name, fast, deg)}|H{house}'
        if main['k']:  # an orb hit reads the Sun degree too, so it has its own text (fast planets since 05.10.2026)
            key += f'|Sun {SIGNS[sun // 30]} {sun % 30 + 1}'
        if status == 'separating':
            key = None
        spans = [dict(x['span'], k=x['k']) for x in keep]
        exact_from = exacts[0]['span']['from'] if exacts else None
        hits.setdefault(sun, []).append({
            'planet': name, 'deg': deg, 'aspect': asp, 'house': house, 'fast': fast, 'status': status,
            'orb': abs(main['k']), 'exactFrom': exact_from, 'key': key, 'spans': spans,
            'whole': spans[0]['from'] == local(start) and spans[-1]['to'] == local(end - dt.timedelta(seconds=1))})
        if key and key in texts:
            used[key] = texts[key]

    # Triggers (D24 from /transit, Sandra 06.10.2026: "the rule holds only for transits, wherever
    # transits are read"; L15 pp. 14-16): a slow transit on a Sun degree becomes tangible when a fast
    # planet touches the same degree. Mercury and Venus count on the day they are exact (L15: the day
    # before and the day of exact), Mars while applying or exact (felt about a week, often earlier),
    # any fast planet stationing in its orb (felt for weeks). The theme comes from the slow transit.
    # No Moon here (rule 10); Moon contacts to the slow planets are a separate list (rule 10a). Only added as
    # data; texts and ranking stay unchanged.
    for lst in hits.values():
        slow = [h for h in lst if not h['fast'] and h['status'] in ('exact', 'applying')]
        if not slow:
            continue
        trig = []
        for h in lst:
            if not h['fast']:
                continue
            station = any(s['motion'] == 'S' for s in h['spans'])
            if h['status'] == 'exact' or station or (h['planet'] == 'Mars' and h['status'] == 'applying'):
                trig.append({'planet': h['planet'], 'aspect': h['aspect'], 'exactFrom': h['exactFrom'],
                             'station': station})
        if trig:
            for h in slow:
                h['triggers'] = trig

    for lst in hits.values():
        # past exact always last: it is only a line on integration
        lst.sort(key=lambda h: (h['status'] == 'separating', ASPECT_RANK[h['aspect']], h['fast'], STATUS_RANK[h['status']], not h['whole'],
                                h['spans'][0]['from']))

    moon, moon_used = moon_contacts(start, end, moon_texts or {})
    used.update(moon_used)
    # Moon on the Sun degree (Sandra, 09.10.2026): a Moon contact to a slow planet that already hits this Sun degree,
    # with the Moon also in a major aspect to the Sun degree, is a trigger after D24 and marks the day it becomes
    # tangible. Own field, not 'triggers' (the calculator reads those as Mercury/Venus with the day before).
    for sun, lst in hits.items():
        for h in lst:
            if h['fast'] or h['status'] == 'separating':
                continue
            mt = [{'aspect': ASPECTS[(c['moonDeg'] - sun) % 360], 'exact': c['exact'], 'windowFrom': c['windowFrom'],
                   'windowTo': c['windowTo']} for c in moon
                  if c['planet'] == h['planet'] and (c['moonDeg'] - sun) % 360 in ASPECTS]
            if mt:
                h['moonTriggers'] = mt

    return {
        'week': monday.isoformat(),
        'until': (monday + dt.timedelta(days=6)).isoformat(),
        'timezone': 'Europe/Berlin',
        'orbs': {'fast': FAST_ORB, 'slow': SLOW_ORB, 'applyingOnly': True},
        'planets': planets,
        'hits': {str(k): v for k, v in sorted(hits.items())},
        'moon': moon,
        'texts': dict(sorted(used.items())),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='first', required=True, help='a Monday, YYYY-MM-DD')
    ap.add_argument('--weeks', type=int, default=1)
    ap.add_argument('--ephe', default='../ephe')
    ap.add_argument('--texts', default='transits/texts.json')
    ap.add_argument('--moon-texts', default='transits/moon-texts.json')
    ap.add_argument('--out', default='public/data/transits')
    a = ap.parse_args()

    monday = dt.date.fromisoformat(a.first)
    if monday.weekday() != 0:
        raise SystemExit(f'{monday} is not a Monday')
    swe.set_ephe_path(a.ephe)
    tp = Path(a.texts)
    texts = json.loads(tp.read_text()) if tp.exists() else {}
    mp = Path(a.moon_texts)
    moon_texts = json.loads(mp.read_text()) if mp.exists() else {}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for w in range(a.weeks):
        m = monday + dt.timedelta(weeks=w)
        data = week(m, texts, moon_texts)
        (out / f'{m.isoformat()}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        n = sum(len(v) for v in data['hits'].values())
        keys = {k for c in data['moon'] for k in moon_keys(c)}
        n_moon = sum(k in data['texts'] for k in keys)
        print(f'{m}  {n} hits on {len(data["hits"])} degrees, {len(data["texts"]) - n_moon} texts; '
              f'{len(data["moon"])} Moon contacts, {n_moon} of {len(keys)} Moon texts')


if __name__ == '__main__':
    main()
