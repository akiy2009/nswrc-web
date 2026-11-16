const {encrypt}=require("../api/_lib/pii");
const base=process.env.SUPABASE_URL?.replace(/\/$/,"");
const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!base||!secret||!process.env.PII_ENCRYPTION_KEY){throw new Error("SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY), and PII_ENCRYPTION_KEY are required.");}
const headers={apikey:secret,Authorization:secret.startsWith("sb_secret_")?undefined:"Bearer "+secret,"Content-Type":"application/json"};
async function request(path,options={}){const r=await fetch(base+"/rest/v1/"+path,{...options,headers:{...headers,...options.headers}});const text=await r.text();if(!r.ok)throw new Error("Supabase request failed ("+r.status+"): "+text.slice(0,300));return text?JSON.parse(text):[];}
async function migrate(table){
 const rows=await request(table+"?select=id,full_name&limit=5000");
 let updated=0;
 for(const row of rows){
  if(!row.full_name||row.full_name.startsWith("enc:v1:"))continue;
  await request(table+"?id=eq."+encodeURIComponent(row.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({full_name:encrypt(row.full_name)})});
  updated++;
 }
 return {table,scanned:rows.length,encrypted:updated};
}
(async()=>{const results=[];for(const table of ["membership_applications","members"])results.push(await migrate(table));console.log(JSON.stringify(results));})().catch(error=>{console.error(error.message);process.exitCode=1;});
