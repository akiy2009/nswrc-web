const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,"");
const allowedOrigins=()=>((process.env.ALLOWED_ORIGINS||"https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean));
function send(res,status,data){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").json(data);}
function cors(req,res){
 const origin=req.headers.origin;
 const allowed=allowedOrigins();
 if(origin&&!allowed.includes(origin.replace(/\/$/,"")))return false;
 if(origin)res.setHeader("Access-Control-Allow-Origin",origin);
 res.setHeader("Vary","Origin");
 res.setHeader("Access-Control-Allow-Methods","GET, PATCH, OPTIONS");
 res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
 res.setHeader("Access-Control-Max-Age","600");
 return true;
}
async function admin(req){
 const h=req.headers.authorization||"";
 const token=h.startsWith("Bearer ")?h.slice(7):"";
 if(!token)return null;
 const response=await fetch(base()+"/auth/v1/user",{
  headers:{
   apikey:process.env.SUPABASE_ANON_KEY,
   Authorization:"Bearer "+token
  }
 });
 if(!response.ok)return null;
 const user=await response.json();
 return user.app_metadata?.role==="admin"?user:null;
}
const serviceKey=()=>process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const serviceHeaders=()=>{
 const key=serviceKey();
 const headers={apikey:key,"Content-Type":"application/json"};
 // sb_secret_* is an opaque API key, not a JWT. Do not send it as a Bearer token.
 if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
 return headers;
};
module.exports=async function handler(req,res){
 if(!cors(req,res))return send(res,403,{error:"この送信元からのアクセスは許可されていません。"});
 if(req.method==="OPTIONS")return res.status(204).end();
 if(!["GET","PATCH"].includes(req.method)){
  res.setHeader("Allow","GET, PATCH, OPTIONS");
  return send(res,405,{error:"Method not allowed"});
 }
 if(!base()||!process.env.SUPABASE_ANON_KEY||!serviceKey()){
  return send(res,503,{error:"管理APIのサーバー設定が完了していません。"});
 }
 try{
  const user=await admin(req);
  if(!user)return send(res,401,{error:"管理者としてログインしてください。"});
  const headers=serviceHeaders();
  if(req.method==="GET"){
   const [appsRes,auditRes]=await Promise.all([
    fetch(base()+"/rest/v1/membership_applications?select=id,application_type,full_name,email,affiliation,grade,callsign,region,interests,message,admin_note,status,created_at,updated_at&order=created_at.desc&limit=200",{headers}),
    fetch(base()+"/rest/v1/membership_admin_audit?select=id,application_id,actor_email,action,old_status,new_status,created_at&order=created_at.desc&limit=100",{headers})
   ]);
   const apps=await appsRes.json().catch(()=>[]);
   const audit=await auditRes.json().catch(()=>[]);
   if(!appsRes.ok){
    console.error("Admin applications read failed",appsRes.status);
    return send(res,502,{error:"申込一覧を取得できません。データベース設定と最新マイグレーションを確認してください。"});
   }
   return send(res,200,{applications:apps,activities:auditRes.ok?audit:[],audit_available:auditRes.ok});
  }
  const id=String(req.body?.id||"");
  const status=req.body?.status;
  const hasStatus=typeof status==="string";
  const hasNote=Object.prototype.hasOwnProperty.call(req.body||{},"admin_note");
  const note=hasNote?String(req.body.admin_note??"").trim():"";
  if(!/^[0-9a-f-]{36}$/i.test(id)||(!hasStatus&&!hasNote)||(hasStatus&&!["pending","reviewing","approved","rejected","withdrawn"].includes(status))||(hasNote&&note.length>2000)){
   return send(res,400,{error:"更新内容が不正です。"});
  }
  const existingRes=await fetch(base()+"/rest/v1/membership_applications?id=eq."+encodeURIComponent(id)+"&select=id,status,admin_note",{headers});
  const existingRows=await existingRes.json().catch(()=>[]);
  if(!existingRes.ok||!existingRows.length)return send(res,404,{error:"対象の申込が見つかりません。"});
  const before=existingRows[0],patch={updated_at:new Date().toISOString()};
  if(hasStatus)patch.status=status;
  if(hasNote)patch.admin_note=note;
  if((hasStatus&&before.status===status)&&(!hasNote||(before.admin_note||"")===note)){
   return send(res,200,{application:before,audit_warning:false});
  }
  const updateRes=await fetch(base()+"/rest/v1/membership_applications?id=eq."+encodeURIComponent(id),{
   method:"PATCH",
   headers:{...headers,Prefer:"return=representation"},
   body:JSON.stringify(patch)
  });
  const updatedRows=await updateRes.json().catch(()=>[]);
  if(!updateRes.ok){
   console.error("Admin application update failed",updateRes.status);
   return send(res,502,{error:"申込情報を更新できません。データベース設定を確認してください。"});
  }
  const changedStatus=hasStatus&&before.status!==status;
  const changedNote=hasNote&&(before.admin_note||"")!==note;
  const events=[];
  if(changedStatus)events.push({application_id:id,actor_id:user.id,actor_email:user.email||"",action:"status_changed",old_status:before.status,new_status:status});
  if(changedNote)events.push({application_id:id,actor_id:user.id,actor_email:user.email||"",action:"note_updated",old_status:updatedRows[0]?.status||before.status,new_status:updatedRows[0]?.status||before.status});
  let auditWarning=false;
  if(events.length){
   const logRes=await fetch(base()+"/rest/v1/membership_admin_audit",{
    method:"POST",
    headers:{...headers,Prefer:"return=minimal"},
    body:JSON.stringify(events)
   });
   auditWarning=!logRes.ok;
  }
  return send(res,200,{application:updatedRows[0]||null,audit_warning:auditWarning});
 }catch(error){
  console.error("Admin API request failed",error);
  return send(res,502,{error:"管理APIまたはデータベースへの接続に失敗しました。時間をおいて再度お試しください。"});
 }
};
