// SPDX-License-Identifier: GPL-2.0-or-later
// Tests of the documentation's link check (scripts/docs/check-links.mjs): the
// anchors it expects for a heading must be the ones GitHub gives it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { githubSlug, markdownAnchors } from './docs/check-links.mjs';

test('a heading becomes the anchor GitHub gives it', () => {
  assert.equal(githubSlug('How this guide is checked'), 'how-this-guide-is-checked');
  assert.equal(githubSlug('libxml2 (compiled into lxml)'), 'libxml2-compiled-into-lxml');
  assert.equal(githubSlug('**Bold** and `code`'), 'bold-and-code');
  assert.equal(githubSlug('[A link](https://example.org/) in it'), 'a-link-in-it');
});

test('an underscore inside a word stays, emphasis markers go', () => {
  // THIRD_PARTY_NOTICES.md links its "#### et_xmlfile" heading as #et_xmlfile.
  assert.equal(githubSlug('et_xmlfile'), 'et_xmlfile');
  assert.equal(githubSlug('snake_case_name'), 'snake_case_name');
  assert.equal(githubSlug('_emphasis_ here'), 'emphasis-here');
  assert.equal(githubSlug('a __b__ c'), 'a-b-c');
});

test('repeated headings are numbered, and explicit anchors count', () => {
  const anchors = markdownAnchors('# Notes\n\n## Notes\n\n#### et_xmlfile\n\n<a id="custom"></a>\n');
  assert.deepEqual([...anchors].sort(), ['custom', 'et_xmlfile', 'notes', 'notes-1']);
});
