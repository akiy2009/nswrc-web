const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,"");
const origins=()=>((process.env.ALLOWED_ORIGINS||"https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean));
function send(res,status,data){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").json(data);}
function headers(){const k=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"",h={apikey:k,"Content-Type":"application/json"};if(!k.startsWith("sb_secret_"))h.Authorization="Bearer "+k;return h;}
async function admin(req){const raw=req.headers.authorization||"",token=raw.startsWith("Bearer ")?raw.slice(7):"";if(!token)return null;const r=await fetch(base()+"/auth/v1/user",{headers:{apikey:process.env.SUPABASE_ANON_KEY,Authorization:"Bearer "+token}});if(!r.ok)return null;const u=await r.json();return u.app_metadata?.role==="admin"?u:null;}
module.exports=async function handler(req,res){
 const origin=req.headers.origin,allowed=origins();if(origin&&!allowed.includes(origin.replace(/\/$/,"")))return send(res,403,{error:"この送信元からのアクセスは許可されていません。"});if(origin)res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","GET, PATCH, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
 if(req.method==="OPTIONS")return res.status(204).end();if(!["GET","PATCH"].includes(req.method)){res.setHeader("Allow","GET, PATCH, OPTIONS");return send(res,405,{error:"Method not allowed"});}
 if(!base()||!process.env.SUPABASE_ANON_KEY||!headers().apikey)return send(res,503,{error:"管理APIのサーバー設定が完了していません。"});
 try{
  const user=await admin(req);if(!user)return send(res,401,{error:"管理者としてログインしてください。"});
  const h=headers();
  if(req.method==="GET"){
   const r=await fetch(base()+"/rest/v1/contact_messages?select=id,category,name,email,affiliation,message,status,admin_note,created_at,updated_at&order=created_at.desc&limit=300",{headers:h});
   const data=await r.json().catch(()=>[]);
   if(!r.ok){console.error("Contact admin read failed",r.status);return send(res,502,{error:"お問い合わせ一覧を取得できません。"});}
   return send(res,200,{contacts:data});
  }
  const id=String(req.body?.id||""),status=req.body?.status,noteProvided=Object.prototype.hasOwnProperty.call(req.body||{},"admin_note"),note=noteProvided?String(req.body.admin_note??"").trim():"";
  if(!/^[0-9a-f-]{36}$/i.test(id)||(!["new","reading","responding","resolved","closed"].includes(status)&&!noteProvided)||(status!==undefined&&!["new","reading","responding","resolved","closed"].includes(status))||(noteProvided&&note.length>2000))return send(res,400,{error:"更新内容が不正です。"});
  const patch={updated_at:new Date().toISOString()};if(status!==undefined)patch.status=status;if(noteProvided)patch.admin_note=note;
  const r=await fetch(base()+"/rest/v1/contact_messages?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{...h,Prefer:"return=representation"},body:JSON.stringify(patch)});
  const rows=await r.json().catch(()=>[]);
  if(!r.ok){console.error("Contact update failed",r.status);return send(res,502,{error:"お問い合わせ情報を更新できません。"});}
  if(!rows.length)return send(res,404,{error:"対象のお問い合わせが見つかりません。"});
  return send(res,200,{contact:rows[0]});
 }catch(e){console.error("Contact admin API failed",e);return send(res,502,{error:"管理APIまたはデータベースへの接続に失敗しました。"});}
};
