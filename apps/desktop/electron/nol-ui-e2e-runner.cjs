'use strict';
/** Launch a fresh sandboxed Electron test runner, never the normal app. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const binary=require('electron');
const harness=path.join(__dirname,'nol-ui-e2e.cjs');
const fixture=path.join(__dirname,'../dist-nol-ui/nol-ui-fixture.html');
if(!fs.existsSync(fixture)){
  process.stderr.write('Offline NOL UI fixture not built. Run npm run build:ui:nol first.\n');
  process.exit(1);
}
const linux=process.platform==='linux';
const cmd=linux?'xvfb-run':binary;
const args=linux?['-a',binary,harness]:[harness];
const env={...process.env,
  ELECTRON_DISABLE_SECURITY_WARNINGS:'1',
  ELECTRON_ENABLE_LOGGING:'0'};
delete env.ELECTRON_RUN_AS_NODE;
const result=spawnSync(cmd,args,{
  cwd:path.join(__dirname,'..'),env,
  encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024
});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error)process.stderr.write('NOL UI runner: '+String(result.error)+'\n');
process.exit(result.status===0 && !result.error ? 0:1);
