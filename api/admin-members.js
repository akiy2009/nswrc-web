const {encrypt,decryptRow}=require("./_lib/pii");
const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,"");
const key=()=>process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const headers=()=>{const k=key(),h={apikey:k,"Content-Type":"application/json"};if(!k.startsWith("sb_secret_"))h.Authorization="Bearer "+k;return h;};
const allowed=()=>((process.env.ALLOWED_ORIGINS||"https://akiy2009.github.io").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean));
function send(res,status,data){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").json(data);}
async function admin(req){const raw=req.headers.authorization||"",token=raw.startsWith("Bearer ")?raw.slice(7):"";if(!token)return null;const r=await fetch(base()+"/auth/v1/user",{headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:"Bearer "+token}});if(!r.ok)return null;const u=await r.json();return u.app_metadata?.role==="admin"?u:null;}
async function db(path,options={}){const r=await fetch(base()+"/rest/v1/"+path,{...options,headers:{...headers(),...(options.headers||{})}});const raw=await r.text();let data;try{data=raw?JSON.parse(raw):null;}catch{data={};}if(!r.ok){const e=new Error("データベース処理に失敗しました。");e.status=r.status;e.detail=data;throw e;}return data;}
const enc=v=>encodeURIComponent(String(v));
const validId=v=>/^[0-9a-f-]{36}$/i.test(String(v||""));
const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
module.exports=async function handler(req,res){
 const origin=req.headers.origin;if(origin&&!allowed().includes(origin.replace(/\/$/,"")))return send(res,403,{error:"この送信元からのアクセスは許可されていません。"});
 if(origin)res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","GET, POST, PATCH, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
 if(req.method==="OPTIONS")return res.status(204).end();if(!["GET","POST","PATCH"].includes(req.method)){res.setHeader("Allow","GET, POST, PATCH, OPTIONS");return send(res,405,{error:"Method not allowed"});}
 if(!base()||!key()||!process.env.SUPABASE_ANON_KEY)return send(res,503,{error:"管理APIのサーバー設定が完了していません。"});
 try{
  const user=await admin(req);if(!user)return send(res,401,{error:"管理者としてログインしてください。"});
  const h={Prefer:"return=representation"};
  if(req.method==="GET"){
   const [members,apps,activities,events,attendees,broadcasts]=await Promise.all([
    db("members?select=*&order=joined_at.desc&limit=2000"),
    db("membership_applications?select=id,full_name,email,email_opt_in,affiliation,grade,callsign,radio_license_status,radio_license_class,radio_license_number,region,created_at,status&status=eq.approved&order=created_at.asc&limit=500"),
    db("member_activities?select=*&order=happened_at.desc&limit=2000"),
    db("member_events?select=*&order=starts_at.desc&limit=500"),
    db("member_event_attendees?select=*&limit=5000"),
    db("member_broadcasts?select=*&order=created_at.desc&limit=200")
   ]);
   return send(res,200,{members:Array.isArray(members)?members.map(m=>decryptRow(m)):members,approvedApplications:Array.isArray(apps)?apps.map(a=>decryptRow(a)):apps,activities,events,attendees,broadcasts,mailConfigured:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM)});
  }
  const b=req.body||{},action=clean(b.action,40);
  if(req.method==="POST"){
   if(action==="createFromApplication"){
    const id=clean(b.application_id,64);if(!validId(id))return send(res,400,{error:"申込IDが不正です。"});
    const rows=await db("membership_applications?id=eq."+enc(id)+"&select=id,status,full_name,email,affiliation,grade,callsign,radio_license_status,radio_license_class,radio_license_number,region,created_at,updated_at&limit=1");
    if(!rows.length||rows[0].status!=="approved")return send(res,409,{error:"承認済みの申込だけ会員登録できます。"});
    const a=decryptRow(rows[0]),existing=await db("members?source_application_id=eq."+enc(id)+"&select=id&limit=1");if(existing.length)return send(res,409,{error:"この申込はすでに会員登録されています。"});
    const member_number="NSWRC-"+new Date().getFullYear()+"-"+Math.random().toString(36).slice(2,7).toUpperCase();
    const rows2=await db("members",{method:"POST",headers:h,body:JSON.stringify({source_application_id:id,member_number,full_name:encrypt(a.full_name),email:a.email,radio_license_number:a.radio_license_number?encrypt(a.radio_license_number):"",affiliation:a.affiliation,grade:a.grade,callsign:a.callsign,radio_license_status:a.radio_license_status||"unknown",radio_license_class:a.radio_license_class||"",region:a.region,email_opt_in:a.email_opt_in===true,joined_at:a.updated_at||a.created_at||new Date().toISOString(),membership_status:"active",email_opt_in:false})});
    return send(res,201,{member:decryptRow(rows2[0])});
   }
   if(action==="createMember"){
    const name=clean(b.full_name,100),email=clean(b.email,254).toLowerCase();if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return send(res,400,{error:"氏名と有効なメールアドレスを入力してください。"});
    const member_number=clean(b.member_number,40)||("NSWRC-"+new Date().getFullYear()+"-"+Math.random().toString(36).slice(2,7).toUpperCase());
    const licenseStatus=["held","not_held","unknown"].includes(b.radio_license_status)?b.radio_license_status:"unknown",licenseClass=clean(b.radio_license_class,100),licenseNumber=clean(b.radio_license_number,40);if(licenseStatus==="held"&&(!licenseClass||!licenseNumber))return send(res,400,{error:"免許の種類と免許証番号を入力してください。"});
    const rows=await db("members",{method:"POST",headers:h,body:JSON.stringify({member_number,full_name:encrypt(name),email,radio_license_number:licenseStatus==="held"?encrypt(licenseNumber):"",affiliation:clean(b.affiliation,160),grade:clean(b.grade,40),callsign:clean(b.callsign,20).toUpperCase(),radio_license_status:licenseStatus,radio_license_class:licenseStatus==="held"?licenseClass:"",region:clean(b.region,100),joined_at:b.joined_at||new Date().toISOString(),membership_status:"active",email_opt_in:b.email_opt_in===true,admin_note:clean(b.admin_note,3000)})});
    return send(res,201,{member:decryptRow(rows[0])});
   }
   if(action==="createActivity"){
    if(!validId(b.member_id)||!clean(b.title,160))return send(res,400,{error:"会員と活動名を指定してください。"});
    const rows=await db("member_activities",{method:"POST",headers:h,body:JSON.stringify({member_id:b.member_id,activity_type:["note","meeting","radio","research","event","other"].includes(b.activity_type)?b.activity_type:"note",title:clean(b.title,160),description:clean(b.description,3000),happened_at:b.happened_at||new Date().toISOString(),created_by:user.id,created_by_email:user.email||""})});return send(res,201,{activity:rows[0]});
   }
   if(action==="createEvent"){
    const title=clean(b.title,160),starts_at=clean(b.starts_at,50);if(!title||!Number.isFinite(Date.parse(starts_at)))return send(res,400,{error:"イベント名と開始日時を入力してください。"});
    const rows=await db("member_events",{method:"POST",headers:h,body:JSON.stringify({title,description:clean(b.description,3000),location:clean(b.location,200),starts_at,ends_at:b.ends_at||null,capacity:b.capacity?Number(b.capacity):null,status:"planned",created_by:user.id})});return send(res,201,{event:rows[0]});
   }
   if(action==="registerAttendee"){
    if(!validId(b.event_id)||!validId(b.member_id))return send(res,400,{error:"イベントと会員を指定してください。"});
    const rows=await db("member_event_attendees?on_conflict=event_id,member_id",{method:"POST",headers:{...h,Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({event_id:b.event_id,member_id:b.member_id,attendance_status:["registered","attended","absent","cancelled"].includes(b.attendance_status)?b.attendance_status:"registered",note:clean(b.note,1000)})});return send(res,201,{attendee:rows[0]});
   }
   if(action==="createBroadcast"){
    const subject=clean(b.subject,200),body=clean(b.body,10000),audience=b.audience==="active_all_emergency"?"active_all_emergency":"active_opted_in",emergency_reason=clean(b.emergency_reason,500);
    if(!subject||!body)return send(res,400,{error:"件名と本文を入力してください。"});
    if(audience==="active_all_emergency"&&!emergency_reason)return send(res,400,{error:"緊急連絡の理由を入力してください。"});
    const rows=await db("member_broadcasts",{method:"POST",headers:h,body:JSON.stringify({subject,body,audience,emergency_reason,created_by:user.id,created_by_email:user.email||""})});return send(res,201,{broadcast:rows[0]});
   }
   if(action==="sendBroadcast"){
    if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)return send(res,503,{error:"一斉連絡の送信設定が未完了です。RESEND_API_KEY と MAIL_FROM をVercelに設定してください。"});
    const id=clean(b.broadcast_id,64);if(!validId(id))return send(res,400,{error:"配信IDが不正です。"});
    const drafts=await db("member_broadcasts?id=eq."+enc(id)+"&select=*&limit=1");if(!drafts.length||drafts[0].status!=="draft")return send(res,409,{error:"下書き状態の配信だけ送信できます。"});
    const emergency=drafts[0].audience==="active_all_emergency";
    if(emergency&&!String(drafts[0].emergency_reason||"").trim())return send(res,409,{error:"緊急連絡の理由が記録されていません。"});
    const recipients=await db("members?select=id,full_name,email&membership_status=eq.active"+(emergency?"":"&email_opt_in=eq.true")+"&order=created_at.asc&limit=2000");
    if(!recipients.length)return send(res,409,{error:emergency?"送信対象となる在籍会員がいません。":"配信に同意した在籍会員がいません。"});
    await db("member_broadcasts?id=eq."+enc(id),{method:"PATCH",headers:h,body:JSON.stringify({status:"sending",recipient_count:recipients.length})});
    let sent=0,failed=0;
    const emergencyNotice=emergency?"【緊急連絡に関するお知らせ】\n本メールは「"+drafts[0].emergency_reason+"」のため、通常のメール配信に同意していない在籍会員にも送信しています。安全確保または重大な運営上の緊急対応に必要な範囲に限った連絡であり、通常のお知らせ・宣伝を目的とするものではありません。\n\n":"";
    const emailText=emergencyNotice+drafts[0].body+"\n\n――――――――――\nこのメールは、全国学生無線通信研究会からのご案内です。\n"+(emergency?"本メールは緊急連絡として送信しています。":"配信停止を希望する場合は、公式サイトのお問い合わせフォームからご連絡ください。")+"\nhttps://akiy2009.github.io/nswrc-web/contact.html";
    const batches=[];for(let i=0;i<recipients.length;i+=100)batches.push(recipients.slice(i,i+100));
    for(let i=0;i<batches.length;i+=4){
     const wave=batches.slice(i,i+4);
     const results=await Promise.all(wave.map(async(batch,index)=>{
      let ids=[],errorText="";
      try{
       const payload=batch.map(m=>({from:process.env.MAIL_FROM,to:[m.email],subject:drafts[0].subject,text:emailText}));
       const r=await fetch("https://api.resend.com/emails/batch",{method:"POST",headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":"nswrc-broadcast/"+id+"/"+(i+index)},body:JSON.stringify(payload)});
       const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.message||"メール一括送信に失敗しました。");
       ids=Array.isArray(data.data)?data.data:[];
      }catch(e){errorText=String(e.message||"送信失敗").slice(0,300);}
      const rows=batch.map((m,j)=>({broadcast_id:id,member_id:m.id,email:m.email,recipient_name:m.full_name,status:ids[j]?.id?"sent":"failed",provider_message_id:ids[j]?.id||null,error_message:ids[j]?.id?"":(errorText||"送信結果を確認できませんでした。"),sent_at:ids[j]?.id?new Date().toISOString():null}));
      const ok=rows.filter(x=>x.status==="sent").length,bad=rows.length-ok;
      try{await db("member_broadcast_recipients",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)});}catch(e){console.error("Broadcast recipient log failed",e.message);}
      return {sent:ok,failed:bad};
     }));
     for(const result of results){sent+=result.sent;failed+=result.failed;}
    }
    const status=failed===0?"sent":sent===0?"failed":"partial";
    await db("member_broadcasts?id=eq."+enc(id),{method:"PATCH",headers:h,body:JSON.stringify({status,sent_count:sent,failed_count:failed,sent_at:new Date().toISOString()})});
    return send(res,200,{sent,failed,total:recipients.length,status});
   }
   return send(res,400,{error:"不明な操作です。"});
  }
  const id=clean(b.id,64);if(!validId(id))return send(res,400,{error:"更新対象IDが不正です。"});
  if(action==="member"){
   const patch={updated_at:new Date().toISOString()};
   for(const [k,max] of Object.entries({full_name:100,email:254,radio_license_number:40,affiliation:160,grade:40,callsign:20,radio_license_class:100,region:100,admin_note:3000}))if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=clean(b[k],max);if(patch.full_name)patch.full_name=encrypt(patch.full_name);if(patch.radio_license_number)patch.radio_license_number=encrypt(patch.radio_license_number);
   if(Object.prototype.hasOwnProperty.call(b,"email_opt_in"))patch.email_opt_in=b.email_opt_in===true;
   if(Object.prototype.hasOwnProperty.call(b,"radio_license_status")){if(!["held","not_held","unknown"].includes(b.radio_license_status))return send(res,400,{error:"無線従事者免許の保有状況が不正です。"});patch.radio_license_status=b.radio_license_status;if(b.radio_license_status!=="held")patch.radio_license_class="";else if(!patch.radio_license_class)return send(res,400,{error:"免許の種類を入力してください。"});else if(!patch.radio_license_number&&!Object.prototype.hasOwnProperty.call(b,"radio_license_number"))return send(res,400,{error:"免許証番号を入力してください。"});else if(Object.prototype.hasOwnProperty.call(b,"radio_license_number")&&!clean(b.radio_license_number,40))return send(res,400,{error:"免許証番号を入力してください。"});}
   if(Object.prototype.hasOwnProperty.call(b,"joined_at"))patch.joined_at=b.joined_at;
   if(Object.prototype.hasOwnProperty.call(b,"membership_status")){if(!["active","suspended","withdrawn"].includes(b.membership_status))return send(res,400,{error:"在籍状況が不正です。"});patch.membership_status=b.membership_status;patch.left_at=b.membership_status==="withdrawn"?(b.left_at||new Date().toISOString()):null;}
   if(patch.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email))return send(res,400,{error:"メールアドレスが不正です。"});
   const beforeRows=await db("members?id=eq."+enc(id)+"&select=id,membership_status&limit=1");if(!beforeRows.length)return send(res,404,{error:"会員が見つかりません。"});
   const rows=await db("members?id=eq."+enc(id),{method:"PATCH",headers:h,body:JSON.stringify(patch)});if(!rows.length)return send(res,404,{error:"会員が見つかりません。"});
   if(patch.membership_status&&patch.membership_status!==beforeRows[0].membership_status){const label={active:"在籍",suspended:"休会・停止",withdrawn:"退会"};await db("member_activities",{method:"POST",headers:h,body:JSON.stringify({member_id:id,activity_type:"other",title:"在籍状況を"+label[beforeRows[0].membership_status]+"から"+label[patch.membership_status]+"に変更",description:"管理者 "+(user.email||"")+" が在籍状況を更新しました。",happened_at:new Date().toISOString(),created_by:user.id,created_by_email:user.email||""})});}
   return send(res,200,{member:decryptRow(rows[0])});
  }
  if(action==="attendee"){
   const before=await db("member_event_attendees?id=eq."+enc(id)+"&select=id,event_id,member_id,attendance_status&limit=1");if(!before.length)return send(res,404,{error:"参加登録が見つかりません。"});
   const patch={};if(["registered","attended","absent","cancelled"].includes(b.attendance_status))patch.attendance_status=b.attendance_status;if(Object.prototype.hasOwnProperty.call(b,"note"))patch.note=clean(b.note,1000);
   const rows=await db("member_event_attendees?id=eq."+enc(id),{method:"PATCH",headers:h,body:JSON.stringify(patch)});
   if(patch.attendance_status==="attended"&&before[0].attendance_status!=="attended"){const ev=await db("member_events?id=eq."+enc(before[0].event_id)+"&select=title,location&limit=1");const title=ev[0]?.title||"研究会イベント";await db("member_activities",{method:"POST",headers:h,body:JSON.stringify({member_id:before[0].member_id,event_id:before[0].event_id,activity_type:"event",title:"イベント参加："+title,description:(ev[0]?.location||"")+" にて出席を記録",happened_at:new Date().toISOString(),created_by:user.id,created_by_email:user.email||""})});}
   return send(res,200,{attendee:rows[0]||null});
  }
  if(action==="event"){
   const patch={updated_at:new Date().toISOString()};for(const [k,max] of Object.entries({title:160,description:3000,location:200}))if(Object.prototype.hasOwnProperty.call(b,k))patch[k]=clean(b[k],max);
   if(["planned","completed","cancelled"].includes(b.status))patch.status=b.status;
   const rows=await db("member_events?id=eq."+enc(id),{method:"PATCH",headers:h,body:JSON.stringify(patch)});return send(res,200,{event:rows[0]||null});
  }
  return send(res,400,{error:"不明な更新操作です。"});
 }catch(e){console.error("Member admin API failed",e.status||"",e.detail||e.message);return send(res,e.status&&e.status<500?e.status:502,{error:e.message||"管理APIでエラーが発生しました。"});}
};
