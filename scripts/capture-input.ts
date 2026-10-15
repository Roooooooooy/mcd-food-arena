import {readFile} from 'node:fs/promises';
/** Inputs must already be normalized; capture-demo applies the same recursive whitelist to both. */
export async function loadCaptureInput(args:string[],fetcher:typeof fetch=fetch):Promise<unknown>{
 if(args.length){
  if(args.length!==2||args[0]!=='--input'||!args[1].endsWith('.json'))throw new Error('INVALID_CAPTURE_ARGUMENTS');
  return JSON.parse(await readFile(args[1],'utf8'));
 }
 const response=await fetcher('http://127.0.0.1:8787/api/catalog?storeId=3330251&diningMode=pickup',{signal:AbortSignal.timeout(70_000)});
 if(!response.ok)throw new Error('NORMALIZED_CATALOG_UNAVAILABLE');
 return response.json();
}
