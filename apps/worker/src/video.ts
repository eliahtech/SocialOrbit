import {createClient} from '@supabase/supabase-js';
import {env} from '../../api/src/config.ts';
import {assert} from '../../api/src/http.ts';
import {buildClipArgs,validateClip,type Aspect} from '../../../packages/core/src/video.ts';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function run(command:string,args:string[],timeoutMs:number){return new Promise<string>((resolve,reject)=>{
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],shell:false});let errors='',output='';
 child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-1000)});
 child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-8000)});
 const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`${command} timed out`))},timeoutMs);
 child.on('error',err=>{clearTimeout(timer);reject(err)});child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output);else reject(Error(`${command} exit ${code}: ${errors.slice(-700)}`))});
})}
export async function runClipJob(id:string){
 const claim=await db.from('clip_projects').update({status:'processing',updated_at:new Date().toISOString()}).eq('id',id).eq('status','queued').select().maybeSingle();
 if(claim.error||!claim.data)return {skipped:true};const project=claim.data;
 let folder='';
 try{
  assert(project.source_media_id,404,'Video source missing');const media=await db.from('media_assets').select('*').eq('id',project.source_media_id).eq('workspace_id',project.workspace_id).single();
  assert(!media.error&&media.data&&media.data.status==='verified'&&Date.parse(media.data.expires_at)>Date.now(),410,'Original video missing or expired');
  const seg=project.segments?.[0];validateClip(Number(seg?.start),Number(seg?.end));assert(['original','vertical','square'].includes(seg?.aspect),400,'Invalid aspect ratio');
  folder=await mkdtemp(join(tmpdir(),'socialorbit-'));const source=join(folder,'source'),out=join(folder,'clip.mp4');
  const signed=await db.storage.from(media.data.bucket).createSignedUrl(media.data.storage_path,240);assert(!signed.error&&signed.data,503,'Video unavailable');
  const res=await fetch(signed.data.signedUrl,{signal:AbortSignal.timeout(60000)});assert(res.ok,503,'Unable to download video for processing');
  const bytes=Buffer.from(await res.arrayBuffer());assert(bytes.length>0&&bytes.length<=104857600,413,'Source file exceeds limit');await writeFile(source,bytes);
  const durationText=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',source],30000);
  const sourceDuration=Number(durationText.trim());assert(Number.isFinite(sourceDuration)&&sourceDuration>0,400,'Source video duration cannot be verified');
  assert(Number(seg.end)<=sourceDuration+0.05,400,'Requested clip ends after the source video');
  await run('ffmpeg',buildClipArgs(source,out,Number(seg.start),Number(seg.end),seg.aspect as Aspect),180000);
  const file=await stat(out);assert(file.size>0&&file.size<=104857600,413,'Rendered clip exceeds storage limit');
  const idOut=crypto.randomUUID(),key=`${project.workspace_id}/clips/${idOut}.mp4`;
  const uploaded=await db.storage.from(media.data.bucket).upload(key,await readFile(out),{contentType:'video/mp4',upsert:false});assert(!uploaded.error,503,'Unable to save clip output');
  const saved=await db.from('media_assets').insert({id:idOut,workspace_id:project.workspace_id,owner_id:project.created_by,bucket:media.data.bucket,storage_path:key,kind:'video',mime_type:'video/mp4',bytes:file.size,status:'verified',expires_at:new Date(Date.now()+7*86400000).toISOString()}).select('id').single();assert(!saved.error&&saved.data,503,'Rendered media registration failed');
  const done=await db.from('clip_projects').update({status:'completed',output_media_id:idOut,updated_at:new Date().toISOString()}).eq('id',id);assert(!done.error,503,'Could not finish clip project');
  if(project.credit_tx_id)await db.rpc('credit_settle',{p_id:project.credit_tx_id});
  return {completed:true,mediaId:idOut};
 }catch(e){await db.from('clip_projects').update({status:'failed',error_message:e instanceof Error?e.message:'Video processing failed',updated_at:new Date().toISOString()}).eq('id',id);
  if(project.credit_tx_id)await db.rpc('credit_release',{p_id:project.credit_tx_id});throw e;
 }finally{if(folder)await rm(folder,{recursive:true,force:true})}
}
