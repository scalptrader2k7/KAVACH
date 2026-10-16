import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
mkdirSync('.arena',{recursive:true});
const compiled=spawnSync(process.execPath,['node_modules/esbuild/bin/esbuild','web/src/editor.ts','--format=esm','--platform=node','--outfile=.arena/editor-test.mjs'],{encoding:'utf8'});
if(compiled.status!==0)throw Error(compiled.stderr);
const {formatEditorJSON}=await import(pathToFileURL(path.resolve('.arena/editor-test.mjs')).href);
for(const [name,raw] of [
 ['duplicate envelope','{"version":1,"version":2}'],
 ['duplicate nested payload','{"payload":{"mode":"NORMAL","mode":"SAFE"}}'],
 ['duplicate escaped spelling','{"mode":1,"m\\u006fde":2}'],
 ['duplicate within array','[{"x":1,"x":2}]'],
])test(name,()=>{const r=formatEditorJSON(raw);assert.equal(r.text,raw);assert.equal(r.changed,false);assert.match(r.warning,/Duplicate JSON key/)});
for(const raw of ['{not-json}','{"payload":','', '{"x":"unterminated}', '{"x":NaN}'])test('malformed input is unchanged '+raw,()=>{const r=formatEditorJSON(raw);assert.equal(r.text,raw);assert.equal(r.changed,false);assert.match(r.warning,/Malformed JSON/)});
test('format changes whitespace only, never value tokens or signature',()=>{
 const raw=' {"payload":{"mode":"SAFE"}, "auth_tag":"abc", "n":9007199254740993, "decimal":1e+3, "text":"a\\nb", "empty":{} } ';
 const r=formatEditorJSON(raw);assert.equal(r.warning,null);assert.equal(r.changed,true);assert.match(r.text,/9007199254740993/);assert.match(r.text,/1e\+3/);assert.match(r.text,/"auth_tag": "abc"/);assert.deepEqual(JSON.parse(r.text),JSON.parse(raw));
 const again=formatEditorJSON(r.text);assert.equal(again.changed,false);assert.equal(again.text,r.text);
});
test('same key in different objects is allowed',()=>{assert.equal(formatEditorJSON('{"a":{"x":1},"b":{"x":2}}').warning,null)});
test('oversized attack input is never reformatted',()=>{const raw=' '.repeat(8193)+'{}';assert.equal(formatEditorJSON(raw).text,raw);assert.match(formatEditorJSON(raw).warning,/8 KiB/)});
