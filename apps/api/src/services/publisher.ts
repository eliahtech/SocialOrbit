import {database} from '../db.ts';
import {assert,ApiError} from '../http.ts';
import {env} from '../config.ts';
import {decryptToken,encryptToken,requireEncryptionKey} from '../../../../packages/core/src/security.ts';
import {preflight,isBlocked} from '../../../../packages/core/src/guardrails.ts';
import {canActuallyPublish} from '../../../../packages/core/src/domain.ts';
export type PublishingJob={id:string;workspace_id:string;content_id:string;account_id:string;media_id:string|null;status:string;scheduled_at:string;idempotency_key:string;attempt_count:number;credit_tx_id:string|null};
async function refreshGoogleToken(accountId:string,refreshToken:string){
 const clientId=process.env.GOOGLE_CLIENT_ID,secret=process.env.GOOGLE_CLIENT_SECRET;assert(clientId&&secret,503,'YouTube OAuth not configured');
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:secret,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
 assert(res.ok,502,'YouTube token refresh failed');const data=await res.json() as any;assert(data.access_token,502,'YouTube token missing');
 const db=database(),key=requireEncryptionKey(env.ENCRYPTION_KEY_HEX);
 await db.from('oauth_credentials').update({access_token_ciphertext:encryptToken(data.access_token,key),expires_at:new Date(Date.now()+Number(data.expires_in||3600)*1000).toISOString()}).eq('account_id',accountId);
 return String(data.access_token);
}
async function publishFacebookText(pageId:string,token:string,body:string){
 const req=new URLSearchParams({message:body,access_token:token});
 const r=await fetch(`https://graph.facebook.com/v27.0/${encodeURIComponent(pageId)}/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:req.toString(),signal:AbortSignal.timeout(45000)});
 const response=await r.json() as any;
 if(!r.ok)throw new ApiError(502,`Facebook rejected publication (${response.error?.code||r.status})`,'PROVIDER_REJECTED');
 assert(response.id,502,'Facebook publication ID missing');return String(response.id);
}
async function uploadYoutubeVideo(channelId:string,token:string,mediaUrl:string,title:string,description:string){
 const original=await fetch(mediaUrl,{signal:AbortSignal.timeout(90000)});assert(original.ok,503,'Media cannot be accessed for YouTube upload');
 const buffer=Buffer.from(await original.arrayBuffer());assert(buffer.length>0&&buffer.length<=104857600,413,'Media size exceeds 100 MB');
 const init=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'video/mp4','X-Upload-Content-Length':String(buffer.length)},
  body:JSON.stringify({snippet:{title,description},status:{privacyStatus:'public'}}),signal:AbortSignal.timeout(30000)
 });
 assert(init.ok,502,'YouTube resumable upload could not be initialized');const location=init.headers.get('location');assert(location&&location.startsWith('https://'),502,'YouTube did not return a resumable upload URL');
 const uploaded=await fetch(location,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Length':String(buffer.length),'Content-Type':'video/mp4'},body:buffer,signal:AbortSignal.timeout(180000)});
 if(!uploaded.ok)throw new ApiError(502,'YouTube upload was not confirmed. Reconciliation required.','AMBIGUOUS_PROVIDER_RESULT');
 const data=await uploaded.json() as any;assert(data.id,502,'YouTube did not return an uploaded video ID');return String(data.id);
}
export async function executePublishingJob(jobId:string){
 assert(env.ENABLE_PUBLISHING,409,'Publishing is disabled by operator');
 const db=database();const [j]=await Promise.all([db.from('publishing_jobs').select('*').eq('id',jobId).maybeSingle()]);
 assert(!j.error&&j.data,404,'Publishing job not found');const job=j.data as PublishingJob;
 if(job.status==='published'||job.status==='cancelled'||job.status==='needs_reconciliation')return {skipped:true};
 assert(['scheduled','queued'].includes(job.status),409,'Job cannot be started');
 const claim=await db.from('publishing_jobs').update({status:'processing',updated_at:new Date().toISOString(),attempt_count:job.attempt_count+1}).eq('id',job.id).in('status',['scheduled','queued']).select().maybeSingle();
 if(claim.error||!claim.data)return {skipped:true};
 const [c,a,m,paused]=await Promise.all([
  db.from('content_items').select('*').eq('id',job.content_id).eq('workspace_id',job.workspace_id).maybeSingle(),
  db.from('social_accounts').select('*').eq('id',job.account_id).eq('workspace_id',job.workspace_id).maybeSingle(),
  job.media_id?db.from('media_assets').select('*').eq('id',job.media_id).eq('workspace_id',job.workspace_id).maybeSingle():Promise.resolve({data:null,error:null}),
  db.from('feature_flags').select('enabled').eq('key','global_publishing_paused').maybeSingle()
 ]);
 const content=c.data,account=a.data,media=m.data;
 const attemptNo=job.attempt_count+1;
 await db.from('publication_attempts').insert({job_id:job.id,attempt_number:attemptNo});
 try{
  assert(!paused.data?.enabled,409,'Publishing is paused');
  assert(!c.error&&!a.error&&content&&account,404,'Content or social account unavailable');
  const cred=await db.from('oauth_credentials').select('*').eq('account_id',account.id).maybeSingle();
  assert(!cred.error&&cred.data,403,'Social token unavailable');
  const key=requireEncryptionKey(env.ENCRYPTION_KEY_HEX);
  let token=decryptToken(cred.data.access_token_ciphertext,key);
  if(account.provider==='youtube'&&cred.data.refresh_token_ciphertext&&cred.data.expires_at&&Date.parse(cred.data.expires_at)<Date.now()+180000){token=await refreshGoogleToken(account.id,decryptToken(cred.data.refresh_token_ciphertext,key));}
  const findings=preflight({provider:account.provider,kind:content.kind,accountConnected:account.status==='connected',permissionGranted:Boolean(cred.data),caption:content.body,publishingEnabled:env.ENABLE_PUBLISHING,
   scheduledAt:job.scheduled_at,media:media?{available:media.status==='verified',byteSize:media.bytes,expiresAt:media.expires_at}:undefined});
  assert(!isBlocked(findings),409,findings.map(x=>x.message).join('; '));
  assert(canActuallyPublish(account.provider,content.kind),501,'This destination adapter is not yet live-verified','NOT_IMPLEMENTED');
  let externalId:string;
  if(account.provider==='facebook')externalId=await publishFacebookText(account.provider_account_id,token,content.body);
  else {
   assert(media&&media.status==='verified',409,'YouTube requires accessible original video media');
   assert(media.mime_type==='video/mp4',415,'YouTube upload adapter currently accepts MP4 only; use the Video Studio to convert first');
   const signed=await db.storage.from(media.bucket).createSignedUrl(media.storage_path,360);
   assert(!signed.error&&signed.data,503,'Unable to access video');
   externalId=await uploadYoutubeVideo(account.provider_account_id,token,signed.data.signedUrl,content.title,content.body);
  }
  const saved=await db.from('publishing_jobs').update({status:'published',external_post_id:externalId,error_code:null,error_message:null,updated_at:new Date().toISOString()}).eq('id',job.id);
  if(saved.error)throw new ApiError(502,'External post succeeded but local recording failed; operator reconciliation is required','AMBIGUOUS_PROVIDER_RESULT');
  if(job.credit_tx_id){const settled=await db.rpc('credit_settle',{p_id:job.credit_tx_id});if(settled.error)throw new ApiError(502,'External post succeeded but quota settlement failed; operator reconciliation is required','AMBIGUOUS_PROVIDER_RESULT');}
  await db.from('publication_attempts').update({result:'published',finished_at:new Date().toISOString()}).eq('job_id',job.id).eq('attempt_number',attemptNo);
  return {published:true,id:externalId};
 }catch(e){
  const ambiguous=e instanceof ApiError&&e.code==='AMBIGUOUS_PROVIDER_RESULT';
  const state=ambiguous?'needs_reconciliation':'failed';
  await db.from('publishing_jobs').update({status:state,error_code:e instanceof ApiError?e.code:'PUBLISH_ERROR',error_message:e instanceof Error?e.message:'Publication failed',updated_at:new Date().toISOString()}).eq('id',job.id);
  await db.from('publication_attempts').update({result:state,error_code:e instanceof ApiError?e.code:'ERROR',error_details:e instanceof Error?e.message:'Unknown error',finished_at:new Date().toISOString()}).eq('job_id',job.id).eq('attempt_number',attemptNo);
  if(job.credit_tx_id&&!ambiguous)await db.rpc('credit_release',{p_id:job.credit_tx_id});
  // Ambiguous outcomes are NOT retried to avoid accidental duplicate posts.
  throw e;
 }
}
