import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('capture input keeps the default normalized API and optionally reads a supplied JSON without fetching',async()=>{
 const {loadCaptureInput}=await import('../scripts/capture-input.ts');
 let url='';const live=await loadCaptureInput([],async input=>{url=String(input);return new Response('{"contextKey":"public-normalized"}');});
 assert.equal(url,'http://127.0.0.1:8787/api/catalog?storeId=3330251&diningMode=pickup');assert.deepEqual(live,{contextKey:'public-normalized'});
 const dir=await mkdtemp(join(tmpdir(),'menu-capture-'));
 try{const file=join(dir,'normalized.json');await writeFile(file,'{"contextKey":"saved-normalized"}');assert.deepEqual(await loadCaptureInput(['--input',file],async()=>{throw new Error('no network');}),{contextKey:'saved-normalized'});}
 finally{await rm(dir,{recursive:true,force:true});}
 await assert.rejects(loadCaptureInput(['--env','.env.local'],async()=>{throw new Error('no network');}),/INVALID_CAPTURE_ARGUMENTS/);
});
