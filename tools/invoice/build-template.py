"""Builds the invoice template for the Worker: website/src/invoice-template.js

The Worker (free plan, 10 ms CPU per request) cannot lay out a PDF or embed fonts. So everything
heavy happens here, once: an A4 page with the black header band and the logo, all fixed bilingual
labels, both fonts fully embedded, sRGB output intent and the Factur-X XMP metadata (PDF/A-3b).
The Worker then only appends an incremental update: one content stream with the variable text,
the factur-x.xml attachment, and new versions of the page and the catalog (src/invoice.js).

Run from the "Claude Gehirn" folder:  .venv/bin/python website/tools/invoice/build-template.py
Inputs:  website/tools/invoice/fonts/PlayfairDisplay-{Regular,Bold}.ttf (SIL Open Font License),
         website/tools/invoice/sRGB2014.icc (International Color Consortium, unchanged),
         material/astrostrip-logo-stripe.png (logo, not in the repository; only the template is).
Layout constants shared with the Worker are written into META (positions of the variable fields).
"""
import base64
import json
import re
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'website' / 'src' / 'invoice-template.js'
LOGO = ROOT / 'material' / 'astrostrip-logo-stripe.png'
FONTS = {'R': HERE / 'fonts' / 'PlayfairDisplay-Regular.ttf', 'B': HERE / 'fonts' / 'PlayfairDisplay-Bold.ttf'}
ICC = HERE / 'sRGB2014.icc'

W, H = 595.28, 841.89
LEFT, RIGHT = 40, 555.28
BLACK, INK, BRONZE, GOLD, CREME, GREY = (0.008, 0.008, 0.008), (0.11, 0.11, 0.11), (0.478, 0.361, 0.145), (0.788, 0.643, 0.361), (0.957, 0.922, 0.867), (0.42, 0.42, 0.42)

# Positions of the variable fields (PDF points, origin bottom left). The Worker reads them from META.
LAYOUT = {
    'buyer': {'x': LEFT, 'y': 660, 'step': 14},             # name (bold), then address lines
    'meta': {'x': 205, 'ys': [560, 545, 530, 515]},          # invoice no., invoice date, paid on, service period
    'row': {'y': 452, 'desc_y': 439, 'qty_x': 395, 'vat_x': 455, 'net_x': RIGHT},
    'totals': {'x': RIGHT, 'ys': [403, 388, 368, 350, 335]}, # net, VAT, total, paid, due
}


class Font:
    """Full TrueType program, Unicode -> glyph id and advance widths (1/1000 em)."""
    def __init__(self, path):
        self.data = path.read_bytes()
        self.f = fitz.Font(fontfile=str(path))
        self.cmap, self.widths = {}, {}
        for cp in self.f.valid_codepoints():
            gid = self.f.has_glyph(cp)
            if gid:
                self.cmap[cp] = gid
                self.widths[gid] = round(self.f.glyph_advance(cp) * 1000)
        self.fallback = self.cmap[ord('?')]

    def gids(self, s):
        return [self.cmap.get(ord(c), self.fallback) for c in s]

    def width(self, s, size, spacing=0):
        return sum(self.widths[g] for g in self.gids(s)) * size / 1000 + spacing * len(s)

    def hex(self, s):
        return ''.join(f'{g:04X}' for g in self.gids(s))


fonts = {k: Font(p) for k, p in FONTS.items()}


def text(x, y, s, font='R', size=9.5, color=INK, align='left', spacing=0):
    f = fonts[font]
    if align == 'right':
        x -= f.width(s, size, spacing)
    elif align == 'center':
        x -= f.width(s, size, spacing) / 2
    tc = f'{spacing:.2f} Tc '  # always set: Tc is graphics state and would carry over to the next text
    return f'BT /F{font} {size:g} Tf {tc}{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} rg 1 0 0 1 {x:.2f} {y:.2f} Tm <{f.hex(s)}> Tj ET\n'


def wrap(s, font, size, width):
    lines, line = [], ''
    for word in s.split(' '):
        test = (line + ' ' + word).strip()
        if fonts[font].width(test, size) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    lines.append(line)
    # no single word alone on the last line: take one word along from the line before
    if len(lines) > 1 and ' ' not in lines[-1] and ' ' in lines[-2]:
        head, last = lines[-2].rsplit(' ', 1)
        lines[-2:] = [head, last + ' ' + lines[-1]]
    return lines


def label(x, y, s, align='left'):
    return text(x, y, s.upper(), 'B', 6.8, BRONZE, align, spacing=0.6)


def rule(x1, y, x2, color=GOLD, w=0.6):
    return f'{color[0]:.3f} {color[1]:.3f} {color[2]:.3f} RG {w} w {x1:.2f} {y:.2f} m {x2:.2f} {y:.2f} l S\n'


# ---------- static page content ----------
crop = fitz.IRect(196, 76, 1072, 1072)  # visible logo area in pixels (circle, stars and wordmark)
logo_page = fitz.open(str(LOGO))[0]
px = logo_page.rect.width / fitz.Pixmap(str(LOGO)).width  # page points per image pixel
logo_crop = logo_page.get_pixmap(matrix=fitz.Matrix(1 / px, 1 / px), clip=fitz.Rect(crop) * px)
jpeg = logo_crop.tobytes('jpeg', jpg_quality=90)
band = 132
logo_h = 112
logo_w = logo_h * crop.width / crop.height

c = []
c.append(f'q {BLACK[0]:.3f} {BLACK[1]:.3f} {BLACK[2]:.3f} rg 0 {H - band:.2f} {W:.2f} {band:.2f} re f Q\n')
c.append(f'q {logo_w:.2f} 0 0 {logo_h:.2f} {LEFT - 6:.2f} {H - band + (band - logo_h) / 2:.2f} cm /Im1 Do Q\n')
c.append(text(RIGHT, H - 62, 'RECHNUNG · INVOICE', 'B', 17, CREME, 'right', spacing=1.2))
c.append(text(RIGHT, H - 80, 'Birth charts, stripped down.', 'R', 9.5, GOLD, 'right'))

c.append(label(LEFT, 675, 'Rechnungsempfänger · Billed to'))
c.append(label(330, 675, 'Von · From'))
for i, (s, f) in enumerate([('Sandra Willuweit · astro.strip', 'B'), ('Bundesweg 4', 'R'), ('20149 Hamburg, Deutschland', 'R'),
                             ('hello@astrostrip.com', 'R'), ('USt-IdNr. · VAT ID: DE317306093', 'R')]):
    c.append(text(330, 660 - 14 * i, s, f, 10 if f == 'B' else 9.5))

for y, s in zip(LAYOUT['meta']['ys'], ['Rechnungsnummer · Invoice no.', 'Rechnungsdatum · Invoice date', 'Bezahlt am · Paid on', 'Leistungszeitraum · Service period']):
    c.append(text(LEFT, y, s, 'R', 9, GREY))

c.append(rule(LEFT, 482, RIGHT))
c.append(label(LEFT, 470, 'Pos.'))
c.append(label(68, 470, 'Beschreibung · Description'))
c.append(label(LAYOUT['row']['qty_x'], 470, 'Menge · Qty', 'right'))
c.append(label(LAYOUT['row']['vat_x'], 470, 'Steuer · VAT', 'right'))
c.append(label(RIGHT, 470, 'Netto · Net', 'right'))
c.append(rule(LEFT, 463, RIGHT, GOLD, 0.4))
c.append(rule(LEFT, 425, RIGHT, GOLD, 0.4))

tl = 300
for y, s, f in zip(LAYOUT['totals']['ys'], ['Summe netto · Net total', 'USt 19 % · VAT 19 %', 'Gesamtbetrag · Total', 'Bereits bezahlt · Paid', 'Offener Betrag · Amount due'], 'RRBRR'):
    c.append(text(tl, y, s, f, 10.5 if f == 'B' else 9.5, INK if f == 'B' else GREY))
c.append(rule(tl, 380, RIGHT, GOLD, 0.6))

notes = [
    ('B', 'Hinweise · Notes'),
    ('R', 'Der Betrag wurde bei der Bestellung über Stripe bezahlt. Leistung: persönliches astrologisches Reading, als PDF per E-Mail geliefert.'),
    ('R', 'The amount was paid via Stripe when you ordered. Service: a personal astrology reading, delivered as a PDF by email.'),
    ('R', 'Die PDF ist eine E-Rechnung: Neben der sichtbaren Seite enthält sie die Rechnungsdaten als maschinenlesbare Datei (ZUGFeRD). Sie lässt sich wie jede PDF öffnen und drucken.'),
    ('R', 'The PDF is an e-invoice: besides the page you see, it contains the invoice data as a machine-readable file (ZUGFeRD). You can open and print it like any PDF.'),
]
y = 285
for f, s in notes:
    if f == 'B':
        c.append(label(LEFT, y, s))
        y -= 16
        continue
    for line in wrap(s, 'R', 7.6, RIGHT - LEFT):
        c.append(text(LEFT, y, line, 'R', 7.6, INK))
        y -= 10.6
    y -= 4

c.append(rule(LEFT, 62, RIGHT, GOLD, 0.5))
c.append(text(W / 2, 48, 'astro.strip · Sandra Willuweit · Bundesweg 4 · 20149 Hamburg · Deutschland', 'R', 7.8, GREY, 'center'))
c.append(text(W / 2, 37, 'hello@astrostrip.com · astrostrip.com · USt-IdNr. DE317306093', 'R', 7.8, GREY, 'center'))
static_stream = ('q\n' + ''.join(c) + 'Q\n').encode('latin-1')

# ---------- PDF objects ----------
doc = fitz.open()
page = doc.new_page(width=W, height=H)


def new_obj(dict_src, stream=None, compress=True):
    x = doc.get_new_xref()
    doc.update_object(x, dict_src)
    if stream is not None:
        doc.update_stream(x, stream, new=True, compress=compress)
    return x


def font_objects(key, f, name):
    ff = new_obj(f'<< /Length1 {len(f.data)} >>', f.data)
    ft = f.f
    asc, desc = round(ft.ascender * 1000), round(ft.descender * 1000)
    bb = ft.bbox
    fd = new_obj(f'<< /Type /FontDescriptor /FontName /{name} /Flags 34 /FontBBox [{round(bb.x0 * 1000)} {round(bb.y0 * 1000)} {round(bb.x1 * 1000)} {round(bb.y1 * 1000)}] '
                 f'/ItalicAngle 0 /Ascent {asc} /Descent {desc} /CapHeight 708 /StemV {120 if key == "B" else 80} /FontFile2 {ff} 0 R >>')
    gids = sorted(f.widths)
    w_arr = ' '.join(f'{g} [{f.widths[g]}]' for g in gids)
    cid = new_obj(f'<< /Type /Font /Subtype /CIDFontType2 /BaseFont /{name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
                  f'/FontDescriptor {fd} 0 R /DW 1000 /W [{w_arr}] /CIDToGIDMap /Identity >>')
    first = {}
    for cp, g in sorted(f.cmap.items()):
        first.setdefault(g, cp)
    entries = [f'<{g:04X}> <{cp:04X}>' for g, cp in sorted(first.items()) if cp <= 0xFFFF]
    blocks = ''.join(f'{len(entries[i:i + 100])} beginbfchar\n' + '\n'.join(entries[i:i + 100]) + '\nendbfchar\n' for i in range(0, len(entries), 100))
    cmap = ('/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
            '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' + blocks +
            'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n').encode('ascii')
    tu = new_obj('<< >>', cmap)
    return new_obj(f'<< /Type /Font /Subtype /Type0 /BaseFont /{name} /Encoding /Identity-H /DescendantFonts [{cid} 0 R] /ToUnicode {tu} 0 R >>')


fR = font_objects('R', fonts['R'], 'PlayfairDisplay-Regular')
fB = font_objects('B', fonts['B'], 'PlayfairDisplay-Bold')
img = new_obj(f'<< /Type /XObject /Subtype /Image /Width {logo_crop.width} /Height {logo_crop.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 >>', jpeg, compress=False)
doc.xref_set_key(img, 'Filter', '/DCTDecode')  # update_stream drops the filter; set it after the data
contents = new_obj('<< >>', static_stream)
icc = new_obj('<< /N 3 >>', ICC.read_bytes())

resources = f'<< /Font << /FR {fR} 0 R /FB {fB} 0 R >> /XObject << /Im1 {img} 0 R >> /ProcSet [/PDF /Text /ImageC] >>'
page_dict = f'<< /Type /Page /Parent {{parent}} /MediaBox [0 0 {W} {H}] /Resources {resources} /Contents {{contents}} >>'
parent = re.search(r'/Parent (\d+ 0 R)', doc.xref_object(page.xref)).group(1)
doc.update_object(page.xref, page_dict.replace('{parent}', parent).replace('{contents}', f'{contents} 0 R'))

XMP = '''<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Rechnung · Invoice astro.strip</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>astro.strip</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>'''
doc.set_metadata({})
doc.set_xml_metadata(XMP)
cat = doc.pdf_catalog()
doc.xref_set_key(cat, 'OutputIntents', f'[<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /Info (sRGB IEC61966-2.1) /DestOutputProfile {icc} 0 R >>]')
doc.xref_set_key(cat, 'Lang', '(de-DE)')

raw = doc.tobytes(garbage=3, deflate=True, use_objstms=0)
doc.close()

# ---------- read back what the Worker needs ----------
d = fitz.open('pdf', raw)
assert not d.is_repaired, 'template xref invalid'
cat = d.pdf_catalog()
pg = d[0].xref
trailer = d.xref_object(-1, compressed=True)
size = int(re.search(r'/Size (\d+)', trailer).group(1))
ids = re.findall(r'<([0-9A-Fa-f]+)>', re.search(r'/ID\s*\[(.*?)\]', trailer).group(1))
assert ids, 'template has no /ID'
assert '/Info' not in trailer, 'template must not have an Info dictionary'
startxref = int(re.search(rb'startxref\s+(\d+)\s+%%EOF\s*$', raw).group(1))
assert raw[startxref:startxref + 4] == b'xref', 'template must use a classic xref table'
catalog_dict = d.xref_object(cat, compressed=True)
page_obj = d.xref_object(pg, compressed=True)
assert '/Names' not in catalog_dict and '/AF' not in catalog_dict
contents_ref = re.search(r'/Contents (\d+ 0 R)', page_obj).group(1)
page_dict = page_obj.replace(f'/Contents {contents_ref}', '/Contents [' + contents_ref + ' {dyn} 0 R]')
d.close()

# pad so the template length is a multiple of 3: base64(template + update) = base64(template) + base64(update)
raw = raw.rstrip(b'\n') + b'\n'
while len(raw) % 3:
    raw += b'\n'

meta = {
    'length': len(raw), 'prevXref': startxref, 'size': size, 'root': cat, 'page': pg, 'id': ids[0],
    'catalog': catalog_dict, 'pageDict': page_dict,
    'fonts': {k: {'cmap': {str(cp): g for cp, g in f.cmap.items() if cp < 0x2FFF}, 'widths': {str(g): w for g, w in f.widths.items()}, 'fallback': f.fallback} for k, f in fonts.items()},
    'layout': LAYOUT, 'colors': {'ink': INK, 'grey': GREY},
}
js = ('// Generated by website/tools/invoice/build-template.py — do not edit by hand.\n'
      '// PDF/A-3b invoice template (logo, labels, embedded Playfair Display under the SIL Open Font License,\n'
      '// sRGB profile from the International Color Consortium). src/invoice.js appends the variable part.\n'
      f'export const TEMPLATE_META = {json.dumps(meta, ensure_ascii=False, separators=(",", ":"))};\n'
      f'export const TEMPLATE_B64 = "{base64.b64encode(raw).decode()}";\n')
OUT.write_text(js, encoding='utf-8')
print(f'{OUT.relative_to(ROOT)}: template {len(raw)} bytes, objects {size}, page {pg}, root {cat}, startxref {startxref}')
