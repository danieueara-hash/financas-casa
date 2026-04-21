import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const R = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const Dt = s => { try { return new Date(s+"T12:00:00").toLocaleDateString("pt-BR"); } catch { return s; } };
const today = () => new Date().toISOString().split("T")[0];
function monthLabel(m){ const [y,mo]=m.split("-").map(Number); return `${MONTHS[mo-1]} ${y}`; }
function shiftMonth(m,d){ const [y,mo]=m.split("-").map(Number); const dt=new Date(y,mo-1+d,1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`; }
const uid = () => Math.random().toString(36).slice(2,9);

const RECURRENCE_OPTS = [
  {value:"monthly", label:"Mensal"},
  {value:"weekly",  label:"Semanal"},
  {value:"yearly",  label:"Anual"},
];

const DEF_CATS = {
  expense:[
    {id:"e1",name:"Alimentação",color:"#F59E0B",emoji:"🍽️"},
    {id:"e2",name:"Moradia",color:"#3B82F6",emoji:"🏠"},
    {id:"e3",name:"Transporte",color:"#8B5CF6",emoji:"🚗"},
    {id:"e4",name:"Saúde",color:"#EF4444",emoji:"❤️"},
    {id:"e5",name:"Lazer",color:"#EC4899",emoji:"🎮"},
    {id:"e6",name:"Educação",color:"#06B6D4",emoji:"📚"},
  ],
  income:[
    {id:"i1",name:"Salário",color:"#10B981",emoji:"💼"},
    {id:"i2",name:"Freelance",color:"#84CC16",emoji:"💻"},
    {id:"i3",name:"Outros",color:"#94A3B8",emoji:"✨"},
  ]
};

const DEMO_TXS = [
  {id:"t1",type:"expense",description:"Supermercado",amount:450,catId:"e1",date:"2026-04-10",status:"paid",cardId:null,recurrent:false,recurrenceType:null},
  {id:"t2",type:"income",description:"Salário",amount:5000,catId:"i1",date:"2026-04-05",status:"received",cardId:null,recurrent:true,recurrenceType:"monthly"},
  {id:"t3",type:"expense",description:"Aluguel",amount:1200,catId:"e2",date:"2026-04-10",status:"paid",cardId:null,recurrent:true,recurrenceType:"monthly"},
  {id:"t4",type:"expense",description:"Academia",amount:89.9,catId:"e4",date:"2026-04-15",status:"paid",cardId:null,recurrent:true,recurrenceType:"monthly"},
  {id:"t5",type:"expense",description:"Netflix",amount:39.9,catId:"e5",date:"2026-04-18",status:"pending",cardId:"c1",recurrent:true,recurrenceType:"monthly"},
  {id:"t6",type:"income",description:"Freelance Site",amount:800,catId:"i2",date:"2026-04-25",status:"pending",cardId:null,recurrent:false,recurrenceType:null},
  {id:"t7",type:"expense",description:"Gasolina",amount:200,catId:"e3",date:"2026-04-12",status:"paid",cardId:"c1",recurrent:false,recurrenceType:null},
  {id:"t8",type:"expense",description:"Farmácia",amount:85.5,catId:"e4",date:"2026-04-08",status:"paid",cardId:null,recurrent:false,recurrenceType:null},
];
const DEMO_CARDS = [
  {id:"c1",name:"Nubank",color:"#8B5CF6",limit:5000,closingDay:11,dueDay:18},
  {id:"c2",name:"Inter",color:"#F97316",limit:3000,closingDay:1,dueDay:7},
];

// ── helpers: gerar lançamentos recorrentes para um mês ──────────────────────
function getMonthTxns(allTxns, month) {
  // Lançamentos reais do mês
  const real = allTxns.filter(t => t.date && t.date.startsWith(month));
  const realIds = new Set(real.map(t => t.originId || t.id));

  // Gerar projeções de recorrentes de meses anteriores
  const projected = [];
  allTxns.filter(t => t.recurrent && t.date && t.date.slice(0,7) < month).forEach(t => {
    const rec = t.recurrenceType;
    if (rec === "monthly") {
      // Verifica se já existe lançamento real com mesmo originId neste mês
      if (!allTxns.some(x => x.originId === t.id && x.date && x.date.startsWith(month))) {
        const day = t.date.slice(8,10);
        projected.push({...t, id: `proj_${t.id}_${month}`, date: `${month}-${day}`,
          status: t.type === "income" ? "pending" : "pending", projected: true, originId: t.id});
      }
    } else if (rec === "yearly") {
      const tMonth = t.date.slice(5,7);
      if (month.slice(5,7) === tMonth && month > t.date.slice(0,7)) {
        if (!allTxns.some(x => x.originId === t.id && x.date && x.date.startsWith(month))) {
          const day = t.date.slice(8,10);
          projected.push({...t, id: `proj_${t.id}_${month}`, date: `${month}-${day}`,
            status:"pending", projected:true, originId: t.id});
        }
      }
    }
  });
  return [...real, ...projected];
}

function getNextMonthProjection(allTxns, currentMonth) {
  const nextMonth = shiftMonth(currentMonth, 1);
  const nextTxns = getMonthTxns(allTxns, nextMonth);
  const inc = nextTxns.filter(t=>t.type==="income").reduce((s,t)=>s+t.amount,0);
  const exp = nextTxns.filter(t=>t.type==="expense").reduce((s,t)=>s+t.amount,0);
  return { inc, exp, bal: inc - exp, month: nextMonth, txns: nextTxns };
}

// ── UI primitives ──────────────────────────────────────────────────────────
const GreenBtn = ({children,onClick,full=false,sm=false}) => (
  <button onClick={onClick} style={{background:"linear-gradient(135deg,#10B981,#059669)"}}
    className={`flex items-center justify-center gap-1.5 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer ${sm?"px-3 py-1.5 text-xs":"px-4 py-2.5 text-sm"} ${full?"w-full":""}`}>
    {children}
  </button>
);
const GhostBtn = ({children,onClick,full=false}) => (
  <button onClick={onClick} className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer ${full?"w-full":""}`}>
    {children}
  </button>
);
const Inp = ({label,...p}) => (
  <div className="w-full">
    {label&&<label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>}
    <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-400 bg-white" {...p}/>
  </div>
);
const Sel = ({label,children,...p}) => (
  <div className="w-full">
    {label&&<label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>}
    <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-400 bg-white cursor-pointer" {...p}>{children}</select>
  </div>
);
const Tabs = ({opts,val,onChange}) => (
  <div className="flex rounded-xl overflow-hidden border border-gray-200">
    {opts.map(([v,l])=>(
      <button key={v} onClick={()=>onChange(v)} className="flex-1 py-2 text-sm font-medium transition-colors cursor-pointer"
        style={{background:val===v?"#0F172A":"white",color:val===v?"white":"#6B7280"}}>{l}</button>
    ))}
  </div>
);
const Modal = ({title,onClose,children,wide=false}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.55)"}}>
    <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide?"max-w-lg":"max-w-md"} max-h-[92vh] overflow-auto`}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h3 className="font-bold text-gray-900">{title}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer text-2xl leading-none">×</button>
      </div>
      <div className="p-6 space-y-3">{children}</div>
    </div>
  </div>
);

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({mTxns,allCats,cards,txns,month,onToggle}) {
  const getCat = id => allCats.find(c=>c.id===id);
  const income = mTxns.filter(t=>t.type==="income"&&t.status==="received").reduce((s,t)=>s+t.amount,0);
  const expense = mTxns.filter(t=>t.type==="expense"&&t.status==="paid").reduce((s,t)=>s+t.amount,0);
  const bal = income - expense;
  const pendExp = mTxns.filter(t=>t.type==="expense"&&t.status==="pending");
  const pendInc = mTxns.filter(t=>t.type==="income"&&t.status==="pending");
  const pendTotal = pendExp.reduce((s,t)=>s+t.amount,0);
  const next = useMemo(()=>getNextMonthProjection(txns, month),[txns,month]);

  const catChart = useMemo(()=>{
    const g={};
    mTxns.filter(t=>t.type==="expense"&&t.status==="paid").forEach(t=>{g[t.catId]=(g[t.catId]||0)+t.amount;});
    return Object.entries(g).map(([id,v])=>{const c=getCat(id);return{name:c?.name||"Outros",value:v,color:c?.color||"#94A3B8",emoji:c?.emoji||"📦"};}).sort((a,b)=>b.value-a.value);
  },[mTxns]);

  const cardUsage = cards.map(c=>({...c,used:mTxns.filter(t=>t.cardId===c.id).reduce((s,t)=>s+t.amount,0)}));

  const kpis=[
    {label:"Receitas",value:income,color:"#10B981",bg:"#ECFDF5",icon:"📈"},
    {label:"Despesas",value:expense,color:"#EF4444",bg:"#FEF2F2",icon:"📉"},
    {label:"Saldo Atual",value:bal,color:bal>=0?"#10B981":"#EF4444",bg:bal>=0?"#ECFDF5":"#FEF2F2",icon:"💰"},
    {label:"A Pagar",value:pendTotal,color:"#F59E0B",bg:"#FFFBEB",icon:"⏳"},
  ];

  return(
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(k=>(
          <div key={k.label} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs font-medium text-gray-400">{k.label}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:k.bg}}>{k.icon}</div>
            </div>
            <p className="text-xl font-bold" style={{color:k.color}}>{R(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Projeção mês seguinte */}
      <div className="rounded-2xl p-5 shadow-sm" style={{background:"linear-gradient(135deg,#0F172A,#1e3a5f)"}}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 font-medium mb-0.5">Projeção — {monthLabel(next.month)}</p>
            <p className="text-white text-sm font-semibold">Baseado em lançamentos recorrentes</p>
          </div>
          <span className="text-2xl">🔮</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            {label:"Receitas previstas",value:next.inc,color:"#34D399"},
            {label:"Despesas previstas",value:next.exp,color:"#F87171"},
            {label:"Saldo projetado",value:next.bal,color:next.bal>=0?"#34D399":"#F87171"},
          ].map(item=>(
            <div key={item.label} className="rounded-xl p-3" style={{background:"rgba(255,255,255,0.07)"}}>
              <p className="text-xs text-gray-400 mb-1">{item.label}</p>
              <p className="text-lg font-bold" style={{color:item.color}}>{R(item.value)}</p>
            </div>
          ))}
        </div>
        {next.txns.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-xs text-gray-400 mb-2">{next.txns.length} lançamentos previstos</p>
            <div className="flex flex-wrap gap-1.5">
              {next.txns.slice(0,6).map(t=>{const cat=getCat(t.catId);return(
                <span key={t.id} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{background:"rgba(255,255,255,0.1)",color:"#CBD5E1"}}>
                  {cat?.emoji} {t.description} {R(t.amount)}
                </span>
              );})}
              {next.txns.length>6&&<span className="text-xs text-gray-500">+{next.txns.length-6} mais</span>}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Gráfico categorias */}
        <div className="col-span-2 bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Despesas por Categoria</p>
          {catChart.length===0?<p className="text-sm text-gray-400 text-center py-10">Sem despesas pagas</p>:(
            <div className="flex gap-6 items-center">
              <PieChart width={170} height={155}>
                <Pie data={catChart} cx={82} cy={72} innerRadius={40} outerRadius={68} paddingAngle={3} dataKey="value">
                  {catChart.map((e,i)=><Cell key={i} fill={e.color}/>)}
                </Pie>
                <Tooltip formatter={v=>R(v)} contentStyle={{borderRadius:10,border:"none",fontSize:12}}/>
              </PieChart>
              <div className="space-y-2 flex-1">
                {catChart.map((c,i)=>(
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{background:c.color}}/><span className="text-xs text-gray-600">{c.emoji} {c.name}</span></div>
                    <span className="text-xs font-bold text-gray-700">{R(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Cartões */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Cartões</p>
          {cardUsage.length===0?<p className="text-xs text-gray-400 text-center py-6">Sem cartões</p>:(
            <div className="space-y-3">
              {cardUsage.map(c=>(
                <div key={c.id} className="rounded-xl p-3" style={{border:`1px solid ${c.color}30`,background:c.color+"08"}}>
                  <div className="flex justify-between mb-2"><span className="text-xs font-bold" style={{color:c.color}}>{c.name}</span><span className="text-xs text-gray-400">d.{c.dueDay}</span></div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1"><div className="h-full rounded-full" style={{width:`${Math.min(c.used/c.limit*100,100)}%`,background:c.color}}/></div>
                  <div className="flex justify-between text-xs text-gray-400"><span>{R(c.used)}</span><span>{R(c.limit)}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pendentes */}
      <div className="grid grid-cols-2 gap-5">
        {[
          {title:"⏳ Contas a Pagar",items:pendExp,color:"#EF4444"},
          {title:"🟢 Receitas a Receber",items:pendInc,color:"#10B981"},
        ].map(({title,items,color})=>(
          <div key={title} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-semibold text-gray-800">{title}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{items.length}</span>
            </div>
            {items.length===0?<p className="text-sm text-gray-400 text-center py-4">Tudo em dia ✅</p>:(
              <div className="space-y-1.5" style={{maxHeight:170,overflowY:"auto"}}>
                {items.map(t=>{const cat=getCat(t.catId);return(
                  <div key={t.id} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 group">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat?.emoji||"📦"}</span>
                      <div>
                        <div className="flex items-center gap-1">
                          <p className="text-xs font-semibold text-gray-800">{t.description}</p>
                          {t.recurrent&&<span className="text-xs px-1 rounded" style={{background:"#ECFDF5",color:"#10B981"}}>🔁</span>}
                        </div>
                        <p className="text-xs text-gray-400">{Dt(t.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{color}}>{R(t.amount)}</span>
                      <button onClick={()=>onToggle(t.id)} className="p-1 rounded-lg hover:bg-emerald-50 text-transparent group-hover:text-emerald-400 cursor-pointer">✓</button>
                    </div>
                  </div>
                );})}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
function Transactions({mTxns,allCats,cards,onEdit,onDelete,onToggle}){
  const [filt,setFilt]=useState("all");
  const rows=[...mTxns].filter(t=>filt==="all"||t.type===filt||(filt==="recurrent"&&t.recurrent)).sort((a,b)=>b.date.localeCompare(a.date));
  return(
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <p className="text-base font-bold text-gray-900 whitespace-nowrap">Lançamentos</p>
        <Tabs opts={[["all","Todos"],["expense","Despesas"],["income","Receitas"],["recurrent","Recorrentes"]]} val={filt} onChange={setFilt}/>
      </div>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {rows.length===0?<p className="text-sm text-gray-400 text-center py-14">Nenhum lançamento</p>:(
          rows.map((t,i)=>{
            const cat=allCats.find(c=>c.id===t.catId);
            const card=cards.find(c=>c.id===t.cardId);
            const ok=t.status==="paid"||t.status==="received";
            return(
              <div key={t.id} className={`flex items-center px-5 py-3.5 hover:bg-gray-50 group ${t.projected?"bg-blue-50/40":""} ${i<rows.length-1?"border-b border-gray-50":""}`}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base mr-3 flex-shrink-0" style={{background:(cat?.color||"#94A3B8")+"15"}}>{cat?.emoji||"📦"}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-gray-800 truncate">{t.description}</p>
                    {t.recurrent&&<span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:"#ECFDF5",color:"#10B981"}}>🔁 {RECURRENCE_OPTS.find(r=>r.value===t.recurrenceType)?.label}</span>}
                    {t.projected&&<span className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0" style={{background:"#EFF6FF",color:"#3B82F6"}}>Projeção</span>}
                  </div>
                  <p className="text-xs text-gray-400">{cat?.name||"—"} • {Dt(t.date)}{card?` • 💳 ${card.name}`:""}</p>
                </div>
                                  <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold" style={{color:t.type==="income"?"#10B981":"#EF4444"}}>{t.type==="income"?"+":"-"}{R(t.amount)}</p>
                    {!t.projected?(
                      <button title="Clique para alternar status" onClick={()=>onToggle(t.id)}
                        className="text-xs px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-75 transition-opacity"
                        style={{background:ok?"rgba(16,185,129,0.1)":"rgba(245,158,11,0.1)",color:ok?"#10B981":"#F59E0B"}}>
                        {ok?"✅ ":""}{t.status==="paid"?"Pago":t.status==="received"?"Recebido":"⏳ Pendente"}
                      </button>
                    ):(
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{background:"rgba(59,130,246,0.1)",color:"#3B82F6"}}>Projeção</span>
                    )}
                  </div>
                  {!t.projected&&(
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={()=>onEdit(t)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-300 hover:text-blue-500 cursor-pointer">✏️</button>
                      <button onClick={()=>onDelete(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 cursor-pointer">🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── CARDS ─────────────────────────────────────────────────────────────────────
function CardsScreen({cards,mTxns,allCats,onAdd,onEdit,onDelete,month}){
  const [active,setActive]=useState(cards[0]?.id||null);
  const stmnt=mTxns.filter(t=>t.cardId===active);
  const stTotal=stmnt.reduce((s,t)=>s+t.amount,0);
  const cardUsage=cards.map(c=>({...c,used:mTxns.filter(t=>t.cardId===c.id).reduce((s,t)=>s+t.amount,0)}));
  return(
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-gray-900">Cartões de Crédito</p>
        <GreenBtn onClick={onAdd}>➕ Novo Cartão</GreenBtn>
      </div>
      {cards.length===0?(
        <div className="bg-white rounded-2xl p-14 text-center shadow-sm"><p className="text-4xl mb-2">💳</p><p className="text-sm text-gray-400">Nenhum cartão</p></div>
      ):(
        <>
          <div className="grid grid-cols-3 gap-4">
            {cardUsage.map(c=>{const sel=active===c.id;return(
              <div key={c.id} onClick={()=>setActive(c.id)} className="cursor-pointer rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
                style={{background:sel?c.color:"white",border:sel?`2px solid ${c.color}`:"1px solid #F1F5F9"}}>
                <div className="flex justify-between items-start mb-5">
                  <p className="font-bold text-lg" style={{color:sel?"white":c.color}}>💳 {c.name}</p>
                  <div className="flex gap-1">
                    <button onClick={e=>{e.stopPropagation();onEdit(c);}} className="opacity-60 hover:opacity-100 cursor-pointer" style={{color:sel?"white":"#9CA3AF"}}>✏️</button>
                    <button onClick={e=>{e.stopPropagation();onDelete(c.id);}} className="opacity-60 hover:opacity-100 cursor-pointer" style={{color:sel?"white":"#9CA3AF"}}>🗑️</button>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full mb-2" style={{background:sel?"rgba(255,255,255,0.3)":"#F3F4F6"}}>
                  <div className="h-full rounded-full" style={{width:`${Math.min(c.used/c.limit*100,100)}%`,background:sel?"white":c.color}}/>
                </div>
                <div className="flex justify-between text-xs mb-1" style={{color:sel?"rgba(255,255,255,0.7)":"#9CA3AF"}}>
                  <span>{R(c.used)} usado</span><span>{R(c.limit-c.used)} livre</span>
                </div>
                <p className="text-xs mt-2" style={{color:sel?"rgba(255,255,255,0.5)":"#C4C9D4"}}>Fecha d.{c.closingDay} • Vence d.{c.dueDay}</p>
              </div>
            );})}
          </div>
          {active&&(
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex justify-between">
                <p className="font-semibold text-gray-800 text-sm">Fatura — {cards.find(c=>c.id===active)?.name} ({monthLabel(month)})</p>
                <span className="text-sm font-bold text-red-500">{R(stTotal)}</span>
              </div>
              {stmnt.length===0?<p className="text-sm text-gray-400 text-center py-10">Sem gastos neste mês</p>:
                stmnt.map((t,i)=>{const cat=allCats.find(c=>c.id===t.catId);return(
                  <div key={t.id} className={`flex items-center px-5 py-3 hover:bg-gray-50 ${i<stmnt.length-1?"border-b border-gray-50":""}`}>
                    <span className="text-base mr-3">{cat?.emoji||"📦"}</span>
                    <div className="flex-1"><p className="text-sm font-medium text-gray-800">{t.description}</p><p className="text-xs text-gray-400">{cat?.name} • {Dt(t.date)}</p></div>
                    <span className="text-sm font-bold text-red-500">{R(t.amount)}</span>
                  </div>
                );})}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CATEGORIES ────────────────────────────────────────────────────────────────
function CatsScreen({cats,onAdd,onEdit,onDelete}){
  const [tab,setTab]=useState("expense");
  return(
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <p className="text-base font-bold text-gray-900">Categorias</p>
          <Tabs opts={[["expense","Despesas"],["income","Receitas"]]} val={tab} onChange={setTab}/>
        </div>
        <GreenBtn onClick={()=>onAdd(tab)}>➕ Nova Categoria</GreenBtn>
      </div>
      {cats[tab].length===0?(
        <div className="bg-white rounded-2xl p-14 text-center shadow-sm"><p className="text-4xl mb-2">🏷️</p><p className="text-sm text-gray-400">Nenhuma categoria</p></div>
      ):(
        <div className="grid grid-cols-3 gap-4">
          {cats[tab].map(c=>(
            <div key={c.id} className="bg-white rounded-2xl p-4 shadow-sm flex items-center justify-between hover:shadow-md group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{background:c.color+"15"}}>{c.emoji}</div>
                <div><p className="text-sm font-semibold text-gray-800">{c.name}</p><div className="w-6 h-1.5 rounded-full mt-1" style={{background:c.color}}/></div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={()=>onEdit(c,tab)} className="text-blue-300 hover:text-blue-500 cursor-pointer p-1">✏️</button>
                <button onClick={()=>onDelete(c.id,tab)} className="text-red-300 hover:text-red-500 cursor-pointer p-1">🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── REPORTS ───────────────────────────────────────────────────────────────────
function Reports({txns,cats,month}){
  const allCats=useMemo(()=>[...cats.expense,...cats.income],[cats]);
  const chartData=useMemo(()=>Array.from({length:6},(_,i)=>{
    const m=shiftMonth(month,i-5);const[,mo]=m.split("-").map(Number);
    const mtxns=getMonthTxns(txns,m);
    const inc=mtxns.filter(t=>t.type==="income"&&t.status==="received").reduce((s,t)=>s+t.amount,0);
    const exp=mtxns.filter(t=>t.type==="expense"&&t.status==="paid").reduce((s,t)=>s+t.amount,0);
    return{label:MONTHS[mo-1].slice(0,3),inc,exp,bal:inc-exp};
  }),[txns,month]);
  const mTxns=useMemo(()=>getMonthTxns(txns,month),[txns,month]);
  const catData=useMemo(()=>{
    const g={};
    mTxns.filter(t=>t.type==="expense"&&t.status==="paid").forEach(t=>{g[t.catId]=(g[t.catId]||0)+t.amount;});
    return Object.entries(g).map(([id,v])=>{const c=allCats.find(x=>x.id===id);return{name:c?.name||"Outros",value:v,color:c?.color||"#94A3B8"};}).sort((a,b)=>b.value-a.value);
  },[mTxns,allCats]);
  const total=catData.reduce((s,c)=>s+c.value,0);
  return(
    <div className="space-y-5">
      <p className="text-base font-bold text-gray-900">Relatórios</p>
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <p className="text-sm font-semibold text-gray-800 mb-4">Receitas vs Despesas — Últimos 6 Meses</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={4} barCategoryGap="30%">
            <XAxis dataKey="label" tick={{fontSize:12,fill:"#9CA3AF"}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fontSize:11,fill:"#9CA3AF"}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
            <Tooltip formatter={v=>R(v)} contentStyle={{borderRadius:12,border:"none",boxShadow:"0 4px 20px rgba(0,0,0,0.1)"}}/>
            <Bar dataKey="inc" name="Receitas" fill="#10B981" radius={[5,5,0,0]}/>
            <Bar dataKey="exp" name="Despesas" fill="#EF4444" radius={[5,5,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Despesas por Categoria</p>
          {catData.length===0?<p className="text-sm text-gray-400 text-center py-6">Sem dados</p>:(
            <div className="space-y-3">
              {catData.map((c,i)=>(
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{c.name}</span>
                    <span className="text-gray-400">{R(c.value)} ({total?Math.round(c.value/total*100):0}%)</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full" style={{width:`${total?c.value/total*100:0}%`,background:c.color}}/></div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Saldo por Mês</p>
          <div className="space-y-3">
            {chartData.map((m,i)=>(
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-8">{m.label}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{width:`${Math.min(Math.abs(m.bal)/7000*100,100)}%`,background:m.bal>=0?"#10B981":"#EF4444"}}/></div>
                <span className="text-xs font-bold w-24 text-right" style={{color:m.bal>=0?"#10B981":"#EF4444"}}>{R(m.bal)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AI TIP ────────────────────────────────────────────────────────────────────
function AiTip({tip,loading,onClose}){
  return(
    <div className="fixed bottom-6 right-6 z-50 w-80 bg-white rounded-2xl shadow-2xl border border-emerald-100 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3" style={{background:"linear-gradient(135deg,#0F172A,#1E293B)"}}>
        <span className="text-lg">🤖</span>
        <p className="text-sm font-semibold text-white flex-1">Análise da IA</p>
        <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer text-xl leading-none">×</button>
      </div>
      <div className="p-4">
        {loading?<p className="text-sm text-gray-400">⏳ Analisando suas finanças...</p>:<p className="text-sm text-gray-700 leading-relaxed">{tip}</p>}
      </div>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [authed,setAuthed]=useState(false);
  const [user,setUser]=useState(null);
  const [scr,setScr]=useState("dashboard");
  const [month,setMonth]=useState("2026-04");
  const [txns,setTxns]=useState([])
  const [cards,setCards]=useState([])
  const [cats,setCats]=useState(DEF_CATS);

  const [txMod,setTxMod]=useState(false);
  const [cardMod,setCardMod]=useState(false);
  const [catMod,setCatMod]=useState(false);
  const [editTxId,setEditTxId]=useState(null);
  const [editCardId,setEditCardId]=useState(null);
  const [editCatId,setEditCatId]=useState(null);

  const blankTx={type:"expense",description:"",amount:"",catId:"",date:today(),status:"pending",cardId:"",recurrent:false,recurrenceType:"monthly"};
  const [txF,setTxF]=useState(blankTx);
  const [cardF,setCardF]=useState({name:"",color:"#8B5CF6",limit:"",closingDay:"",dueDay:""});
  const [catF,setCatF]=useState({name:"",color:"#10B981",emoji:"💡",type:"expense"});
  const [aiTip,setAiTip]=useState(null);
  const [aiLoad,setAiLoad]=useState(false);
  const [authF,setAuthF]=useState({name:"",email:"",password:""});
  const [authTab,setAuthTab]=useState("login");

  const allCats=useMemo(()=>[...cats.expense,...cats.income],[cats]);
  const mTxns=useMemo(()=>getMonthTxns(txns,month),[txns,month]);

  if(!authed) return(
    <div className="min-h-screen flex items-center justify-center" style={{background:"linear-gradient(135deg,#0F172A 0%,#1E293B 60%,#065F46 100%)"}}>
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-3xl" style={{background:"linear-gradient(135deg,#10B981,#059669)"}}>💰</div>
          <h1 className="text-xl font-bold text-gray-900">FinançasCasa</h1>
          <p className="text-xs text-gray-400 mt-1">Controle financeiro inteligente</p>
        </div>
        <Tabs opts={[["login","Entrar"],["signup","Criar conta"]]} val={authTab} onChange={setAuthTab}/>
        <div className="space-y-3 mt-4">
          {authTab==="signup"&&<Inp label="Nome" placeholder="Seu nome" value={authF.name} onChange={e=>setAuthF({...authF,name:e.target.value})}/>}
          <Inp label="E-mail" type="email" placeholder="seu@email.com" value={authF.email} onChange={e=>setAuthF({...authF,email:e.target.value})}/>
          <Inp label="Senha" type="password" placeholder="••••••••" value={authF.password} onChange={e=>setAuthF({...authF,password:e.target.value})}/>
          <GreenBtn full onClick={()=>{if(authF.email&&authF.password){setUser({name:authF.name||authF.email.split("@")[0]});setAuthed(true);}}}>
            {authTab==="login"?"Entrar":"Criar conta"}
          </GreenBtn>
        </div>
        <p className="text-center text-xs text-gray-300 mt-5">🔒 Powered by Supabase Auth</p>
      </div>
    </div>
  );

  const toggleTx=id=>setTxns(p=>p.map(t=>t.id!==id?t:{...t,status:t.type==="income"?(t.status==="received"?"pending":"received"):(t.status==="paid"?"pending":"paid")}));
  const deleteTx=id=>setTxns(p=>p.filter(t=>t.id!==id));

  const openAddTx=()=>{setTxF(blankTx);setEditTxId(null);setTxMod(true);};
  const openEditTx=t=>{setTxF({...t,amount:String(t.amount),cardId:t.cardId||""});setEditTxId(t.id);setTxMod(true);};
  const saveTx=async()=>{
    if(!txF.description||!txF.amount||!txF.catId) return;
    const obj={...txF,amount:parseFloat(txF.amount),id:editTxId||uid(),recurrenceType:txF.recurrent?txF.recurrenceType:null};
    setTxns(p=>editTxId?p.map(t=>t.id===editTxId?obj:t):[...p,obj]);
    setTxMod(false);
    if(!editTxId){
      setAiLoad(true);setAiTip("loading");
      const inc=mTxns.filter(t=>t.type==="income"&&t.status==="received").reduce((s,t)=>s+t.amount,0);
      const exp=mTxns.filter(t=>t.type==="expense"&&t.status==="paid").reduce((s,t)=>s+t.amount,0);
      const cat=allCats.find(c=>c.id===txF.catId);
      try{
        const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:200,
            system:"Consultor financeiro simpático. Responda em PT-BR, 2-3 frases curtas, sem markdown.",
            messages:[{role:"user",content:`Despesa: ${R(parseFloat(txF.amount))} em "${cat?.name}". Receita: ${R(inc)}. Despesas: ${R(exp)}. ${txF.recurrent?`É recorrente (${txF.recurrenceType}).`:""} Dê uma dica financeira.`}]})});
        const data=await res.json();
        setAiTip(data.content?.[0]?.text||"Continue acompanhando suas finanças!");
      }catch{setAiTip("Registrar todos os gastos é o primeiro passo para o controle financeiro!");}
      setAiLoad(false);
    }
  };

  const saveCard=()=>{
    if(!cardF.name||!cardF.limit) return;
    const obj={...cardF,limit:parseFloat(cardF.limit),closingDay:parseInt(cardF.closingDay)||1,dueDay:parseInt(cardF.dueDay)||10,id:editCardId||uid()};
    setCards(p=>editCardId?p.map(c=>c.id===editCardId?obj:c):[...p,obj]);setCardMod(false);
  };
  const saveCat=()=>{
    if(!catF.name) return;
    const obj={...catF,id:editCatId||uid()};
    const t=catF.type;
    if(editCatId) setCats(p=>({...p,[t]:p[t].map(c=>c.id===editCatId?obj:c)}));
    else setCats(p=>({...p,[t]:[...p[t],obj]}));
    setCatMod(false);
  };

  const nav=[
    {id:"dashboard",label:"Visão Geral",icon:"🏠"},
    {id:"transactions",label:"Lançamentos",icon:"📋"},
    {id:"cards",label:"Cartões",icon:"💳"},
    {id:"categories",label:"Categorias",icon:"🏷️"},
    {id:"reports",label:"Relatórios",icon:"📊"},
  ];

  return(
    <div className="min-h-screen flex" style={{background:"#F8FAFC"}}>
      <div className="w-56 flex-shrink-0 flex flex-col" style={{background:"#0F172A"}}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{background:"linear-gradient(135deg,#10B981,#059669)"}}>💰</div>
            <div><p className="text-white font-bold text-sm">FinançasCasa</p><p className="text-gray-500 text-xs">{user?.name}</p></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map(n=>(
            <button key={n.id} onClick={()=>setScr(n.id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer"
              style={{background:scr===n.id?"rgba(16,185,129,0.15)":"transparent",color:scr===n.id?"#10B981":"#9CA3AF"}}>
              <span>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="p-3">
          <button onClick={()=>setAuthed(false)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer">
            <span>🚪</span>Sair
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-gray-900">{nav.find(n=>n.id===scr)?.icon} {nav.find(n=>n.id===scr)?.label}</p>
            <p className="text-xs text-gray-400">{monthLabel(month)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 border border-gray-200 rounded-xl overflow-hidden">
              <button onClick={()=>setMonth(shiftMonth(month,-1))} className="px-3 py-2 text-gray-400 hover:bg-gray-50 cursor-pointer">‹</button>
              <span className="px-3 text-sm font-medium text-gray-700 whitespace-nowrap">{monthLabel(month)}</span>
              <button onClick={()=>setMonth(shiftMonth(month,1))} className="px-3 py-2 text-gray-400 hover:bg-gray-50 cursor-pointer">›</button>
            </div>
            <GreenBtn onClick={openAddTx}>➕ Lançamento</GreenBtn>
          </div>
        </div>
        <div className="flex-1 p-6 overflow-auto">
          {scr==="dashboard"&&<Dashboard mTxns={mTxns} allCats={allCats} cards={cards} txns={txns} month={month} onToggle={toggleTx}/>}
          {scr==="transactions"&&<Transactions mTxns={mTxns} allCats={allCats} cards={cards} onEdit={openEditTx} onDelete={deleteTx} onToggle={toggleTx}/>}
          {scr==="cards"&&<CardsScreen cards={cards} mTxns={mTxns} allCats={allCats} month={month} onAdd={()=>{setCardF({name:"",color:"#8B5CF6",limit:"",closingDay:"",dueDay:""});setEditCardId(null);setCardMod(true);}} onEdit={c=>{setCardF({...c,limit:String(c.limit),closingDay:String(c.closingDay),dueDay:String(c.dueDay)});setEditCardId(c.id);setCardMod(true);}} onDelete={id=>setCards(p=>p.filter(c=>c.id!==id))}/>}
          {scr==="categories"&&<CatsScreen cats={cats} onAdd={type=>{setCatF({name:"",color:"#10B981",emoji:"💡",type});setEditCatId(null);setCatMod(true);}} onEdit={(c,type)=>{setCatF({...c,type});setEditCatId(c.id);setCatMod(true);}} onDelete={(id,type)=>setCats(p=>({...p,[type]:p[type].filter(c=>c.id!==id)}))}/>}
          {scr==="reports"&&<Reports txns={txns} cats={cats} month={month}/>}
        </div>
      </div>

      {/* Modal Lançamento */}
      {txMod&&(
        <Modal title={editTxId?"Editar Lançamento":"Novo Lançamento"} onClose={()=>setTxMod(false)} wide>
          <Tabs opts={[["expense","Despesa"],["income","Receita"]]} val={txF.type} onChange={v=>setTxF({...txF,type:v,catId:""})}/>
          <Inp label="Descrição" placeholder="Ex: Supermercado" value={txF.description} onChange={e=>setTxF({...txF,description:e.target.value})}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Valor (R$)" type="number" placeholder="0,00" value={txF.amount} onChange={e=>setTxF({...txF,amount:e.target.value})}/>
            <Inp label="Data" type="date" value={txF.date} onChange={e=>setTxF({...txF,date:e.target.value})}/>
          </div>
          <Sel label="Categoria" value={txF.catId} onChange={e=>setTxF({...txF,catId:e.target.value})}>
            <option value="">Selecione...</option>
            {cats[txF.type].map(c=><option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </Sel>
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Status" value={txF.status} onChange={e=>setTxF({...txF,status:e.target.value})}>
              {txF.type==="expense"?<><option value="pending">Pendente</option><option value="paid">Pago</option></>:<><option value="pending">A receber</option><option value="received">Recebido</option></>}
            </Sel>
            {txF.type==="expense"&&(
              <Sel label="Cartão (opcional)" value={txF.cardId||""} onChange={e=>setTxF({...txF,cardId:e.target.value||null})}>
                <option value="">Débito / Dinheiro</option>
                {cards.map(c=><option key={c.id} value={c.id}>💳 {c.name}</option>)}
              </Sel>
            )}
          </div>

          {/* RECORRÊNCIA */}
          <div className="rounded-xl border border-gray-200 p-4 space-y-3" style={{background:txF.recurrent?"#ECFDF5":"#F9FAFB"}}>
            <label className="flex items-center gap-3 cursor-pointer">
              <div onClick={()=>setTxF({...txF,recurrent:!txF.recurrent})}
                className="w-10 h-6 rounded-full transition-colors flex items-center px-0.5 cursor-pointer"
                style={{background:txF.recurrent?"#10B981":"#D1D5DB"}}>
                <div className="w-5 h-5 rounded-full bg-white shadow transition-transform" style={{transform:txF.recurrent?"translateX(16px)":"translateX(0)"}}/>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">🔁 Lançamento Recorrente</p>
                <p className="text-xs text-gray-400">Repete automaticamente nos próximos meses</p>
              </div>
            </label>
            {txF.recurrent&&(
              <Sel label="Frequência" value={txF.recurrenceType} onChange={e=>setTxF({...txF,recurrenceType:e.target.value})}>
                {RECURRENCE_OPTS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
              </Sel>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <GhostBtn full onClick={()=>setTxMod(false)}>Cancelar</GhostBtn>
            <GreenBtn full onClick={saveTx}>Salvar {!editTxId&&"🤖"}</GreenBtn>
          </div>
        </Modal>
      )}

      {/* Modal Cartão */}
      {cardMod&&(
        <Modal title={editCardId?"Editar Cartão":"Novo Cartão"} onClose={()=>setCardMod(false)}>
          <Inp label="Nome" placeholder="Ex: Nubank" value={cardF.name} onChange={e=>setCardF({...cardF,name:e.target.value})}/>
          <Inp label="Limite (R$)" type="number" value={cardF.limit} onChange={e=>setCardF({...cardF,limit:e.target.value})}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Dia Fechamento" type="number" min="1" max="31" value={cardF.closingDay} onChange={e=>setCardF({...cardF,closingDay:e.target.value})}/>
            <Inp label="Dia Vencimento" type="number" min="1" max="31" value={cardF.dueDay} onChange={e=>setCardF({...cardF,dueDay:e.target.value})}/>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">Cor</label>
            <div className="flex gap-2 flex-wrap">
              {["#8B5CF6","#F97316","#EF4444","#10B981","#3B82F6","#EC4899","#F59E0B","#06B6D4"].map(c=>(
                <button key={c} onClick={()=>setCardF({...cardF,color:c})} className="w-7 h-7 rounded-full border-2 cursor-pointer hover:scale-110 transition-transform"
                  style={{background:c,borderColor:cardF.color===c?"#0F172A":"transparent"}}/>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-1"><GhostBtn full onClick={()=>setCardMod(false)}>Cancelar</GhostBtn><GreenBtn full onClick={saveCard}>Salvar</GreenBtn></div>
        </Modal>
      )}

      {/* Modal Categoria */}
      {catMod&&(
        <Modal title={editCatId?"Editar Categoria":"Nova Categoria"} onClose={()=>setCatMod(false)}>
          <Tabs opts={[["expense","Despesa"],["income","Receita"]]} val={catF.type} onChange={v=>setCatF({...catF,type:v})}/>
          <Inp label="Nome" placeholder="Ex: Streaming, Pets..." value={catF.name} onChange={e=>setCatF({...catF,name:e.target.value})}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Emoji" placeholder="💡" value={catF.emoji} onChange={e=>setCatF({...catF,emoji:e.target.value})}/>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-2 block">Cor</label>
              <div className="flex gap-2 flex-wrap mt-1">
                {["#10B981","#F59E0B","#EF4444","#3B82F6","#8B5CF6","#EC4899","#06B6D4","#F97316"].map(c=>(
                  <button key={c} onClick={()=>setCatF({...catF,color:c})} className="w-6 h-6 rounded-full cursor-pointer border-2 hover:scale-110 transition-transform"
                    style={{background:c,borderColor:catF.color===c?"#0F172A":"transparent"}}/>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-1"><GhostBtn full onClick={()=>setCatMod(false)}>Cancelar</GhostBtn><GreenBtn full onClick={saveCat}>Salvar</GreenBtn></div>
        </Modal>
      )}

      {aiTip&&<AiTip tip={aiTip} loading={aiLoad} onClose={()=>setAiTip(null)}/>}
    </div>
  );
}