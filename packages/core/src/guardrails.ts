import {canUseProvider,mediaUsableAt, MAX_MEDIA_BYTES, type MediaKind} from './domain.ts';
export type PreflightInput={
  provider:string;kind:MediaKind;permissionGranted:boolean;accountConnected:boolean;
  caption?:string;media?:{byteSize:number;expiresAt:string;available:boolean}; scheduledAt:string;
  alreadyPublished?:boolean;publishingEnabled:boolean;
};
export type Finding={code:string;severity:'block'|'warning';message:string};
export function preflight(input:PreflightInput):Finding[]{
  const findings:Finding[]=[];
  const block=(code:string,message:string)=>findings.push({code,severity:'block',message});
  if(!input.publishingEnabled)block('PUBLISHING_DISABLED','External publishing is disabled by the operator');
  if(!input.accountConnected)block('ACCOUNT_DISCONNECTED','Reconnect your social account');
  if(!input.permissionGranted)block('MISSING_PERMISSION','Missing required provider permission');
  if(!canUseProvider(input.provider,input.kind))block('UNSUPPORTED_FORMAT','Destination does not advertise this content type');
  if(!Number.isFinite(Date.parse(input.scheduledAt)))block('INVALID_SCHEDULE','Invalid scheduled time');
  if(input.alreadyPublished)block('DUPLICATE','Content was already published to this destination');
  if(input.kind!=='text'){
    if(!input.media?.available)block('MEDIA_UNAVAILABLE','Original authorized media is unavailable');
    if(input.media&&input.media.byteSize>MAX_MEDIA_BYTES)block('MEDIA_TOO_LARGE','File exceeds the 100 MB SocialOrbit upload limit');
    if(input.media&&!mediaUsableAt(input.media.expiresAt,input.scheduledAt))block('MEDIA_EXPIRED','Media will expire before its scheduled time');
  }
  return findings;
}
export function isBlocked(findings:Finding[]){return findings.some(x=>x.severity==='block');}
