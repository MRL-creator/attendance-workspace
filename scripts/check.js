import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Syntax checking is intentionally dependency-free for this plain-JavaScript app.
for(const folder of ['src','scripts','tests','tests/helpers','public']){
  for(const file of await readdir(new URL(`../${folder}/`,import.meta.url))){
    if(!file.endsWith('.js'))continue;
    const target=new URL(`../${folder}/${file}`,import.meta.url);
    const result=spawnSync(process.execPath,['--check',fileURLToPath(target)],{encoding:'utf8'});
    if(result.status!==0){process.stderr.write(result.stderr||String(result.error));process.exit(1);}
  }
}
console.log('JavaScript syntax checks passed.');
