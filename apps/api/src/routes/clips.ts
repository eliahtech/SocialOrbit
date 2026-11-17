import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute} from '../http.ts';
import {requireAuth,needSpace,workspace,actor,uuid} from '../middleware/auth.ts';
import {validateClip} from '../../../../packages/core/src/video.ts';
import {env} from '../config.ts';
export const clipRoutes=Router({mergeParams:true});
clipRoutes.use(requireAuth,needSpace());
clipRoutes.get('/',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('clip_projects').select('id,source_media_id,output_media_id,status,segments,error_message,created_at,updated_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(50);
 assert(!error,503,'Video projects unavailable');res.json(data);
}));
clipRoutes.post('/',needSpace('editor'),asyncRoute(async(req,res)=>{
 const p=z.object({mediaId:uuid,start:z.number().min(0),end:z.number().positive(),aspect:z.enum(['original','vertical','square']).default('original')}).strict().parse(req.body);
 validateClip(p.start,p.end);const db=database(),wid=workspace(req).id;
 const asset=await db.from('media_assets').select('*').eq('id',p.mediaId).eq('workspace_id',wid).maybeSingle();
 assert(!asset.error&&asset.data&&asset.data.kind==='video'&&asset.data.status==='verified',404,'Verified video media required');
 assert(Date.parse(asset.data.expires_at)>Date.now()+15*60000,409,'Source video expires too soon to process');
 const tx=await db.rpc('credit_reserve',{p_workspace:wid,p_kind:'clips',p_units:1,p_key:`clip:${crypto.randomUUID()}`,p_reason:'Video clip creation'});
 assert(!tx.error&&tx.data,402,'No video repurposing credits available');
 const clip=await db.from('clip_projects').insert({workspace_id:wid,created_by:actor(req).id,source_media_id:p.mediaId,status:'queued',segments:[{start:p.start,end:p.end,aspect:p.aspect}],credit_tx_id:tx.data}).select('id,status').single();
 if(clip.error||!clip.data){await db.rpc('credit_release',{p_id:tx.data});throw Error('Unable to queue clip')}
 res.status(202).json({...clip.data,note:'A dedicated FFmpeg worker creates the clip. Check status in the video studio.'});
}));
clipRoutes.get('/:id/download',asyncRoute(async(req,res)=>{
 const db=database();const row=await db.from('clip_projects').select('output_media_id,status').eq('id',uuid.parse(req.params.id)).eq('workspace_id',workspace(req).id).maybeSingle();
 assert(!row.error&&row.data,404,'Clip project not found');assert(row.data.status==='completed'&&row.data.output_media_id,409,'Clip not ready');
 const asset=await db.from('media_assets').select('bucket,storage_path,expires_at').eq('id',row.data.output_media_id).eq('workspace_id',workspace(req).id).maybeSingle();
 assert(!asset.error&&asset.data&&Date.parse(asset.data.expires_at)>Date.now(),410,'Clip file expired');
 const signed=await db.storage.from(asset.data.bucket).createSignedUrl(asset.data.storage_path,120);assert(!signed.error&&signed.data,503,'Clip download unavailable');
 res.json({url:signed.data.signedUrl,expiresInSeconds:120});
}));
