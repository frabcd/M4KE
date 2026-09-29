import {createLanMonitor,PRINTER_MODELS} from '../printing/lan-monitor.mjs';

export function createPrinterService({body,json,operate=createLanMonitor()}){
  return async function handle(req,res,pathname){
    if(pathname==='/api/studio/printer'&&req.method==='GET'){
      json(res,200,{status:'NOT_CONFIGURED',models:PRINTER_MODELS,defaultPrinter:null,credentialsStored:false,readOnly:true,printSent:false,uploadSent:false,hardwareTested:false});return true;
    }
    const match=pathname.match(/^\/api\/studio\/printer\/(inspect|check)$/);
    if(!match||req.method!=='POST')return false;
    if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('Use application/json.'),{status:415});
    const input=await body(req,2048);
    // Input, access code and raw printer reports are never persisted or sent to Qwen.
    try{json(res,200,await operate(match[1],input));}
    finally{if(input&&typeof input==='object')input.accessCode='';}
    return true;
  };
}
