const base=()=>process.env.SUPABASE_URL?.replace(/\/$/,"");
const allowedOrigins=()=>((process.env.ALLOWED_ORIGINS||"https://akiy2009.github.io").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean));
function send(res,status,data){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").json(data);}
function cors(req,res){
 const origin=req.headers.origin,allowed=allowedOrigins();
 if(origin&&!allowed.includes(origin.replace(/\/$/,"")))return false;
 if(origin)res.setHeader("Access-Control-Allow-Origin",origin);
 res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
 res.setHeader("Access-Control-Allow-Headers","Content-Type");res.setHeader("Access-Control-Max-Age","600");return true;
}
const key=()=>process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
function headers(){const k=key(),h={apikey:k,"Content-Type":"application/json",Prefer:"return=minimal"};if(!k.startsWith("sb_secret_"))h.Authorization="Bearer "+k;return h;}
module.exports=async function handler(req,res){
 if(!cors(req,res))return send(res,403,{error:"この送信元からのアクセスは許可されていません。"});
 if(req.method==="OPTIONS")return res.status(204).end();
 if(req.method!=="POST"){res.setHeader("Allow","POST, OPTIONS");return send(res,405,{error:"Method not allowed"});}
 if(!base()||!key())return send(res,503,{error:"お問い合わせ受付のサーバー設定が完了していません。"});
 try{
  const b=req.body||{};
  if(b.website)return send(res,200,{ok:true});
  const allowed=["研究会について","参加・入会について","イベント・共同企画について","ニュース掲載依頼","その他"];
  const category=String(b.category||"").trim(),name=String(b.name||"").trim(),email=String(b.email||"").trim(),affiliation=String(b.affiliation||"").trim(),message=String(b.message||"").trim();
  if(!allowed.includes(category)||name.length<1||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||affiliation.length>120||message.length<10||message.length>5000||b.consent!==true)
   return send(res,400,{error:"入力内容を確認してください。"});
  const upstream=await fetch(base()+"/rest/v1/contact_messages",{method:"POST",headers:headers(),body:JSON.stringify({category,name,email,affiliation,message,consent:true})});
  if(!upstream.ok){const detail=await upstream.text();console.error("Contact insert failed",upstream.status,detail.slice(0,500));return send(res,502,{error:"お問い合わせを受け付けられませんでした。時間をおいて再度お試しください。"});}
  return send(res,201,{ok:true});
 }catch(e){console.error("Contact API failed",e);return send(res,502,{error:"お問い合わせAPIに接続できません。時間をおいて再度お試しください。"});}
};
