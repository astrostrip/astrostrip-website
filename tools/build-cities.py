#!/usr/bin/env python3
"""Builds public/data/cities.js from GeoNames (CC BY 4.0).

Worldwide all places with >= 15,000 inhabitants (cities15000) plus Germany, Austria and
Switzerland from 1,000 (cities1000), each with its IANA time zone. Latin-script alternate
names are kept (40 for cities >= 300k, 12 for >= 50k, else 3) so that "Hanover", "München"
or "Wien" are found.

Usage (downloads need network access to download.geonames.org):
    mkdir -p geo && cd geo
    curl -O https://download.geonames.org/export/dump/cities15000.zip
    curl -O https://download.geonames.org/export/dump/cities1000.zip
    curl -o ci.txt https://download.geonames.org/export/dump/countryInfo.txt
    curl -o a1.txt https://download.geonames.org/export/dump/admin1CodesASCII.txt
    unzip -o cities15000.zip && unzip -o cities1000.zip
    python3 ../tools/build-cities.py   # writes cities.js here; copy to public/data/
"""
import json
import re

ctry = {}
for line in open('ci.txt', encoding='utf8'):
    if line.startswith('#'):
        continue
    p = line.rstrip('\n').split('\t')
    if len(p) > 4:
        ctry[p[0]] = p[4]

adm = {}
for line in open('a1.txt', encoding='utf8'):
    p = line.rstrip('\n').split('\t')
    adm[p[0]] = p[1]

rows = {}
latin = re.compile(r"^[A-Za-zÀ-ɏ' .\-]+$")


def add(path, dach_only):
    for line in open(path, encoding='utf8'):
        p = line.rstrip('\n').split('\t')
        gid, name, asc, alts, lat, lon, fc, fcode, cc, _, a1 = p[:11]
        pop = int(p[14] or 0)
        tz = p[17]
        if dach_only and cc not in ('DE', 'AT', 'CH'):
            continue
        if fc != 'P' or not tz or fcode in ('PPLX', 'PPLH', 'PPLQ', 'PPLW'):
            continue
        lim = 40 if pop >= 300000 else 12 if pop >= 50000 else 3
        al = []
        for a in alts.split(','):
            if a and a != name and a != asc and latin.match(a) and not a.isupper() and len(a) < 30 and a not in al:
                al.append(a)
        rows[gid] = (name, asc if asc != name else '', '|'.join(al[:lim]), adm.get(cc + '.' + a1, ''),
                     ctry.get(cc, cc), round(float(lat), 4), round(float(lon), 4), tz, pop)


add('cities15000.txt', False)
add('cities1000.txt', True)

tzs = sorted({r[7] for r in rows.values()})
tzi = {t: i for i, t in enumerate(tzs)}
cs = sorted({r[4] for r in rows.values()})
ci = {c: i for i, c in enumerate(cs)}
out = sorted(rows.values(), key=lambda r: -r[8])  # by population, the search relies on this order
lines = ['\t'.join([r[0], r[1], r[2], r[3], str(ci[r[4]]), str(r[5]), str(r[6]), str(tzi[r[7]]), str(r[8])]) for r in out]
data = {'tz': tzs, 'c': cs, 'rows': '\n'.join(lines)}
open('cities.js', 'w', encoding='utf8').write('window.ASTRO_CITIES=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(out), 'places')
