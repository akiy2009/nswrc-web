const {encrypt}=require("./_lib/pii");
const ALLOWED_TYPES=new Set(["individual","school","organization"]);
const MAX_BODY=12000;
function send(res,status,body){res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").json(body);}
function origins(){return (process.env.ALLOWED_ORIGINS||"https://akiy2009.github.io,https://nswrc-membership.vercel.app").split(",").map(x=>x.trim().replace(/\/$/,"")).filter(Boolean);}
function serviceKey(){return process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";}
function serviceHeaders(){
 const key=serviceKey();
 const headers={apikey:key,"Content-Type":"application/json"};
 // New Supabase sb_secret_* keys are opaque API keys, not JWTs.
 // They must be sent as apikey only; putting one in Authorization causes Invalid JWT.
 if(!key.startsWith("sb_secret_"))headers.Authorization="Bearer "+key;
 return headers;
}
module.exports=async function handler(req,res){
 const origin=req.headers.origin,allowed=origins();
 if(origin&&!allowed.includes(origin.replace(/\/$/,"")))return send(res,403,{error:"この送信元からの申込は受け付けていません。"});
 if(origin)res.setHeader("Access-Control-Allow-Origin",origin);
 res.setHeader("Vary","Origin");
 res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
 res.setHeader("Access-Control-Allow-Headers","Content-Type");
 res.setHeader("Access-Control-Max-Age","600");
 if(req.method==="OPTIONS")return res.status(204).end();
 if(req.method!=="POST"){res.setHeader("Allow","POST, OPTIONS");return send(res,405,{error:"Method not allowed"});}
 const raw=typeof req.body==="string"?req.body:JSON.stringify(req.body||{});
 if(raw.length>MAX_BODY)return send(res,413,{error:"入力内容が大きすぎます。"});
 let b;try{b=typeof req.body==="object"&&req.body?req.body:JSON.parse(raw);}catch{return send(res,400,{error:"入力内容を読み取れません。"});}
 const clean=(v,n)=>typeof v==="string"?v.trim().slice(0,n):"";
 if(clean(b.website,200))return send(res,200,{application_id:"received"});
 const application_type=clean(b.application_type,20),full_name=clean(b.full_name,100),email=clean(b.email,254).toLowerCase(),affiliation=clean(b.affiliation,160),grade=clean(b.grade,40),callsign=clean(b.callsign,20).toUpperCase(),region=clean(b.region,100),message=clean(b.message,2000);
 const interests=Array.isArray(b.interests)?b.interests.filter(x=>typeof x==="string").slice(0,10).map(x=>clean(x,80)):[],email_opt_in=b.email_opt_in===true;
 const radio_license_status=["held","not_held","unknown"].includes(b.radio_license_status)?b.radio_license_status:"unknown";
 const radio_license_class=radio_license_status==="held"?clean(b.radio_license_class,100):"";
 const radio_license_number=radio_license_status==="held"?clean(b.radio_license_number,40):"";
 const allowedLicenses=new Set(["第一級アマチュア無線技士","第二級アマチュア無線技士","第三級アマチュア無線技士","第四級アマチュア無線技士"]);
 if(radio_license_status==="held"&&(!radio_license_number||!radio_license_class||(radio_license_class.startsWith("その他：")&&!radio_license_class.slice(4).trim())||(!radio_license_class.startsWith("その他：")&&!allowedLicenses.has(radio_license_class))))return send(res,400,{error:"無線従事者免許の種類を正しく選択してください。"});
 if(!ALLOWED_TYPES.has(application_type)||!full_name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||b.privacy_consent!==true||b.eligibility_confirmation!==true)return send(res,400,{error:"必須項目またはメールアドレス、入会資格・個人情報の同意内容を確認してください。"});
 let encryptedName,encryptedLicense;try{encryptedName=encrypt(full_name);encryptedLicense=radio_license_number?encrypt(radio_license_number):"";}catch(e){console.error("PII encryption unavailable",e.message);return send(res,503,{error:"個人情報の暗号化設定が完了していません。受付を停止しています。"});}
 const key=serviceKey();
 if(!process.env.SUPABASE_URL||!key)return send(res,503,{error:"申込受付システムの設定が完了していません。現在は受付を停止しています。"});
 try{
  const response=await fetch(process.env.SUPABASE_URL.replace(/\/$/,"")+"/rest/v1/membership_applications",{
   method:"POST",
   headers:{...serviceHeaders(),Prefer:"return=representation"},
   body:JSON.stringify({application_type,full_name:encryptedName,email,affiliation,grade,callsign,radio_license_status,radio_license_class,radio_license_number:encryptedLicense,region,interests,message,privacy_consent:true,email_opt_in})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   const upstreamCode=typeof data.code==="string"?data.code:"SUPABASE_ERROR";
   const upstreamMessage=typeof data.message==="string"?data.message.slice(0,240):"Supabase rejected the insert";
   console.error("Supabase insert failed",JSON.stringify({status:response.status,code:upstreamCode,message:upstreamMessage}));
   return send(res,502,{error:"申込情報を保存できませんでした。",diagnostic:{service:"supabase",status:response.status,code:upstreamCode,message:upstreamMessage}});
  }
  return send(res,201,{application_id:data[0]?.id||"received"});
 }catch(e){
  console.error("Application API error",e);
  return send(res,500,{error:"受付処理でエラーが発生しました。"});
 }
};