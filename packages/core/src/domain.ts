export const PLANS = {
  free:{priceKes:0,accounts:2,oldVideos:20,publishingJobs:20,textCredits:20,imageCredits:2,clips:1,evergreenRules:1,inboxThreads:20,historyDays:7},
  creator:{priceKes:499,accounts:5,oldVideos:200,publishingJobs:300,textCredits:500,imageCredits:20,clips:10,evergreenRules:5,inboxThreads:200,historyDays:30},
  pro:{priceKes:1499,accounts:15,oldVideos:1000,publishingJobs:1500,textCredits:2000,imageCredits:100,clips:50,evergreenRules:20,inboxThreads:1000,historyDays:90},
  agency:{priceKes:3999,accounts:50,oldVideos:5000,publishingJobs:6000,textCredits:8000,imageCredits:400,clips:200,evergreenRules:100,inboxThreads:5000,historyDays:365}
} as const;
export type PlanKey=keyof typeof PLANS;
export type Provider='facebook'|'youtube'|'instagram'|'tiktok'|'x'|'linkedin';
export type MediaKind='text'|'image'|'video';
export type CreditKind='text'|'image'|'clips'|'publishing'|'old_video';
export type WorkspaceRole='owner'|'admin'|'editor'|'analyst'|'viewer';
export const CREDIT_COLUMN:Record<CreditKind,keyof typeof PLANS['free']>={text:'textCredits',image:'imageCredits',clips:'clips',publishing:'publishingJobs',old_video:'oldVideos'};
export const PROVIDERS:Provider[]=['facebook','youtube','instagram','tiktok','x','linkedin'];
// Potential product functionality is NOT equivalent to app authorization.
// The publishing adapters below must also confirm account permissions.
export const CAPABILITIES:Record<Provider,{text:boolean,image:boolean,video:boolean,discover:boolean,inbox:boolean,notes:string}>={
  facebook:{text:true,image:true,video:true,discover:true,inbox:true,notes:'Facebook Pages only; Graph API scopes, reviews and Page token required'},
  youtube:{text:false,image:false,video:true,discover:true,inbox:false,notes:'Video uploads with OAuth; channel metadata does not provide original video downloads'},
  instagram:{text:false,image:true,video:true,discover:true,inbox:true,notes:'Professional account and Meta permissions required; API support varies'},
  tiktok:{text:false,image:false,video:true,discover:false,inbox:false,notes:'TikTok Content Posting API requires app approval and user permissions'},
  x:{text:true,image:true,video:true,discover:true,inbox:true,notes:'Available features and paid API tiers depend on current X access'},
  linkedin:{text:true,image:true,video:true,discover:true,inbox:false,notes:'Member/organization permissions and appropriate API access required'}
};
export function canUseProvider(provider:string,kind:MediaKind){if(!(provider in CAPABILITIES))return false;return CAPABILITIES[provider as Provider][kind]===true;}
export function validateSchedule(iso:string,now=Date.now()){const ms=Date.parse(iso);return Number.isFinite(ms)&&ms>now;}
export function mediaExpires(createdAt:string|Date){const at=new Date(createdAt).getTime();if(!Number.isFinite(at))throw Error('Invalid media time');return new Date(at+7*86400000).toISOString();}
export function mediaUsableAt(expiresAt:string,scheduledAt:string,bufferMs=0){const expiry=Date.parse(expiresAt),schedule=Date.parse(scheduledAt);return Number.isFinite(expiry)&&Number.isFinite(schedule)&&expiry>schedule+bufferMs;}
export function canConsume(limit:number,used:number,quantity=1){return Number.isInteger(quantity)&&quantity>0&&Number.isInteger(used)&&used>=0&&used+quantity<=limit;}
export function quotaFor(plan:PlanKey,kind:CreditKind){return PLANS[plan][CREDIT_COLUMN[kind]] as number;}
export function requiresMedia(kind:MediaKind){return kind!=='text';}
export const MAX_MEDIA_BYTES=100*1024*1024;
export const MEDIA_RETENTION_DAYS=7;

export function canActuallyPublish(provider:string,kind:MediaKind){return (provider==='facebook'&&kind==='text')||(provider==='youtube'&&kind==='video');}
