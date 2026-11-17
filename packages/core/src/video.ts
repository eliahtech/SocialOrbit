export type Aspect='original'|'vertical'|'square';
export function validateClip(start:number,end:number){
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>60)throw Error('Clip must be between 0 and 60 seconds');
 return {start,end,duration:end-start};
}
// Pad rather than crop; never remove important content without user approval.
export function buildClipArgs(input:string,output:string,start:number,end:number,aspect:Aspect){
 const {duration}=validateClip(start,end);
 const args=['-y','-ss',String(start),'-i',input,'-t',String(duration)];
 if(aspect==='vertical')args.push('-vf','scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1');
 else if(aspect==='square')args.push('-vf','scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2,setsar=1');
 args.push('-c:v','libx264','-preset','veryfast','-crf','25','-c:a','aac','-movflags','+faststart',output);
 return args;
}
