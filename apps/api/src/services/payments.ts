import {ApiError,assert} from '../http.ts';
import {env} from '../config.ts';
function pesapalBase(){return process.env.PESAPAL_ENV==='live'?'https://pay.pesapal.com/v3':'https://cybqa.pesapal.com/pesapalv3';}
async function jsonFetch(url:string,init:RequestInit){const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),20000);try{const r=await fetch(url,{...init,signal:ctl.signal});const txt=await r.text();let data:any;try{data=JSON.parse(txt)}catch{throw new ApiError(502,'Invalid response from payment provider')};if(!r.ok)throw new ApiError(502,'Payment provider unavailable');return data}finally{clearTimeout(timer)}}
export async function pesapalToken(){
 const key=process.env.PESAPAL_CONSUMER_KEY,secret=process.env.PESAPAL_CONSUMER_SECRET;
 assert(key&&secret,503,'Pesapal credentials are not configured');
 const r=await jsonFetch(`${pesapalBase()}/api/Auth/RequestToken`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({consumer_key:key,consumer_secret:secret})});
 assert(r.token,502,'Pesapal authentication failed');return String(r.token);
}
export async function startPesapal(p:{amount:number;reference:string;email:string;description:string}){
 assert(process.env.PESAPAL_IPN_ID,503,'Pesapal IPN has not been configured');const token=await pesapalToken();
 const r=await jsonFetch(`${pesapalBase()}/api/Transactions/SubmitOrderRequest`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({id:p.reference,currency:'KES',amount:p.amount,description:p.description,callback_url:`${env.PUBLIC_BASE_URL}/billing-return`,notification_id:process.env.PESAPAL_IPN_ID,billing_address:{email_address:p.email}})});
 assert(r.order_tracking_id&&r.redirect_url,502,'Pesapal did not return a valid checkout');return r as {order_tracking_id:string;redirect_url:string};
}
export async function verifyPesapal(trackingId:string){
 const token=await pesapalToken(),u=new URL(`${pesapalBase()}/api/Transactions/GetTransactionStatus`);u.searchParams.set('orderTrackingId',trackingId);
 return jsonFetch(u.toString(),{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
}
function mpesaTimestamp(now=new Date()){
 const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const p=Object.fromEntries(fmt.formatToParts(now).map(item=>[item.type,item.value]));
 return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}
function mpesaBase(){return process.env.MPESA_ENV==='live'?'https://api.safaricom.co.ke':'https://sandbox.safaricom.co.ke'}
async function mpesaToken(){const k=process.env.MPESA_CONSUMER_KEY,s=process.env.MPESA_CONSUMER_SECRET;assert(k&&s,503,'M-Pesa credentials missing');const r=await jsonFetch(`${mpesaBase()}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${Buffer.from(`${k}:${s}`).toString('base64')}`}});assert(r.access_token,502,'M-Pesa authentication failed');return r.access_token as string;}
export async function startStk(p:{amount:number;phone:string;reference:string;paymentId:string}){
 const shortcode=process.env.MPESA_SHORTCODE,passkey=process.env.MPESA_PASSKEY;assert(shortcode&&passkey,503,'M-Pesa shortcode/passkey missing');
 const token=await mpesaToken(),timestamp=mpesaTimestamp();
 const password=Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
 const r=await jsonFetch(`${mpesaBase()}/mpesa/stkpush/v1/processrequest`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({BusinessShortCode:shortcode,Password:password,Timestamp:timestamp,TransactionType:'CustomerPayBillOnline',Amount:p.amount,PartyA:p.phone,PartyB:shortcode,PhoneNumber:p.phone,CallBackURL:`${env.PUBLIC_BASE_URL}/api/webhooks/mpesa`,AccountReference:p.reference,TransactionDesc:'SocialOrbit subscription'})});
 assert(r.ResponseCode==='0'&&r.CheckoutRequestID,502,'M-Pesa request rejected');return r as {CheckoutRequestID:string};
}
export async function verifyStk(checkoutId:string){
 const shortcode=process.env.MPESA_SHORTCODE,passkey=process.env.MPESA_PASSKEY;assert(shortcode&&passkey,503,'M-Pesa verification credentials missing');const token=await mpesaToken(),timestamp=mpesaTimestamp();
 return jsonFetch(`${mpesaBase()}/mpesa/stkpushquery/v1/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({BusinessShortCode:shortcode,Password:Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64'),Timestamp:timestamp,CheckoutRequestID:checkoutId})});
}
