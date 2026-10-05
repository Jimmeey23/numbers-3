export async function load(url, context, nextLoad) {
  if (/\?worker/.test(url)) return { format: 'module', shortCircuit: true, source: 'export default class W { postMessage(){} terminate(){} addEventListener(){} };' };
  if (/\.(png|jpe?g|svg|css)(\?|$)/.test(url)) return { format: 'module', shortCircuit: true, source: 'export default "stub";' };
  const r = await nextLoad(url, context);
  if (r.source && /\/src\//.test(url)) {
    const src = r.source.toString().replaceAll('import.meta.env', '({MODE:"test",DEV:false,PROD:true})');
    return { ...r, source: src };
  }
  return r;
}
