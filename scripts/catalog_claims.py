"""Versioned, bounded manufacturer identity and technical-claim extraction.

HTML is data. Scripts, styles, attributes and unrelated product tables are not
technical evidence. No remote requests or code evaluation occur in this module.
"""
import hashlib
from html.parser import HTMLParser
import re

VERSION = 'manufacturer-technical-claims-v1'
MAX_HTML_BYTES = 2 * 1024 * 1024
# Reviewed normalized technical sections, not whole mutable pages. Any wording
# change, including negation, needs review rather than a substring-based PASS.
TECHNICAL_SECTION_SHA = {
    'driver-summary': '4310415e5fb753718ed26184b757ca8383a23071bee35c2f93974116db135d4f',
    'driver-thermal': 'f315f0967febe00de6bd242582af03f1904beb33f798e3ca6e8d599160ff7e95',
    'driver-overview': 'a574be7f1dd3ca8d8c1f5d8d3f2c5ba1ffce2f6583b086c5aa49109a8989d7f0',
    'wheel-summary': 'daf416703e78671a156c7eb103784f68ddc478d00be638ec710833078636b8af',
}
TITLES = {
    '2130': 'DRV8833 Dual Motor Driver Carrier',
    '992': '100:1 Micro Metal Gearmotor LP 6V',
    '1098': '50:1 Micro Metal Gearmotor LP 6V',
    '1086': 'Pololu Micro Metal Gearmotor Bracket Pair - White',
    '1420': 'Pololu Wheel 60×8mm Pair - Black',
    '950': 'Pololu Ball Caster with 3/8″ Plastic Ball',
}


def norm(text):
    return ' '.join(text.replace('\u200c', '').replace('\u200b', '').split())


class Node:
    def __init__(self, tag, attrs=None):
        self.tag, self.attrs, self.children = tag, dict(attrs or []), []

    def visible(self):
        style = self.attrs.get('style', '').lower()
        return (self.tag not in {'script', 'style', 'template', 'noscript'}
                and 'hidden' not in self.attrs and self.attrs.get('aria-hidden', '').lower() != 'true'
                and not re.search(r'(?:display\s*:\s*none|visibility\s*:\s*hidden)', style))

    def text(self):
        if not self.visible():
            return ''
        return norm(' '.join(x.text() if isinstance(x, Node) else x for x in self.children))

    def nodes(self, tag=None):
        for child in self.children:
            if isinstance(child, Node) and child.visible():
                if tag is None or child.tag == tag:
                    yield child
                yield from child.nodes(tag)


class Document(HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, raw):
        super().__init__(convert_charrefs=True)
        if not isinstance(raw, bytes) or not 1 <= len(raw) <= MAX_HTML_BYTES:
            raise ValueError('HTML byte bound')
        self.root = Node('document')
        self.stack, self.count = [self.root], 0
        self.feed(raw.decode('utf-8', errors='strict'))
        self.close()

    def handle_starttag(self, tag, attrs):
        self.count += 1
        if self.count > 40000 or len(self.stack) > 128:
            raise ValueError('HTML node/depth bound')
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)

    def one(self, predicate):
        found = [n for n in self.root.nodes() if predicate(n)]
        if len(found) != 1:
            raise ValueError('Expected exactly one identity/technical section')
        return found[0]

    def by_id(self, identity):
        return self.one(lambda n: n.attrs.get('id') == identity)


def required(pattern, text, label):
    found = list(re.finditer(pattern, text, re.I))
    if len(found) != 1:
        raise ValueError('Missing/ambiguous technical evidence: ' + label)
    return found[0]


def reviewed_section(key, text):
    if hashlib.sha256(text.encode()).hexdigest() != TECHNICAL_SECTION_SHA[key]:
        raise ValueError('Reviewed technical section changed: ' + key)


def section_after(doc, heading):
    nodes = list(doc.root.nodes())
    heads = [(i, n) for i, n in enumerate(nodes) if n.tag in {'h2', 'h3'} and n.text() == heading]
    if len(heads) != 1:
        raise ValueError('Missing/ambiguous heading: ' + heading)
    i, head = heads[0]
    texts = []
    for n in nodes[i + 1:]:
        if n.tag in {'h2', 'h3'}:
            break
        if n.tag == 'p':
            texts.append(n.text())
    text = norm(' '.join(texts))
    if not text or len(text) > 20000:
        raise ValueError('Technical section text bound')
    return text


def extract(name, raw):
    """Return identity, explicitly scoped claims and supplemental context.

    Values are extracted, not copied from expected historical metadata. A caller
    must compare them to the reference and bind this result to the raw SHA.
    """
    doc = Document(raw)
    result = {'extractorVersion': VERSION, 'rawSha256': hashlib.sha256(raw).hexdigest(),
              'sourceName': name, 'claims': {}, 'context': {}}
    m = re.fullmatch(r'pololu-(\d+)-product.html', name)
    if m:
        sku = m[1]
        title = doc.by_id('page_title').text()
        if sku not in TITLES or title != TITLES[sku]:
            raise ValueError('Manufacturer title/variant mismatch')
        contents = doc.by_id('contents')
        if contents.attrs.get('data-url') != '/product/' + sku:
            raise ValueError('Product contents identity mismatch')
        part = doc.one(lambda n: n.tag == 'td' and 'part_number' in n.attrs.get('class', '').split())
        if part.text() != 'Pololu item #: ' + sku:
            raise ValueError('Manufacturer SKU mismatch')
        result['identity'] = {'manufacturer': 'Pololu', 'sku': sku, 'title': title}
        summary = doc.by_id('short_description').text()
        result['context']['summarySha256'] = hashlib.sha256(summary.encode()).hexdigest()
        if sku in {'992', '1098'}:
            node = doc.by_id('short_description')
            tables = list(node.nodes('table'))
            type_tables = [t for t in tables if [n.text() for n in t.nodes('th')] == ['motor/brush type', 'gearbox', 'encoder']]
            perf_tables = [t for t in tables if [n.text() for n in t.nodes('th')] == ['voltage', 'no-load performance', 'stall extrapolation*']]
            if len(type_tables) != 1 or len(perf_tables) != 1:
                raise ValueError('Expected product-specific motor summary tables')
            types = [n.text() for n in type_tables[0].nodes('td')]
            values = [n.text() for n in perf_tables[0].nodes('td')]
            if len(types) == 4 and types[2] == '':
                types = types[:2] + types[3:]  # Manufacturer's empty encoder image cell.
            if len(types) != 3 or len(values) != 4 or types[0] != 'LP 6V: low-power 6V with precious metal brushes' or types[2] != 'no encoder':
                raise ValueError('Motor winding/brush/encoder variant changed')
            ratio = required(r'^(\d+(?:\.\d+)?):1 with brass plates$', types[1], 'gear ratio')
            voltage = required(r'^(\d+(?:\.\d+)?) V$', values[0], 'voltage')
            no_load = required(r'^(\d+) RPM, (\d+(?:\.\d+)?) mA$', values[1], 'no-load performance')
            stall = required(r'^(\d+(?:\.\d+)?) kg⋅cm \([\d.]+ oz⋅in\), (\d+(?:\.\d+)?) A$', values[2], 'stall extrapolation')
            if values[3] != '* Note: Stall torque and stall current specifications are theoretical values; stalls could damage the motor or gearbox.':
                raise ValueError('Theoretical stall/damage qualifier absent or changed')
            conditions = {'ratedVoltageV': float(voltage[1]), 'winding': 'LP', 'encoder': 'none',
                          'stall': 'theoretical extrapolation; stalls can damage motor or gearbox',
                          'speed': 'no-load, not loaded vehicle speed'}
            observed = {'voltageV': (float(voltage[1]), 'V'), 'gearRatio': (float(ratio[1]), 'ratio'),
                        'noLoadRpm': (float(no_load[1]), 'rpm'), 'noLoadCurrentA': (float(no_load[2]) / 1000, 'A'),
                        'theoreticalStallCurrentA': (float(stall[2]), 'A'), 'theoreticalStallTorqueKgfCm': (float(stall[1]), 'kgf*cm')}
            for key, (value, unit) in observed.items():
                result['claims'][key] = {'value': value, 'unit': unit, 'conditions': conditions,
                    'section': '#short_description table.reference (product-specific headers)',
                    'sectionSha256': hashlib.sha256((type_tables[0].text() + '\n' + perf_tables[0].text()).encode()).hexdigest()}
        elif sku == '2130':
            reviewed_section('driver-summary', summary)
            current = required(r'deliver ([\d.]+) A per channel continuously \(([\d.]+) A peak\)', summary, 'driver current')
            voltage = required(r'operating voltage range from ([\d.]+) V to ([\d.]+) V', summary, 'driver voltage')
            thermal = section_after(doc, 'Real-world power dissipation considerations')
            reviewed_section('driver-thermal', thermal)
            for qualifier in ['room temperature with no forced air flow', '100% duty cycle', 'PWMing the motor will introduce additional heating', '1.2–1.3 A per channel was sustainable for many minutes', 'depend on how well you can keep the motor driver cool']:
                if qualifier not in thermal:
                    raise ValueError('Driver thermal qualifier absent or changed: ' + qualifier)
            overview = section_after(doc, 'Overview')
            reviewed_section('driver-overview', overview)
            if 'peak currents up to 2 A per channel for a few seconds' not in overview:
                raise ValueError('Peak duration qualifier changed')
            observed = {'motorSupplyRangeV': ([float(voltage[1]), float(voltage[2])], 'V'),
                        'continuousCurrentPerChannelA': (float(current[1]), 'A'), 'peakCurrentPerChannelA': (float(current[2]), 'A')}
            for key, (value, unit) in observed.items():
                result['claims'][key] = {'value': value, 'unit': unit,
                    'conditions': {'thermal': 'room temperature; no forced airflow; 100% duty; cooling dependent; PWM adds heating', 'peakDuration': 'few seconds, not continuous'},
                    'section': '#short_description + Overview + Real-world power dissipation considerations',
                    'sectionSha256': hashlib.sha256((summary + thermal + overview).encode()).hexdigest()}
        elif sku == '1086':
            paragraphs = [n.text() for n in contents.nodes('p') if '#2-56' in n.text() and 'included' in n.text()]
            if paragraphs != ['Four #2-56×7/16" screws and four nuts are included.'] or 'Pair' not in title:
                raise ValueError('Bracket hardware/pair evidence changed')
            result['claims']['mounting-fasteners'] = {'value': {'thread': '#2-56', 'lengthInch': 7/16, 'countPerBracket': 4/2},
                'unit': 'fastener-specification', 'conditions': {'suppliedPerPair': 4, 'derivedPerBracket': 'four screws / two brackets; not a new screw geometry proof'},
                'section': 'product description supplied hardware paragraph + Pair title',
                'sectionSha256': hashlib.sha256(paragraphs[0].encode()).hexdigest()}
        elif sku == '1420':
            reviewed_section('wheel-summary', summary)
            fit = required(r'press-fit onto (\d+(?:\.\d+)?)mm D shafts', summary, 'wheel shaft compatibility')
            result['claims']['shaftDiameterMm'] = {'value': float(fit[1]), 'unit': 'mm',
                'conditions': {'fit': 'press-fit D shaft compatibility; not tolerance or physical fit proof'},
                'section': '#short_description', 'sectionSha256': hashlib.sha256(summary.encode()).hexdigest()}
        elif sku == '950':
            paragraphs = [n.text() for n in contents.nodes('p') if n.text().startswith('This ball caster kit includes')]
            if len(paragraphs) != 1:
                raise ValueError('Caster supplied-hardware context absent')
            for fragment in ['3/8″ diameter plastic ball', 'two spacers (1/16″ and 1/8″ thick)', 'two 7/16″ #2 screws and nuts', '0.4″', '0.6″']:
                if fragment not in paragraphs[0]:
                    raise ValueError('Caster context changed')
            result['context']['suppliedHardwareSectionSha256'] = hashlib.sha256(paragraphs[0].encode()).hexdigest()
    elif name == 'pico-resources.html':
        title = doc.one(lambda n: n.tag == 'h1').text()
        if title != 'Raspberry Pi Pico':
            raise ValueError('Pico family identity mismatch')
        expected = 'https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008311-DS-1-Pico-R3-step.zip'
        links = [n for n in doc.root.nodes('a') if n.attrs.get('href') == expected]
        if len(links) != 1 or links[0].attrs.get('title') != 'Download RP-008311-DS-1-Pico-R3-step.zip':
            raise ValueError('Pico exact R3 resource identity mismatch')
        result['identity'] = {'manufacturer': 'Raspberry Pi', 'sku': 'Pico RP2040 R3', 'title': title, 'revisionResource': expected}
    elif name == 'adafruit-1063-product.html':
        title = 'Electret Microphone Amplifier - MAX4466 with Adjustable Gain'
        names = [n.text() for n in doc.root.nodes('h1')]
        ids = [n.text() for n in doc.root.nodes('div') if n.attrs.get('class') == 'product_id']
        if not names or any(n != title for n in names) or not ids or any(n != 'Product ID: 1063' for n in ids):
            raise ValueError('Adafruit product/variant identity mismatch')
        technical = doc.by_id('technical-details').text()
        for value in ['Product PCB thickness - 1.60mm', 'Measurement including the Microphone - 7.8mm']:
            if value not in technical:
                raise ValueError('Microphone height context changed')
        result['identity'] = {'manufacturer': 'Adafruit', 'sku': '1063', 'title': title}
        result['context']['technicalSectionSha256'] = hashlib.sha256(technical.encode()).hexdigest()
    else:
        raise ValueError('No reviewed extractor for source')
    return result
