/* Servidor Flota de Viaje Union 2026 - Kardex + Combustible + Mantenimiento
   Requiere Node >= 18. Almacen: Supabase (si hay variables de entorno) o archivo local data/flota.json */
const express=require('express');
const fs=require('fs');
const path=require('path');

const app=express();
app.use(express.json({limit:'10mb'}));
app.use(express.static(path.join(__dirname,'public')));

const PUERTO=process.env.PORT||3000;
const CLAVE=process.env.CLAVE_EQUIPO||'';
const SB_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SB_KEY=process.env.SUPABASE_KEY||'';
const ARCHIVO=path.join(__dirname,'data','flota.json');

/* ---------- fusion (misma regla que el cliente: gana el ts mas reciente; borrados con lapida) ---------- */
function normalizar(d){
  if(!d||typeof d!=='object')return null;
  d.unidades=d.unidades||[];d.viajes=d.viajes||[];d.cargas=d.cargas||[];d.rutas=d.rutas||[];d.mants=d.mants||[];d.del=d.del||{};
  d.cfg=d.cfg||{};if(d.cfg.precio==null)d.cfg.precio=26.5;if(d.cfg.iva==null)d.cfg.iva=16;if(d.cfg.ret==null)d.cfg.ret=4;if(d.cfg.ta==null)d.cfg.ta=6;if(d.cfg.tr==null)d.cfg.tr=12;d.cfg.ts=d.cfg.ts||1;
  ['unidades','rutas','viajes','cargas','mants'].forEach(function(c){d[c].forEach(function(x){if(!x.ts)x.ts=1})});
  return d;
}
function mergeCol(a,b,key){
  const m={};
  (a||[]).forEach(x=>{m[x[key]]=x});
  (b||[]).forEach(x=>{const e=m[x[key]];if(!e||(x.ts||0)>(e.ts||0))m[x[key]]=x});
  return Object.values(m);
}
function fusionar(a,b){
  if(!a)return b; if(!b)return a;
  const r={};
  ['viajes','cargas','rutas','mants'].forEach(c=>{r[c]=mergeCol(a[c],b[c],'id')});
  r.unidades=mergeCol(a.unidades,b.unidades,'eco');
  r.del=Object.assign({},a.del||{});
  Object.keys(b.del||{}).forEach(k=>{if(!r.del[k]||b.del[k]>r.del[k])r.del[k]=b.del[k]});
  const apl=(col,key)=>col.filter(x=>{const t=r.del[x[key]];return !(t&&t>=(x.ts||0))});
  ['viajes','cargas','rutas','mants'].forEach(c=>{r[c]=apl(r[c],'id')});
  r.unidades=apl(r.unidades,'eco');
  r.cfg=((b.cfg&&(b.cfg.ts||0)>(a.cfg.ts||0))?b.cfg:a.cfg);
  r.seeded=(a.seeded!==false)&&(b.seeded!==false);
  return r;
}

/* ---------- almacen ---------- */
async function leerBD(){
  if(SB_URL&&SB_KEY){
    const r=await fetch(SB_URL+'/rest/v1/estado?k=eq.flota&select=v',{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY}});
    if(!r.ok)throw new Error('Supabase lectura '+r.status);
    const j=await r.json();
    return j.length?j[0].v:null;
  }
  try{return JSON.parse(fs.readFileSync(ARCHIVO,'utf8'))}catch(e){return null}
}
async function escribirBD(d){
  if(SB_URL&&SB_KEY){
    const r=await fetch(SB_URL+'/rest/v1/estado',{method:'POST',headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},body:JSON.stringify({k:'flota',v:d})});
    if(!r.ok)throw new Error('Supabase escritura '+r.status);
    return;
  }
  fs.mkdirSync(path.dirname(ARCHIVO),{recursive:true});
  const tmp=ARCHIVO+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(d));
  fs.renameSync(tmp,ARCHIVO);
}
let cola=Promise.resolve();
function enSerie(fn){const p=cola.then(fn,fn);cola=p.catch(()=>{});return p}

function conClave(req,res){
  if(CLAVE&&req.get('x-clave')!==CLAVE){res.status(401).json({error:'clave incorrecta'});return false}
  return true;
}

/* ---------- API ---------- */
app.get('/api/salud',(req,res)=>{res.json({ok:true,almacen:(SB_URL&&SB_KEY)?'supabase':'archivo local'})});
app.get('/api/estado',async(req,res)=>{
  if(!conClave(req,res))return;
  try{res.json(await leerBD())}catch(e){console.error(e.message);res.status(500).json({error:'almacen'})}
});
app.post('/api/estado',(req,res)=>{
  if(!conClave(req,res))return;
  enSerie(async()=>{
    try{
      const cliente=normalizar(req.body);
      if(!cliente){res.status(400).json({error:'estado invalido'});return}
      const servidor=normalizar(await leerBD());
      const fusion=fusionar(servidor,cliente)||cliente;
      await escribirBD(fusion);
      res.json(fusion);
    }catch(e){console.error(e.message);res.status(500).json({error:'almacen'})}
  });
});

app.listen(PUERTO,()=>{
  console.log('=====================================================');
  console.log(' Flota de Viaje Union 2026 - Kardex en linea');
  console.log(' Puerto: '+PUERTO+'  |  Almacen: '+((SB_URL&&SB_KEY)?'Supabase (nube)':'archivo local data/flota.json'));
  console.log(' Abrir:  http://localhost:'+PUERTO);
  console.log('=====================================================');
});
