import {Router} from 'express';
import {database} from '../db.ts';
import {configured,env} from '../config.ts';
import {asyncRoute,assert} from '../http.ts';
import {requireAuth,actor} from '../middleware/auth.ts';
export const publicRoutes=Router();
publicRoutes.get('/health',(_req,res)=>res.json({status:'ok',service:'SocialOrbit API',databaseConfigured:configured,workerRequired:true,publishingEnabled:env.ENABLE_PUBLISHING,version:'0.2.0'}));
publicRoutes.get('/config',(_req,res)=>res.json({supabaseUrl:configured?env.SUPABASE_URL:'',supabaseAnonKey:configured?env.SUPABASE_ANON_KEY:'',mediaBucket:env.SUPABASE_MEDIA_BUCKET,configured,mediaMaxBytes:104857600}));
publicRoutes.get('/plans',asyncRoute(async(_req,res)=>{const db=database();const {data,error}=await db.from('plans').select('*').order('price_kes');assert(!error,503,'Plan catalog unavailable');res.json(data)}));
publicRoutes.get('/me',requireAuth,asyncRoute(async(req,res)=>{const a=actor(req),db=database();const {data,error}=await db.from('profiles').select('id,display_name,username,avatar_url,phone,country,timezone,language').eq('id',a.id).maybeSingle();assert(!error,503,'Profile unavailable');res.json({user:a,profile:data});}));
publicRoutes.patch('/me',requireAuth,asyncRoute(async(req,res)=>{
 const a=actor(req);const {z}=await import('zod');const p=z.object({display_name:z.string().trim().max(100).optional(),phone:z.string().max(40).nullable().optional(),country:z.string().max(80).nullable().optional(),timezone:z.string().max(60).optional(),language:z.enum(['en','sw']).optional()}).strict().parse(req.body);
 assert(Object.keys(p).length>0,400,'No changes supplied');
 const {data,error}=await database().from('profiles').update({...p,updated_at:new Date().toISOString()}).eq('id',a.id).select('id,display_name,phone,country,timezone,language').single();assert(!error,503,'Could not update profile');res.json(data);
}));
