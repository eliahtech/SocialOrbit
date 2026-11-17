import {Router} from 'express';
import {database} from '../db.ts';
import {asyncRoute,assert} from '../http.ts';
import {verifyPesapal,verifyStk} from '../services/payments.ts';
export const webhookRoutes=Router();
// Event bodies are untrusted hints. Never fulfill from webhook input alone.
webhookRoutes.all('/pesapal',asyncRoute(async(req,res)=>{
 const tracking=String(req.body?.OrderTrackingId||req.query?.OrderTrackingId||'');
 assert(/^[a-zA-Z0-9-]{10,120}$/.test(tracking),400,'Invalid tracking ID');
 const db=database();const r=await db.from('payments').select('*').eq('provider','pesapal').eq('provider_reference',tracking).maybeSingle();
 // Do not leak customer information to unauthenticated callers.
 if(!r.error&&r.data&&['pending','processing'].includes(r.data.status)){
   try{
    const verified=await verifyPesapal(tracking);
    const complete=verified.status_code===1||String(verified.payment_status_description).toLowerCase()==='completed';
    const currency=String(verified.currency||'KES').toUpperCase();
    const amount=Number(verified.amount);
    const ref=String(verified.merchant_reference||'');
    if(complete&&currency==='KES'&&amount===r.data.amount_kes&&ref===r.data.merchant_reference){
      await db.rpc('fulfill_verified_payment',{p_payment:r.data.id,p_provider_reference:tracking});
    }
   }catch(e){console.error('Pesapal reconciliation pending',e instanceof Error?e.message:'unknown')}
 }
 res.status(200).json({status:200,message:'Notification received; reconciliation is processed independently'});
}));
webhookRoutes.post('/mpesa',asyncRoute(async(req,res)=>{
 const data=req.body?.Body?.stkCallback;const ref=String(data?.CheckoutRequestID||'');
 if(ref&&ref.length<150){
  const db=database();const row=await db.from('payments').select('id,status,amount_kes').eq('provider','mpesa').eq('provider_reference',ref).maybeSingle();
  if(!row.error&&row.data&&['pending','processing'].includes(row.data.status)&&data.ResultCode===0){
   try{
    // STK query is authenticated directly with Safaricom, unlike the incoming callback.
    // Only a successful query for the exact server-generated checkout ID may fulfill.
    const query=await verifyStk(ref);
    if(Number(query.ResultCode)===0){await db.rpc('fulfill_verified_payment',{p_payment:row.data.id,p_provider_reference:ref});}
   }catch(e){console.error('M-Pesa reconciliation pending',e instanceof Error?e.message:'unknown')}
  }
 }
 res.status(200).json({ResultCode:0,ResultDesc:'Received'});
}));
