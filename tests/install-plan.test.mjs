import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInstallPlan, renderTemplate, shellQuote } from '../scripts/install-plan.mjs';

const input = { prefix: '/tmp/winv-test/.local', configDir: '/tmp/winv-test/.config', version: '1.0.1' };
test('plan is user-specific and does not enable autostart implicitly', () => {
  const plan = createInstallPlan(input);
  assert.equal(plan.directory, '/tmp/winv-test/.local/lib/winv-clipboard/1.0.1');
  assert.equal(plan.files.length, 3);
  assert.equal(createInstallPlan({ ...input, autostart: true }).files.length, 4);
});
test('shell quoting round-trips spaces, apostrophes, dollars and backticks', () => {
  const text = "/tmp/a b/'quote/$dollar/`backtick`";
  assert.equal(execFileSync('/bin/sh', ['-c', 'printf %s ' + shellQuote(text)], { encoding: 'utf8' }), text);
});
test('unsafe paths and version traversal are rejected', () => {
  for (const prefix of ['relative', '/tmp/a\nb', '/tmp/*', '/tmp/{a,b}']) {
    assert.throws(() => createInstallPlan({ ...input, prefix }));
  }
  assert.throws(() => createInstallPlan({ ...input, version: '../outside' }));
});
test('all templates render and launcher syntax is valid', async () => {
  const plan = createInstallPlan({ ...input, prefix: "/tmp/some one's/.local", autostart: true });
  for (const file of plan.files) {
    const template = await readFile(new URL('../assets/templates/' + file.template, import.meta.url), 'utf8');
    const rendered = renderTemplate(template, plan.replacements);
    assert.doesNotMatch(rendered, /@[A-Z_]+@/);
    if (file.mode === 0o755) execFileSync('/bin/sh', ['-n'], { input: rendered });
  }
});
test('missing template fields fail instead of producing broken launchers', () => {
  assert.throws(() => renderTemplate('@MISSING@', {}));
});
