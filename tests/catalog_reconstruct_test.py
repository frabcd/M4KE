"""Synthetic reconstruction boundaries. Never download, activate or import CAD."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import catalog_claims as claims
import catalog_reconstruct as rebuild


def product(sku, summary, rest=''):
    return (f'<h1 id="page_title">{claims.TITLES[sku]}</h1>'
            f'<div id="contents" data-url="/product/{sku}"><table><tr><td class="part_number">'
            f'<span>Pololu item #:</span> <span>{sku}</span></td></tr></table>'
            f'<div id="short_description">{summary}</div>{rest}</div>').encode()


def motor(sku='1098', rpm=270, ratio=51.45, torque=.44):
    return product(sku, f'''<table class="reference"><tr><th>motor/brush type</th><th>gearbox</th><th>encoder</th></tr>
    <tr><td>LP 6V: low-power 6V with precious metal brushes</td><td>{ratio}:1 with brass plates</td><td></td><td>no encoder</td></tr></table>
    <table class="reference"><tr><th>voltage</th><th>no-load performance</th><th>stall extrapolation*</th></tr>
    <tr><td>6 V</td><td>{rpm} RPM, 40 mA</td><td>{torque} kg⋅cm (6.1 oz⋅in), 0.36 A</td></tr>
    <tr><td>* Note: Stall torque and stall current specifications are theoretical values; stalls could damage the motor or gearbox.</td></tr></table>''')


def driver():
    return product('2130', 'This carrier can deliver 1.2 A per channel continuously (2 A peak) with an operating voltage range from 2.7 V to 10.8 V.',
        '<h2>Overview</h2><p>It supports peak currents up to 2 A per channel for a few seconds.</p>'
        '<h3>Real-world power dissipation considerations</h3><p>Tests at room temperature with no forced air flow and 100% duty cycle. '
        'A continuous current of 1.2–1.3 A per channel was sustainable for many minutes; results depend on how well you can keep the motor driver cool. '
        'PWMing the motor will introduce additional heating.</p><h3>Included hardware</h3>')


class Claims(unittest.TestCase):
    def setUp(self):
        # Synthetic reviewed technical sections: production pins are NOT modified.
        # Mutations below are applied only after these known fixture hashes exist.
        document = claims.Document(driver())
        approved = {'driver-summary': document.by_id('short_description').text(),
                    'driver-thermal': claims.section_after(document, 'Real-world power dissipation considerations'),
                    'driver-overview': claims.section_after(document, 'Overview'),
                    'wheel-summary': 'Wheels press-fit onto 3mm D shafts.'}
        patches = patch.dict(claims.TECHNICAL_SECTION_SHA, {k: rebuild.digest(v.encode()) for k, v in approved.items()})
        patches.start();self.addCleanup(patches.stop)

    def test_motor_six_values_extracted_from_own_summary_and_conditions(self):
        data = claims.extract('pololu-1098-product.html', motor())
        self.assertEqual(len(data['claims']), 6)
        self.assertEqual(data['claims']['noLoadCurrentA']['value'], .04)
        self.assertEqual(data['claims']['gearRatio']['value'], 51.45)
        self.assertIn('not loaded', data['claims']['noLoadRpm']['conditions']['speed'])

    def test_other_variant_is_not_accepted(self):
        with self.assertRaisesRegex(ValueError, 'title/variant'):
            claims.extract('pololu-1098-product.html', motor('992', 130, 100.37, .74))

    def test_sku_identity_in_body_must_match(self):
        with self.assertRaisesRegex(ValueError, 'SKU'):
            claims.extract('pololu-1098-product.html', motor().replace(b'<span>1098</span>', b'<span>992</span>'))

    def test_wrong_encoder_and_missing_stall_warning_fail(self):
        for raw in (motor().replace(b'no encoder', b'with encoder'), motor().replace(b'stalls could damage', b'stalls never damage')):
            with self.assertRaises(ValueError):
                claims.extract('pololu-1098-product.html', raw)

    def test_changed_value_extracted_not_silently_restored(self):
        data = claims.extract('pololu-1098-product.html', motor(rpm=200) + b'<p>Related motor: 270 RPM, 40 mA.</p>')
        self.assertEqual(data['claims']['noLoadRpm']['value'], 200)

    def test_script_payload_cannot_supply_missing_technical_table(self):
        raw = motor().replace(b'<table class="reference">', b'<script><table class="reference">', 1).replace(b'</table>', b'</table></script>', 1)
        with self.assertRaises(ValueError):
            claims.extract('pololu-1098-product.html', raw)

    def test_inert_or_hidden_motor_table_cannot_be_evidence(self):
        for start,end in [(b'<template>',b'</template>'),(b'<noscript>',b'</noscript>'),
                          (b'<div hidden>',b'</div>'),(b'<div style="display:none">',b'</div>'),
                          (b'<div aria-hidden="true">',b'</div>')]:
            raw = motor().replace(b'<table class="reference">', start+b'<table class="reference">', 1).replace(b'</table>', b'</table>'+end, 1)
            with self.assertRaises(ValueError):
                claims.extract('pololu-1098-product.html', raw)

    def test_duplicate_identity_or_tables_fail(self):
        with self.assertRaises(ValueError):
            claims.extract('pololu-1098-product.html', motor() + b'<h1 id="page_title">Other</h1>')

    def test_driver_thermal_and_peak_qualifiers_required(self):
        result = claims.extract('pololu-2130-product.html', driver())
        self.assertEqual(result['claims']['motorSupplyRangeV']['value'], [2.7, 10.8])
        self.assertEqual(len(result['claims']), 3)
        for fragment in (b'no forced air flow', b'100% duty cycle', b'for a few seconds'):
            with self.assertRaises(ValueError):
                claims.extract('pololu-2130-product.html', driver().replace(fragment, b'other condition'))

    def test_negated_thermal_or_peak_cannot_reestablish_positive_claims(self):
        for old,new in [(b'Tests at room temperature',b'Tests were NOT at room temperature'),
                        (b'It supports peak currents',b'It does not support peak currents')]:
            with self.assertRaisesRegex(ValueError, 'technical section changed'):
                claims.extract('pololu-2130-product.html', driver().replace(old,new))

    def test_bracket_per_pair_count_is_explicit_derived(self):
        raw = product('1086', 'Bracket pair', '<p>Four #2-56×7/16" screws and four nuts are included.</p>')
        result = claims.extract('pololu-1086-product.html', raw)['claims']['mounting-fasteners']
        self.assertEqual(result['value'], {'thread': '#2-56', 'lengthInch': .4375, 'countPerBracket': 2})
        with self.assertRaises(ValueError):
            claims.extract('pololu-1086-product.html', raw.replace(b'Four #2', b'Two #2'))

    def test_wheel_circular_shaft_not_d_compatible(self):
        raw = product('1420', 'Wheels press-fit onto 3mm D shafts.')
        self.assertEqual(claims.extract('pololu-1420-product.html', raw)['claims']['shaftDiameterMm']['value'], 3)
        with self.assertRaises(ValueError):
            claims.extract('pololu-1420-product.html', raw.replace(b' D shafts', b' round shafts'))
        with self.assertRaises(ValueError):
            claims.extract('pololu-1420-product.html', raw.replace(b'press-fit onto', b'do not press-fit onto'))

    def test_oversized_html_and_unknown_source_refused(self):
        with self.assertRaises(ValueError):
            claims.extract('pololu-1098-product.html', b'x' * (claims.MAX_HTML_BYTES + 1))
        with self.assertRaises(ValueError):
            claims.extract('other.html', b'<h1>Other</h1>')


class Reconstruction(unittest.TestCase):
    def test_plan_pins_all_25_records_and_17_claims(self):
        original, plan, _, _ = rebuild.references(ROOT / 'catalog')
        self.assertEqual(len(plan), 25)
        self.assertEqual(len(rebuild.claim_nodes(original)), 17)

    def test_url_boundaries_reject_credentials_private_hosts_http_port(self):
        for url in ['http://www.pololu.com/product/1', 'https://127.0.0.1/x', 'https://www.pololu.com:444/x',
                    'https://user:secret@www.pololu.com/x', 'https://www.pololu.com.example.test/x']:
            with self.assertRaises(ValueError):
                rebuild.safe_url(url)
        self.assertEqual(rebuild.safe_url('https://www.pololu.com/product/2130'), 'https://www.pololu.com/product/2130')

    def test_github_fallback_has_only_four_exact_commit_paths(self):
        _, plan, _, _ = rebuild.references(ROOT / 'catalog')
        urls = [rebuild.fallback_url(record) for record in plan]
        self.assertEqual(sum(url is not None for url in urls), 4)
        self.assertTrue(all(('?ref=' + rebuild.ADAFRUIT_COMMIT) in url for url in urls if url))
        record = next(x for x in plan if x['name'] == 'adafruit-1063-readme.md')
        with self.assertRaises(ValueError):
            rebuild.fallback_url({**record, 'url': record['url'].replace(rebuild.ADAFRUIT_COMMIT, 'main')})

    def test_existing_and_nested_reference_output_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);reference = root / 'reference';reference.mkdir()
            for p in (reference, reference / 'nested', root):
                with self.assertRaises(ValueError):
                    rebuild.fresh_output(p, reference)
            candidate = rebuild.fresh_output(root / 'candidate', reference)
            self.assertTrue((candidate / 'observations').is_dir())

    def test_external_reference_cannot_target_missing_active_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);reference=root/'reference';reference.mkdir();code=root/'code';code.mkdir()
            self.assertFalse((code/'catalog').exists())
            with self.assertRaisesRegex(ValueError, 'active catalog'):
                rebuild.fresh_output(code/'catalog',reference,code)

    def test_reference_mutation_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'manifest.json').write_text('{}')
            (root / 'source-index.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Historical manifest'):
                rebuild.references(root)

    def test_missing_observations_no_claims_promoted_and_geometry_unchanged(self):
        original, _, _, _ = rebuild.references(ROOT / 'catalog')
        before = copy.deepcopy(original)
        with tempfile.TemporaryDirectory() as tmp:
            candidate, observations, reviews, failures = rebuild.reconstruct_manifest(original, [], Path(tmp))
        self.assertEqual(original, before)
        self.assertEqual(len(reviews), 17)
        self.assertTrue(all(r['status'] == 'REVIEW_REQUIRED' for r in reviews))
        self.assertEqual([c.get('geometry') for c in candidate['components']], [c.get('geometry') for c in original['components']])
        self.assertEqual(candidate['reconstruction']['activation'], 'NOT_REQUESTED')
        self.assertTrue(all(c['priceSnapshot'] is None and c['availabilitySnapshot'] is None for c in candidate['components']))

    def test_changed_claim_requires_review_even_when_other_values_match(self):
        original, plan, _, _ = rebuild.references(ROOT / 'catalog')
        record = next(x for x in plan if x['name'] == 'pololu-1098-product.html')
        raw = motor(rpm=200)
        record = {**record, 'sha256': rebuild.digest(raw), 'capturedAt': 'synthetic', 'status': 'PASS'}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);(root / 'sources').mkdir();(root / record['path']).write_bytes(raw)
            _, _, reviews, _ = rebuild.reconstruct_manifest(original, [record], root)
        own = [r for r in reviews if r['componentId'] == 'pololu-lp6v-1098']
        self.assertEqual(sum(r['status'] == 'REESTABLISHED' for r in own), 5)
        self.assertEqual(next(r for r in own if r['claimId'] == 'noLoadRpm')['status'], 'REVIEW_REQUIRED')


if __name__ == '__main__':
    unittest.main(verbosity=2)
