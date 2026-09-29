import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

/** A subprocess diagnostic is progress only; it never establishes verification PASS. */
function diagnostic(line){
  if(!line.startsWith('M4KE_DIAGNOSTIC ')||line.length>4096)return null;
  try{
    const d=JSON.parse(line.slice(16));
    if(d.schemaVersion!==1||!Number.isSafeInteger(d.sequence)||d.sequence<1||typeof d.phase!=='string'||d.phase.length>64||typeof d.operation!=='string'||d.operation.length>180||!['RUNNING','COMPLETE','ERROR'].includes(d.status)||d.verificationEvidence!==false||!Number.isFinite(d.elapsedMs)||d.elapsedMs<0)return null;
    return {schemaVersion:1,sequence:d.sequence,phase:d.phase,operation:d.operation,status:d.status,elapsedMs:d.elapsedMs,verificationEvidence:false,...Number.isFinite(d.durationMs)&&d.durationMs>=0?{durationMs:d.durationMs}:{}};
  }catch{return null;}
}

/** No shell, bounded capture, whole-process-group termination, retained failure diagnostics. */
export function runProcess(executable,args,{cwd,timeout=180000,maxBytes=1048576,signal}={}){
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>3600000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16777216)throw new TypeError('Invalid bounded process limits.');
  return new Promise((resolve,reject)=>{
    const started=performance.now();let captured=0,lastDiagnostic=null,reason=null,settled=false,fallback;
    const buffers={out:[],err:[]},decoders={out:new StringDecoder('utf8'),err:new StringDecoder('utf8')},pending={out:'',err:''};
    const child=spawn(executable,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
    const details=()=>({stdout:Buffer.concat(buffers.out).toString('utf8'),stderr:Buffer.concat(buffers.err).toString('utf8'),elapsedMs:Math.round(performance.now()-started),lastDiagnostic});
    function finish(code,exitSignal){
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(fallback);signal?.removeEventListener('abort',abort);
      const capturedResult=details();
      if(reason)reject(Object.assign(new Error(reason.message),{code:reason.code,status:reason.status,exitCode:code,signal:exitSignal,...capturedResult}));
      else resolve({code,signal:exitSignal,...capturedResult});
    }
    function stop(code,message,status){
      if(reason||settled)return;reason={code,message,status};
      try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{/* Child may already have exited; close still drains captured output. */}
      fallback=setTimeout(()=>finish(null,'SIGKILL'),2000);fallback.unref();
    }
    const abort=()=>stop('PROCESS_ABORTED','Local operation was cancelled.',499);
    const timer=setTimeout(()=>stop('PROCESS_TIMEOUT','Local operation exceeded its time limit.',504),timeout);
    for(const [stream,key] of [[child.stdout,'out'],[child.stderr,'err']])stream.on('data',chunk=>{
      const decoded=decoders[key].write(chunk);pending[key]+=decoded;
      let newline;
      while((newline=pending[key].indexOf('\n'))>=0){
        const line=pending[key].slice(0,newline);pending[key]=pending[key].slice(newline+1);
        const value=diagnostic(line);if(value)lastDiagnostic=value;
      }
      if(pending[key].length>4096)pending[key]='';
      const remaining=Math.max(0,maxBytes-captured);
      if(remaining){const bytes=chunk.subarray(0,remaining);buffers[key].push(bytes);captured+=bytes.length;}
      if(chunk.length>remaining)stop('PROCESS_OUTPUT_LIMIT','Local diagnostic output exceeded its limit.',502);
    });
    child.once('error',error=>{if(!reason)reason={code:error.code||'PROCESS_SPAWN_ERROR',message:'Local operation could not start.',status:503};finish(null,null);});
    child.once('close',(code,exitSignal)=>finish(code,exitSignal));
    if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
  });
}
