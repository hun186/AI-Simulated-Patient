import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('header runtime status uses dedicated dot/text classes and responsive wrapping',()=>{
  const html=readFileSync('index.html','utf8');
  const styles=readFileSync('styles.css','utf8');
  const formal=readFileSync('formal.css','utf8');

  assert.match(html,/class="status-dot" aria-hidden="true"/);
  assert.match(html,/id="runtimeStatus" class="status-text"/);

  assert.match(styles,/\.status-dot\{/);
  assert.match(styles,/\.status-text\{/);
  assert.doesNotMatch(styles,/\.status span\{/);

  assert.match(formal,/\.top-actions\{[^}]*flex-wrap:wrap/);
  assert.match(formal,/@media\(max-width:820px\)\{\.top-actions\{width:100%;justify-content:flex-start\}/);
  assert.match(formal,/\.status\{max-width:100%;white-space:normal\}/);
});
