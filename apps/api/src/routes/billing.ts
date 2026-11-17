import {Router} from 'express';
import {z} from 'zod';
import {database} from '../db.ts';
import {assert,asyncRoute,ApiError} from '../http.ts';
import {requireAuth,needSpace,actor,workspace} from '../middleware/auth.ts';
import {normalizeKenyanPhone} from '../../../../packages/core/src/money.ts';
export const billingRoutes=Router({mergeParams:true});
billingRoutes.use(requireAuth,needSpace('admin'));
billingRoutes.get('/subscription',asyncRoute(async(req,res)=>{
 const db=database(),wid=workspace(req).id;
 const [s,w,p]=await Promise.all([
  db.from('subscriptions').select('plan_key,status,current_period_start,current_period_end').eq('workspace_id',wid).single(),
  db.from('credit_wallets').select('kind,monthly_balance,topup_balance,reserved').eq('workspace_id',wid),
  db.from('plans').select('*')
 ]);
 assert(!s.error&&!w.error&&!p.error,503,'Billing information unavailable');res.json({subscription:s.data,wallets:w.data,plans:p.data});
}));
billingRoutes.get('/payments',asyncRoute(async(req,res)=>{
 const {data,error}=await database().from('payments').select('id,provider,purpose,amount_kes,status,merchant_reference,created_at,verified_at').eq('workspace_id',workspace(req).id).order('created_at',{ascending:false}).limit(50);assert(!error,503,'Payment records unavailable');res.json(data);
}));
billingRoutes.get('/credit-packs',asyncRoute(async(_req,res)=>{
 const {data,error}=await database().from('credit_packs').select('id,kind,units,price_kes').eq('enabled',true).order('price_kes');
 assert(!error,503,'Credit packs unavailable');res.json(data);
}));
const checkoutSchema=z.discriminatedUnion('purpose',[
 z.object({provider:z.enum(['mpesa','pesapal']),purpose:z.literal('subscription'),plan:z.enum(['creator','pro','agency']),phone:z.string().optional()}).strict(),
 z.object({provider:z.enum(['mpesa','pesapal']),purpose:z.literal('topup'),creditPackId:z.string().uuid(),phone:z.string().optional()}).strict()
]);
billingRoutes.post('/checkout',needSpace('owner'),asyncRoute(async(req,res)=>{
 const p=checkoutSchema.parse(req.body),db=database(),wid=workspace(req).id;
 let amount=0,description='',details:Record<string,unknown>={};
 if(p.purpose==='subscription'){
  const plan=await db.from('plans').select('price_kes').eq('key',p.plan).single();
  assert(!plan.error&&plan.data,404,'Plan unavailable');amount=plan.data.price_kes;
  description=`SocialOrbit ${p.plan} subscription`;details={plan_key:p.plan};
 }else{
  const pack=await db.from('credit_packs').select('id,kind,units,price_kes').eq('id',p.creditPackId).eq('enabled',true).maybeSingle();
  assert(!pack.error&&pack.data,404,'Credit pack unavailable');amount=pack.data.price_kes;
  description=`SocialOrbit ${pack.data.units} ${pack.data.kind} credit top-up`;
  details={credit_pack_id:pack.data.id,credit_kind:pack.data.kind,credit_quantity:pack.data.units};
 }
 assert(amount>0,400,'Cannot charge a zero-value purchase');
 const reference=`SO-${crypto.randomUUID()}`;
 const row=await db.from('payments').insert({workspace_id:wid,initiated_by:actor(req).id,provider:p.provider,purpose:p.purpose,amount_kes:amount,merchant_reference:reference,...details}).select('id').single();
 assert(!row.error&&row.data,503,'Unable to start checkout');
 try{
  if(p.provider==='mpesa'){
   const {startStk}=await import('../services/payments.ts');const phone=normalizeKenyanPhone(p.phone||'');assert(phone,400,'Enter a valid Kenyan M-Pesa phone number');
   const provider=await startStk({amount,phone,reference,paymentId:row.data.id});
   await db.from('payments').update({provider_reference:provider.CheckoutRequestID,status:'processing'}).eq('id',row.data.id);
   return res.status(202).json({paymentId:row.data.id,status:'processing',providerReference:provider.CheckoutRequestID,message:'Confirm STK push. Entitlements change only after independent verification.'});
  }
  const {startPesapal}=await import('../services/payments.ts');const result=await startPesapal({amount,reference,email:actor(req).email,description});
  await db.from('payments').update({provider_reference:result.order_tracking_id,status:'processing'}).eq('id',row.data.id);
  return res.status(202).json({paymentId:row.data.id,status:'processing',redirectUrl:result.redirect_url});
 }catch(e){await db.from('payments').update({status:'failed'}).eq('id',row.data.id);throw e;}
}));
