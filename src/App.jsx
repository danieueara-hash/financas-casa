import { useState, useMemo, useEffect, useCallback } from "react"
import { supabase } from "./lib/supabase"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts"

// ── HELPERS ────────────────────────────────────────────────────────────────────
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"]
const R = v => (v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})
const Dt = s => { try { return new Date(s+"T12:00:00").toLocaleDateString("pt-BR") } catch { return s } }
const today = () => new Date().toISOString().split("T")[0]
function monthLabel(m){ const [y,mo]=m.split("-").map(Number); return `${MONTHS[mo-1]} ${y}` }
function shiftMonth(m,d){ const [y,mo]=m.split("-").map(Number); const dt=new Date(y,mo-1+d,1); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}` }

const RECURRENCE_OPTS = [
  {value:"monthly",label:"Mensal"},
  {value:"weekly", label:"Semanal"},
  {value:"yearly", label:"Anual"},
]

const DEF_CATS = [
  {name:"Alimentação",type:"expense",color:"#F59E0B",emoji:"🍽️"},
  {name:"Moradia",    type:"expense",color:"#3B82F6",emoji:"🏠"},
  {name:"Transporte", type:"expense",color:"#8B5CF6",emoji:"🚗"},
  {name:"Saúde",      type:"expense",color:"#EF4444",emoji:"❤️"},
  {name:"Lazer",      type:"expense",color:"#EC4899",emoji:"🎮"},
  {name:"Educação",   type:"expense",color:"#06B6D4",emoji:"📚"},
  {name:"Salário",    type:"income", color:"#10B981",emoji:"💼"},
  {name:"Freelance",  type:"income", color:"#84CC16",emoji:"💻"},
  {name:"Outros",     type:"income", color:"#94A3B8",emoji:"✨"},
]

// ── CORE: lançamentos recorrentes projetados para um mês ───────────────────────
function getProjectedRecurrents(allTxns, month) {
  const projected = []
  allTxns
    .filter(t => {
      if (!t.recurrent || !t.date || t.date.slice(0,7) >= month) return false
      // Respeita data de encerramento
      if (t.recurrence_end && t.recurrence_end < month) return false
      return true
    })
    .forEach(t => {
      const alreadyExists = allTxns.some(x =>
        (x.origin_id === t.id || x.id === t.id) && x.date && x.date.startsWith(month)
      )
      if (alreadyExists) return
      if (t.recurrence_type === "monthly") {
        projected.push({...t,
          id: `proj_${t.id}_${month}`,
          date: `${month}-${t.date.slice(8,10)}`,
          status: "pending", projected: true, origin_id: t.id
        })
      } else if (t.recurrence_type === "yearly" && t.date.slice(5,7) === month.slice(5,7)) {
        projected.push({...t,
          id: `proj_${t.id}_${month}`,
          date: `${month}-${t.date.slice(8,10)}`,
          status: "pending", projected: true, origin_id: t.id
        })
      }
    })
  return projected
}

// Retorna transações reais do mês + projeções recorrentes
function getMonthTxns(allTxns, month) {
  const real = allTxns.filter(t => t.date && t.date.startsWith(month))
  return [...real, ...getProjectedRecurrents(allTxns, month)]
}

// Dado uma transação e o dia de fechamento do cartão, retorna "YYYY-MM" da fatura
function getInvoiceMonth(txDate, closingDay) {
  const d   = new Date(txDate + "T12:00:00")
  const day = d.getDate()
  if (day > closingDay) {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    return `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}`
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`
}

// Agrupa TODAS as transações de cartão em faturas (apenas transações reais, não projetadas)
function getAllCardInvoices(allTxns, cards) {
  const map = {}
  allTxns
    .filter(t => t.card_id && t.type === "expense" && !t.projected)
    .forEach(t => {
      const card = cards.find(c => c.id === t.card_id)
      if (!card) return
      const invMonth = getInvoiceMonth(t.date, card.closing_day)
      const key = `${card.id}_${invMonth}`
      if (!map[key]) {
        const [y, mo] = invMonth.split("-").map(Number)
        map[key] = {
          key, card, invMonth,
          dueDate: `${y}-${String(mo).padStart(2,"0")}-${String(card.due_day).padStart(2,"0")}`,
          txs: [], total: 0, allPaid: true
        }
      }
      map[key].txs.push(t)
      map[key].total = parseFloat((map[key].total + t.amount).toFixed(2))
      if (t.status !== "paid") map[key].allPaid = false
    })
  return Object.values(map)
}

// ── FUNÇÃO CENTRAL: resume um mês (usada por Dashboard E Projeção) ─────────────
function computeMonthSummary(allTxns, cards, month) {
  const mTxns   = getMonthTxns(allTxns, month)
  const invoices = getAllCardInvoices(allTxns, cards).filter(inv => inv.invMonth === month)

  // KPIs realizados
  const incomeReceived = mTxns
    .filter(t => t.type==="income" && t.status==="received")
    .reduce((s,t) => s+t.amount, 0)
  const expensePaid = mTxns
    .filter(t => t.type==="expense" && t.status==="paid" && !t.card_id)
    .reduce((s,t) => s+t.amount, 0)
  const cardPaid = invoices
    .filter(inv => inv.allPaid)
    .reduce((s,inv) => s+inv.total, 0)

  // Pendentes
  const pendingAvulso   = mTxns.filter(t => t.type==="expense" && t.status==="pending" && !t.card_id)
  const pendingInvoices = invoices.filter(inv => !inv.allPaid)
  const pendingIncome   = mTxns.filter(t => t.type==="income" && t.status==="pending")
  const pendingTotal    = pendingAvulso.reduce((s,t)=>s+t.amount,0)
                        + pendingInvoices.reduce((s,inv)=>s+inv.total,0)

  // Projeção total do mês (avulsos + todas faturas)
  const totalExpenses = mTxns
    .filter(t => t.type==="expense" && !t.card_id)
    .reduce((s,t) => s+t.amount, 0)
    + invoices.reduce((s,inv) => s+inv.total, 0)
  const totalIncome = mTxns
    .filter(t => t.type==="income")
    .reduce((s,t) => s+t.amount, 0)

  // Chips de preview (para o card de projeção)
  const invoiceItems = invoices.map(inv => ({
    id: `inv_${inv.key}`, type:"expense",
    description: `Fatura ${inv.card.name}`,
    amount: inv.total, isInvoice:true,
  }))
  const previewItems = [
    ...mTxns.filter(t => !t.card_id),
    ...invoiceItems,
  ]

  return {
    incomeReceived,
    expensePaid: expensePaid + cardPaid,
    balance: incomeReceived - (expensePaid + cardPaid),
    pendingAvulso, pendingInvoices, pendingIncome, pendingTotal,
    totalExpenses, totalIncome,
    projectedBalance: totalIncome - totalExpenses,
    mTxns, invoices, previewItems,
  }
}

// ── UI PRIMITIVES ──────────────────────────────────────────────────────────────
const GreenBtn = ({children,onClick,full=false,sm=false}) => (
  <button onClick={onClick} style={{background:"linear-gradient(135deg,#10B981,#059669)"}}
    className={`flex items-center justify-center gap-1.5 rounded-xl font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer ${sm?"px-3 py-1.5 text-xs":"px-4 py-2.5 text-sm"} ${full?"w-full":""}`}>
    {children}
  </button>
)
const GhostBtn = ({children,onClick,full=false}) => (
  <button onClick={onClick} className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 cursor-pointer ${full?"w-full":""}`}>
    {children}
  </button>
)
const Inp = ({label,...p}) => (
  <div className="w-full">
    {label&&<label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>}
    <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-400 bg-white" {...p}/>
  </div>
)
const Sel = ({label,children,...p}) => (
  <div className="w-full">
    {label&&<label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>}
    <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-400 bg-white cursor-pointer" {...p}>{children}</select>
  </div>
)
const Tabs = ({opts,val,onChange}) => (
  <div className="flex rounded-xl overflow-hidden border border-gray-200">
    {opts.map(([v,l])=>(
      <button key={v} onClick={()=>onChange(v)} className="flex-1 py-2 px-4 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
        style={{background:val===v?"#0F172A":"white",color:val===v?"white":"#6B7280"}}>{l}</button>
    ))}
  </div>
)
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
)

// ── AUTH ───────────────────────────────────────────────────────────────────────
function AuthScreen(){
  const [tab,setTab]=useState("login")
  const [f,setF]=useState({name:"",email:"",password:""})
  const [err,setErr]=useState("")
  const [loading,setLoading]=useState(false)
  const handle = async () => {
    if(!f.email||!f.password){setErr("Preencha todos os campos");return}
    if(tab==="signup"&&!f.name){setErr("Informe seu nome");return}
    setLoading(true); setErr("")
    try {
      if(tab==="signup"){
        const {error}=await supabase.auth.signUp({email:f.email,password:f.password,options:{data:{name:f.name}}})
        if(error) throw error
      } else {
        const {error}=await supabase.auth.signInWithPassword({email:f.email,password:f.password})
        if(error) throw error
      }
    } catch(e){ setErr(e.message||"Erro ao autenticar") }
    setLoading(false)
  }
  return(
    <div className="min-h-screen flex items-center justify-center" style={{background:"linear-gradient(135deg,#0F172A 0%,#1E293B 60%,#065F46 100%)"}}>
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-3xl" style={{background:"linear-gradient(135deg,#10B981,#059669)"}}>💰</div>
          <h1 className="text-xl font-bold text-gray-900">FinançasCasa</h1>
          <p className="text-xs text-gray-400 mt-1">Controle financeiro inteligente</p>
        </div>
        <Tabs opts={[["login","Entrar"],["signup","Criar conta"]]} val={tab} onChange={v=>{setTab(v);setErr("")}}/>
        <div className="space-y-3 mt-4">
          {tab==="signup"&&<Inp label="Nome" placeholder="Seu nome" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>}
          <Inp label="E-mail" type="email" placeholder="seu@email.com" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>
          <Inp label="Senha" type="password" placeholder="••••••••" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>
          {err&&<p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl">{err}</p>}
          <GreenBtn full onClick={handle}>{loading?"Aguarde...":(tab==="login"?"Entrar":"Criar conta")}</GreenBtn>
        </div>
        <p className="text-center text-xs text-gray-300 mt-5">🔒 Powered by Supabase Auth</p>
      </div>
    </div>
  )
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
function Dashboard({summary,nextSummary,nextMonth,allCats,cards,onToggle}){
  const {incomeReceived,expensePaid,balance,pendingAvulso,pendingInvoices,pendingIncome,pendingTotal,previewItems:currPreview} = summary
  const getCat = id => allCats.find(c=>c.id===id)

  const catChart = useMemo(()=>{
    const g={}
    summary.mTxns.filter(t=>t.type==="expense"&&t.status==="paid"&&!t.card_id).forEach(t=>{g[t.category_id]=(g[t.category_id]||0)+t.amount})
    summary.invoices.filter(inv=>inv.allPaid).forEach(inv=>{
      const key=`card_${inv.card.id}`
      g[key]=(g[key]||0)+inv.total
    })
    return Object.entries(g).map(([id,v])=>{
      if(id.startsWith("card_")){
        const card=cards.find(c=>`card_${c.id}`===id)
        return{name:`Fatura ${card?.name||"Cartão"}`,value:v,color:card?.color||"#8B5CF6",emoji:"💳"}
      }
      const c=getCat(id)
      return{name:c?.name||"Outros",value:v,color:c?.color||"#94A3B8",emoji:c?.emoji||"📦"}
    }).sort((a,b)=>b.value-a.value)
  },[summary])

  const cardUsage = useMemo(()=>cards.map(c=>{
    const inv=summary.invoices.find(i=>i.card.id===c.id)
    return{...c,used:inv?.total||0}
  }),[summary,cards])

  const kpis=[
    {label:"Receitas",    value:incomeReceived, color:"#10B981",bg:"#ECFDF5",icon:"📈"},
    {label:"Despesas",    value:expensePaid,    color:"#EF4444",bg:"#FEF2F2",icon:"📉"},
    {label:"Saldo Atual", value:balance,        color:balance>=0?"#10B981":"#EF4444",bg:balance>=0?"#ECFDF5":"#FEF2F2",icon:"💰"},
    {label:"A Pagar",     value:pendingTotal,   color:"#F59E0B",bg:"#FFFBEB",icon:"⏳"},
  ]

  return(
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
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

      {/* Projeção próximo mês */}
      <div className="rounded-2xl p-5 shadow-sm" style={{background:"linear-gradient(135deg,#0F172A,#1e3a5f)"}}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 font-medium mb-0.5">Projeção — {monthLabel(nextMonth)}</p>
            <p className="text-white text-sm font-semibold">Parcelas + Recorrentes + Faturas</p>
          </div>
          <span className="text-2xl">🔮</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            {label:"Receitas previstas",  value:nextSummary.totalIncome,      color:"#34D399"},
            {label:"Despesas previstas",  value:nextSummary.totalExpenses,    color:"#F87171"},
            {label:"Saldo projetado",     value:nextSummary.projectedBalance, color:nextSummary.projectedBalance>=0?"#34D399":"#F87171"},
          ].map(item=>(
            <div key={item.label} className="rounded-xl p-3" style={{background:"rgba(255,255,255,0.07)"}}>
              <p className="text-xs text-gray-400 mb-1">{item.label}</p>
              <p className="text-lg font-bold" style={{color:item.color}}>{R(item.value)}</p>
            </div>
          ))}
        </div>
        {nextSummary.previewItems.length>0&&(
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-xs text-gray-400 mb-2">{nextSummary.previewItems.length} lançamentos previstos</p>
            <div className="flex flex-wrap gap-1.5">
              {nextSummary.previewItems.slice(0,6).map(t=>{
                const cat=getCat(t.category_id)
                return(
                  <span key={t.id} className="text-xs px-2 py-0.5 rounded-full" style={{background:"rgba(255,255,255,0.1)",color:"#CBD5E1"}}>
                    {t.isInvoice?"💳":(cat?.emoji||"📦")} {t.description} {R(t.amount)}
                  </span>
                )
              })}
              {nextSummary.previewItems.length>6&&<span className="text-xs text-gray-500">+{nextSummary.previewItems.length-6} mais</span>}
            </div>
          </div>
        )}
      </div>

      {/* Gráfico + Cartões */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-2xl p-5 shadow-sm">
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
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Cartões</p>
          {cardUsage.length===0?<p className="text-xs text-gray-400 text-center py-6">Sem cartões</p>:(
            <div className="space-y-3">
              {cardUsage.map(c=>(
                <div key={c.id} className="rounded-xl p-3" style={{border:`1px solid ${c.color}30`,background:c.color+"08"}}>
                  <div className="flex justify-between mb-2"><span className="text-xs font-bold" style={{color:c.color}}>{c.name}</span><span className="text-xs text-gray-400">d.{c.due_day}</span></div>
                  <div className="w-full h-1.5 bg-gray-100 rounded-full mb-1"><div className="h-full rounded-full" style={{width:`${Math.min(c.used/c.limit_amount*100,100)}%`,background:c.color}}/></div>
                  <div className="flex justify-between text-xs text-gray-400"><span>{R(c.used)}</span><span>{R(c.limit_amount)}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pendentes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Contas a Pagar */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-semibold text-gray-800">⏳ Contas a Pagar</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{pendingAvulso.length+pendingInvoices.length}</span>
          </div>
          {pendingAvulso.length===0&&pendingInvoices.length===0
            ?<p className="text-sm text-gray-400 text-center py-4">Tudo em dia ✅</p>
            :(
            <div className="space-y-1.5" style={{maxHeight:200,overflowY:"auto"}}>
              {pendingInvoices.map(inv=>(
                <div key={inv.key} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50 group">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:inv.card.color+"20"}}>💳</div>
                    <div>
                      <p className="text-xs font-semibold text-gray-800">Fatura {inv.card.name}</p>
                      <p className="text-xs text-gray-400">Vence {Dt(inv.dueDate)} • {inv.txs.length} compra{inv.txs.length>1?"s":""}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-red-500">{R(inv.total)}</span>
                    <button onClick={()=>inv.txs.forEach(t=>onToggle(t))} className="p-1 rounded-lg hover:bg-emerald-50 text-transparent group-hover:text-emerald-400 cursor-pointer">✓</button>
                  </div>
                </div>
              ))}
              {pendingAvulso.map(t=>{const cat=getCat(t.category_id);return(
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
                    <span className="text-sm font-bold text-red-500">{R(t.amount)}</span>
                    <button onClick={()=>onToggle(t)} className="p-1 rounded-lg hover:bg-emerald-50 text-transparent group-hover:text-emerald-400 cursor-pointer">✓</button>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Receitas a Receber */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-sm font-semibold text-gray-800">🟢 Receitas a Receber</p>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{pendingIncome.length}</span>
          </div>
          {pendingIncome.length===0?<p className="text-sm text-gray-400 text-center py-4">Tudo em dia ✅</p>:(
            <div className="space-y-1.5" style={{maxHeight:200,overflowY:"auto"}}>
              {pendingIncome.map(t=>{const cat=getCat(t.category_id);return(
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
                    <span className="text-sm font-bold text-emerald-500">{R(t.amount)}</span>
                    <button onClick={()=>onToggle(t)} className="p-1 rounded-lg hover:bg-emerald-50 text-transparent group-hover:text-emerald-400 cursor-pointer">✓</button>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── TRANSACTIONS ───────────────────────────────────────────────────────────────
function Transactions({summary,allCats,cards,txns,month,onEdit,onDelete,onToggle,onCancelRecurrence}){
  const [filt,setFilt]=useState("all")
  const [invoiceModal,setInvoiceModal]=useState(null)
  const {mTxns,invoices}=summary

  const avulsos=useMemo(()=>{
    return mTxns
      .filter(t=>!t.card_id)
      .filter(t=>filt==="all"||t.type===filt||(filt==="recurrent"&&t.recurrent))
      .sort((a,b)=>b.date.localeCompare(a.date))
  },[mTxns,filt])

  const showInvoices=filt==="all"||filt==="expense"

  return(
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <p className="text-base font-bold text-gray-900 whitespace-nowrap">Lançamentos</p>
        <Tabs opts={[["all","Todos"],["expense","Despesas"],["income","Receitas"],["recurrent","Recorrentes"]]} val={filt} onChange={setFilt}/>
      </div>
      <div className="space-y-3">
        {showInvoices&&invoices.length>0&&(
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Faturas de Cartão</p>
            </div>
            {invoices.map((inv,i)=>{const ok=inv.allPaid;return(
              <div key={inv.key} onClick={()=>setInvoiceModal(inv)}
                className={`flex items-center px-5 py-3.5 hover:bg-gray-50 cursor-pointer ${i<invoices.length-1?"border-b border-gray-50":""}`}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base mr-3 flex-shrink-0" style={{background:inv.card.color+"20"}}>💳</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Fatura {inv.card.name}</p>
                  <p className="text-xs text-gray-400">Vence {Dt(inv.dueDate)} • {inv.txs.length} compra{inv.txs.length>1?"s":""} • <span className="text-blue-400">ver detalhes →</span></p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-500">-{R(inv.total)}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded-full"
                    style={{background:ok?"rgba(16,185,129,0.1)":"rgba(245,158,11,0.1)",color:ok?"#10B981":"#F59E0B"}}>
                    {ok?"✅ Paga":"⏳ Pendente"}
                  </span>
                </div>
              </div>
            )})}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          {showInvoices&&invoices.length>0&&(
            <div className="px-5 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Outros Lançamentos</p>
            </div>
          )}
          {avulsos.length===0?<p className="text-sm text-gray-400 text-center py-14">Nenhum lançamento</p>:(
            avulsos.map((t,i)=>{
              const cat=allCats.find(c=>c.id===t.category_id)
              const ok=t.status==="paid"||t.status==="received"
              return(
                <div key={t.id} className={`flex items-center px-5 py-3.5 hover:bg-gray-50 group ${t.projected?"bg-blue-50/40":""} ${i<avulsos.length-1?"border-b border-gray-50":""}`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base mr-3 flex-shrink-0" style={{background:(cat?.color||"#94A3B8")+"15"}}>{cat?.emoji||"📦"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-semibold text-gray-800 truncate">{t.description}</p>
                      {t.recurrent&&<span className="text-xs px-1.5 py-0.5 rounded-full" style={{background:"#ECFDF5",color:"#10B981"}}>🔁 {RECURRENCE_OPTS.find(r=>r.value===t.recurrence_type)?.label}</span>}
                      {t.projected&&<span className="text-xs px-1.5 py-0.5 rounded-full" style={{background:"#EFF6FF",color:"#3B82F6"}}>Projeção</span>}
                    </div>
                    <p className="text-xs text-gray-400">{cat?.name||"—"} • {Dt(t.date)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-bold" style={{color:t.type==="income"?"#10B981":"#EF4444"}}>{t.type==="income"?"+":"-"}{R(t.amount)}</p>
                      {!t.projected?(
                        <button onClick={()=>onToggle(t)} className="text-xs px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-75"
                          style={{background:ok?"rgba(16,185,129,0.1)":"rgba(245,158,11,0.1)",color:ok?"#10B981":"#F59E0B"}}>
                          {ok?"✅ ":""}{t.status==="paid"?"Pago":t.status==="received"?"Recebido":"⏳ Pendente"}
                        </button>
                      ):(
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{background:"rgba(59,130,246,0.1)",color:"#3B82F6"}}>Projeção</span>
                      )}
                    </div>
                    {!t.projected&&(
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={()=>onEdit(t)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-300 hover:text-blue-500 cursor-pointer" title="Editar">✏️</button>
                        {t.recurrent&&!t.recurrence_end&&(
                          <button onClick={()=>{if(confirm("Cancelar recorrência a partir deste mês?")) onCancelRecurrence(t, month)}}
                            className="p-1.5 rounded-lg hover:bg-orange-50 text-gray-300 hover:text-orange-500 cursor-pointer" title="Cancelar recorrência">🔕</button>
                        )}
                        <button onClick={()=>onDelete(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 cursor-pointer" title="Excluir">🗑️</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {invoiceModal&&(
        <Modal title={`Fatura ${invoiceModal.card.name}`} onClose={()=>setInvoiceModal(null)} wide>
          <div className="flex items-center justify-between px-1 mb-2">
            <div><p className="text-xs text-gray-400">Vencimento</p><p className="text-sm font-bold text-gray-800">{Dt(invoiceModal.dueDate)}</p></div>
            <div className="text-right"><p className="text-xs text-gray-400">Total</p><p className="text-xl font-bold text-red-500">{R(invoiceModal.total)}</p></div>
          </div>
          <div className="rounded-2xl overflow-hidden border border-gray-100">
            {invoiceModal.txs.map((t,i)=>{
              const cat=allCats.find(c=>c.id===t.category_id)
              const ok=t.status==="paid"
              return(
                <div key={t.id} className={`flex items-center px-4 py-3 hover:bg-gray-50 ${i<invoiceModal.txs.length-1?"border-b border-gray-50":""}`}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm mr-3 flex-shrink-0" style={{background:(cat?.color||"#94A3B8")+"15"}}>{cat?.emoji||"📦"}</div>
                  <div className="flex-1"><p className="text-sm font-semibold text-gray-800">{t.description}</p><p className="text-xs text-gray-400">{cat?.name} • {Dt(t.date)}</p></div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-500">{R(t.amount)}</p>
                    <span className="text-xs" style={{color:ok?"#10B981":"#F59E0B"}}>{ok?"✅ Pago":"⏳ Pendente"}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 pt-1">
            <GhostBtn full onClick={()=>setInvoiceModal(null)}>Fechar</GhostBtn>
            {!invoiceModal.allPaid&&(
              <GreenBtn full onClick={()=>{invoiceModal.txs.forEach(t=>onToggle(t));setInvoiceModal(null)}}>✅ Marcar fatura como paga</GreenBtn>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── CARDS SCREEN ───────────────────────────────────────────────────────────────
function CardsScreen({cards,txns,allCats,month,onAdd,onEdit,onDelete}){
  const [active,setActive]=useState(cards[0]?.id||null)
  const allInvoices=useMemo(()=>getAllCardInvoices(txns,cards),[txns,cards])
  const invoice=useMemo(()=>allInvoices.find(inv=>inv.card.id===active&&inv.invMonth===month),[allInvoices,active,month])
  const stmnt=invoice?.txs||[]
  const stTotal=invoice?.total||0
  const cardUsage=cards.map(c=>{
    const inv=allInvoices.find(i=>i.card.id===c.id&&i.invMonth===month)
    return{...c,used:inv?.total||0}
  })
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cardUsage.map(c=>{const sel=active===c.id;return(
              <div key={c.id} onClick={()=>setActive(c.id)} className="cursor-pointer rounded-2xl p-5 shadow-sm hover:shadow-md transition-all"
                style={{background:sel?c.color:"white",border:sel?`2px solid ${c.color}`:"1px solid #F1F5F9"}}>
                <div className="flex justify-between items-start mb-5">
                  <p className="font-bold text-lg" style={{color:sel?"white":c.color}}>💳 {c.name}</p>
                  <div className="flex gap-1">
                    <button onClick={e=>{e.stopPropagation();onEdit(c)}} className="opacity-60 hover:opacity-100 cursor-pointer" style={{color:sel?"white":"#9CA3AF"}}>✏️</button>
                    <button onClick={e=>{e.stopPropagation();onDelete(c.id)}} className="opacity-60 hover:opacity-100 cursor-pointer" style={{color:sel?"white":"#9CA3AF"}}>🗑️</button>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full mb-2" style={{background:sel?"rgba(255,255,255,0.3)":"#F3F4F6"}}>
                  <div className="h-full rounded-full" style={{width:`${Math.min(c.used/c.limit_amount*100,100)}%`,background:sel?"white":c.color}}/>
                </div>
                <div className="flex justify-between text-xs mb-1" style={{color:sel?"rgba(255,255,255,0.7)":"#9CA3AF"}}>
                  <span>{R(c.used)} usado</span><span>{R(c.limit_amount-c.used)} livre</span>
                </div>
                <p className="text-xs mt-2" style={{color:sel?"rgba(255,255,255,0.5)":"#C4C9D4"}}>Fecha d.{c.closing_day} • Vence d.{c.due_day}</p>
              </div>
            )})}
          </div>
          {active&&(
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-50 flex justify-between">
                <p className="font-semibold text-gray-800 text-sm">Fatura — {cards.find(c=>c.id===active)?.name} ({monthLabel(month)})</p>
                <span className="text-sm font-bold text-red-500">{R(stTotal)}</span>
              </div>
              {stmnt.length===0?<p className="text-sm text-gray-400 text-center py-10">Sem gastos nesta fatura</p>:
                stmnt.map((t,i)=>{const cat=allCats.find(c=>c.id===t.category_id);return(
                  <div key={t.id} className={`flex items-center px-5 py-3 hover:bg-gray-50 ${i<stmnt.length-1?"border-b border-gray-50":""}`}>
                    <span className="text-base mr-3">{cat?.emoji||"📦"}</span>
                    <div className="flex-1"><p className="text-sm font-medium text-gray-800">{t.description}</p><p className="text-xs text-gray-400">{cat?.name} • {Dt(t.date)}</p></div>
                    <span className="text-sm font-bold text-red-500">{R(t.amount)}</span>
                  </div>
                )})}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── CATEGORIES ─────────────────────────────────────────────────────────────────
function CatsScreen({cats,onAdd,onEdit,onDelete}){
  const [tab,setTab]=useState("expense")
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
  )
}

// ── REPORTS ────────────────────────────────────────────────────────────────────
function Reports({txns,cards,cats,month}){
  const allCats=useMemo(()=>[...cats.expense,...cats.income],[cats])

  const chartData=useMemo(()=>Array.from({length:6},(_,i)=>{
    const m=shiftMonth(month,i-5)
    const [,mo]=m.split("-").map(Number)
    const s=computeMonthSummary(txns,cards,m)
    return{
      label:MONTHS[mo-1].slice(0,3),
      inc:s.incomeReceived,
      exp:s.expensePaid,
      bal:s.balance
    }
  }),[txns,cards,month])

  const curSummary=useMemo(()=>computeMonthSummary(txns,cards,month),[txns,cards,month])

  const catData=useMemo(()=>{
    const g={}
    // despesas avulsas pagas
    curSummary.mTxns
      .filter(t=>t.type==="expense"&&t.status==="paid"&&!t.card_id)
      .forEach(t=>{ g[t.category_id]=(g[t.category_id]||0)+t.amount })
    // faturas pagas
    curSummary.invoices
      .filter(inv=>inv.allPaid)
      .forEach(inv=>{ g[`card_${inv.card.id}`]=(g[`card_${inv.card.id}`]||0)+inv.total })

    return Object.entries(g)
      .map(([id,v])=>{
        if(id.startsWith("card_")){
          const c=cards.find(x=>x.id===id.replace("card_",""))
          return{name:`Fatura ${c?.name||"Cartão"}`,value:v,color:c?.color||"#8B5CF6"}
        }
        const c=allCats.find(x=>x.id===id)
        return{name:c?.name||"Outros",value:v,color:c?.color||"#94A3B8"}
      })
      .filter(c=>c.value>0)
      .sort((a,b)=>b.value-a.value)
  },[curSummary,allCats,cards])

  const total=catData.reduce((s,c)=>s+c.value,0)

  const totals={
    inc: chartData.reduce((s,m)=>s+m.inc,0),
    exp: chartData.reduce((s,m)=>s+m.exp,0),
  }

  return(
    <div className="space-y-5">
      <p className="text-base font-bold text-gray-900">Relatórios</p>

      {/* Resumo 6 meses */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          {label:"Total Recebido (6m)", value:totals.inc, color:"#10B981", bg:"#ECFDF5", icon:"📈"},
          {label:"Total Pago (6m)",     value:totals.exp, color:"#EF4444", bg:"#FEF2F2", icon:"📉"},
          {label:"Saldo Acumulado",     value:totals.inc-totals.exp, color:(totals.inc-totals.exp)>=0?"#10B981":"#EF4444", bg:(totals.inc-totals.exp)>=0?"#ECFDF5":"#FEF2F2", icon:"💰"},
        ].map(k=>(
          <div key={k.label} className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <p className="text-xs font-medium text-gray-400">{k.label}</p>
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-sm" style={{background:k.bg}}>{k.icon}</div>
            </div>
            <p className="text-lg font-bold" style={{color:k.color}}>{R(k.value)}</p>
          </div>
        ))}
      </div>

      {/* Gráfico barras */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <p className="text-sm font-semibold text-gray-800 mb-4">Receitas vs Despesas — Últimos 6 Meses</p>
        {chartData.every(m=>m.inc===0&&m.exp===0)
          ?<p className="text-sm text-gray-400 text-center py-10">Nenhum dado no período</p>
          :(
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barGap={4} barCategoryGap="30%">
              <XAxis dataKey="label" tick={{fontSize:12,fill:"#9CA3AF"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:"#9CA3AF"}} axisLine={false} tickLine={false} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip formatter={v=>R(v)} contentStyle={{borderRadius:12,border:"none",boxShadow:"0 4px 20px rgba(0,0,0,0.1)"}}/>
              <Bar dataKey="inc" name="Receitas" fill="#10B981" radius={[5,5,0,0]}/>
              <Bar dataKey="exp" name="Despesas" fill="#EF4444" radius={[5,5,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Por categoria */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Despesas por Categoria — {monthLabel(month)}</p>
          {catData.length===0
            ?<p className="text-sm text-gray-400 text-center py-6">Sem despesas pagas neste mês</p>
            :(
            <div className="space-y-3">
              {catData.map((c,i)=>(
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-gray-700">{c.name}</span>
                    <span className="text-gray-400">{R(c.value)} ({total?Math.round(c.value/total*100):0}%)</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-100">
                    <div className="h-full rounded-full transition-all" style={{width:`${total?c.value/total*100:0}%`,background:c.color}}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Saldo por mês */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-gray-800 mb-4">Saldo por Mês</p>
          {chartData.every(m=>m.bal===0)
            ?<p className="text-sm text-gray-400 text-center py-6">Sem dados no período</p>
            :(
            <div className="space-y-3">
              {chartData.map((m,i)=>{
                const max=Math.max(...chartData.map(x=>Math.abs(x.bal)),1)
                return(
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-8 flex-shrink-0">{m.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{width:`${Math.min(Math.abs(m.bal)/max*100,100)}%`,background:m.bal>=0?"#10B981":"#EF4444"}}/>
                    </div>
                    <span className="text-xs font-bold w-28 text-right flex-shrink-0" style={{color:m.bal>=0?"#10B981":"#EF4444"}}>{R(m.bal)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── AI TIP ─────────────────────────────────────────────────────────────────────
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
  )
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App(){
  const [session,setSession]=useState(null)
  const [appLoading,setAppLoading]=useState(true)
  const [txns,setTxns]=useState([])
  const [cards,setCards]=useState([])
  const [cats,setCats]=useState({expense:[],income:[]})
  const [dataLoading,setDataLoading]=useState(false)
  const [scr,setScr]=useState("dashboard")
  const [month,setMonth]=useState(()=>new Date().toISOString().slice(0,7))

  const [txMod,setTxMod]=useState(false)
  const [cardMod,setCardMod]=useState(false)
  const [catMod,setCatMod]=useState(false)
  const [editTxId,setEditTxId]=useState(null)
  const [editCardId,setEditCardId]=useState(null)
  const [editCatId,setEditCatId]=useState(null)

  const blankTx={type:"expense",description:"",amount:"",category_id:"",date:today(),status:"pending",card_id:"",recurrent:false,recurrence_type:"monthly",recurrence_end:"",installments:"1"}
  const [txF,setTxF]=useState(blankTx)
  const [cardF,setCardF]=useState({name:"",color:"#8B5CF6",limit_amount:"",closing_day:"",due_day:""})
  const [catF,setCatF]=useState({name:"",color:"#10B981",emoji:"💡",type:"expense"})
  const [aiTip,setAiTip]=useState(null)
  const [aiLoad,setAiLoad]=useState(false)

  const allCats=useMemo(()=>[...cats.expense,...cats.income],[cats])

  // Summaries calculados uma única vez, compartilhados entre todas as telas
  const summary=useMemo(()=>computeMonthSummary(txns,cards,month),[txns,cards,month])
  const nextMonth=useMemo(()=>shiftMonth(month,1),[month])
  const nextSummary=useMemo(()=>computeMonthSummary(txns,cards,nextMonth),[txns,cards,nextMonth])

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setSession(session); setAppLoading(false)
      if(session) loadData(session.user.id)
    })
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setSession(session)
      if(session) loadData(session.user.id)
      else{ setTxns([]); setCards([]); setCats({expense:[],income:[]}) }
    })
    return ()=>subscription.unsubscribe()
  },[])

  const loadData=useCallback(async userId=>{
    setDataLoading(true)
    const [catsRes,cardsRes,txRes]=await Promise.all([
      supabase.from("categories").select("*").eq("user_id",userId).order("name"),
      supabase.from("credit_cards").select("*").eq("user_id",userId).order("name"),
      supabase.from("transactions").select("*").eq("user_id",userId).order("date",{ascending:false}),
    ])
    let catsData=catsRes.data||[]
    if(catsData.length===0){
      const {data:seeded}=await supabase.from("categories").insert(DEF_CATS.map(c=>({...c,user_id:userId}))).select()
      catsData=seeded||[]
    }
    setCats({expense:catsData.filter(c=>c.type==="expense"),income:catsData.filter(c=>c.type==="income")})
    setCards(cardsRes.data||[])
    setTxns(txRes.data||[])
    setDataLoading(false)
  },[])

  if(appLoading) return(
    <div className="min-h-screen flex items-center justify-center" style={{background:"#0F172A"}}>
      <div className="text-center"><div className="text-5xl mb-3">💰</div><p className="text-white text-sm animate-pulse">Carregando...</p></div>
    </div>
  )
  if(!session) return <AuthScreen/>

  const userId=session.user.id

  // ── Transactions
  const openAddTx=()=>{setTxF(blankTx);setEditTxId(null);setTxMod(true)}
  const openEditTx=t=>{setTxF({...t,amount:String(t.amount),card_id:t.card_id||"",installments:"1",recurrence_end:t.recurrence_end||""});setEditTxId(t.id);setTxMod(true)}

  // Cancela recorrência a partir do mês atual (seta recurrence_end = mês anterior)
  const cancelRecurrence=async(t, fromMonth)=>{
    const endMonth = shiftMonth(fromMonth, -1) // encerra no mês anterior ao atual
    const {data}=await supabase.from("transactions").update({recurrence_end: endMonth}).eq("id",t.id).select().single()
    if(data) setTxns(p=>p.map(x=>x.id===t.id?data:x))
  }

  const saveTx=async()=>{
    if(!txF.description||!txF.amount||!txF.category_id) return
    const totalAmount=parseFloat(txF.amount)
    const installments=txF.card_id&&!txF.recurrent?Math.max(1,parseInt(txF.installments)||1):1
    const installmentAmount=parseFloat((totalAmount/installments).toFixed(2))
    const installmentGroupId=crypto.randomUUID()

    const rows=Array.from({length:installments},(_,i)=>{
      const d=new Date(txF.date+"T12:00:00"); d.setMonth(d.getMonth()+i)
      return{
        user_id:userId, type:txF.type,
        description:installments>1?`${txF.description} (${i+1}/${installments})`:txF.description,
        amount:installmentAmount, category_id:txF.category_id,
        date:d.toISOString().split("T")[0], status:txF.status,
        card_id:txF.card_id||null,
        recurrent:txF.recurrent, recurrence_type:txF.recurrent?txF.recurrence_type:null,
        recurrence_end:txF.recurrent&&txF.recurrence_end?txF.recurrence_end:null,
        installment_group:installments>1?installmentGroupId:null,
        installment_index:installments>1?i+1:null,
        installment_total:installments>1?installments:null,
      }
    })

    if(editTxId){
      const {data}=await supabase.from("transactions").update(rows[0]).eq("id",editTxId).select().single()
      if(data) setTxns(p=>p.map(t=>t.id===editTxId?data:t))
    } else {
      const {data}=await supabase.from("transactions").insert(rows).select()
      if(data){ setTxns(p=>[...data,...p]); triggerAI(data[0]) }
    }
    setTxMod(false)
  }

  const toggleTx=async t=>{
    if(t.projected) return
    const newStatus=t.type==="income"?(t.status==="received"?"pending":"received"):(t.status==="paid"?"pending":"paid")
    const {data}=await supabase.from("transactions").update({status:newStatus}).eq("id",t.id).select().single()
    if(data) setTxns(p=>p.map(x=>x.id===t.id?data:x))
  }

  const deleteTx=async id=>{
    await supabase.from("transactions").delete().eq("id",id)
    setTxns(p=>p.filter(t=>t.id!==id))
  }

  // ── Cards
  const openAddCard=()=>{setCardF({name:"",color:"#8B5CF6",limit_amount:"",closing_day:"",due_day:""});setEditCardId(null);setCardMod(true)}
  const openEditCard=c=>{setCardF({...c,limit_amount:String(c.limit_amount),closing_day:String(c.closing_day),due_day:String(c.due_day)});setEditCardId(c.id);setCardMod(true)}
  const saveCard=async()=>{
    if(!cardF.name||!cardF.limit_amount) return
    const payload={user_id:userId,name:cardF.name,color:cardF.color,limit_amount:parseFloat(cardF.limit_amount),closing_day:parseInt(cardF.closing_day)||1,due_day:parseInt(cardF.due_day)||10}
    if(editCardId){
      const {data}=await supabase.from("credit_cards").update(payload).eq("id",editCardId).select().single()
      if(data) setCards(p=>p.map(c=>c.id===editCardId?data:c))
    } else {
      const {data}=await supabase.from("credit_cards").insert(payload).select().single()
      if(data) setCards(p=>[...p,data])
    }
    setCardMod(false)
  }
  const deleteCard=async id=>{
    await supabase.from("credit_cards").delete().eq("id",id)
    setCards(p=>p.filter(c=>c.id!==id))
  }

  // ── Categories
  const openAddCat=type=>{setCatF({name:"",color:"#10B981",emoji:"💡",type});setEditCatId(null);setCatMod(true)}
  const openEditCat=(c,type)=>{setCatF({...c,type});setEditCatId(c.id);setCatMod(true)}
  const saveCat=async()=>{
    if(!catF.name) return
    const payload={user_id:userId,name:catF.name,color:catF.color,emoji:catF.emoji,type:catF.type}
    const t=catF.type
    if(editCatId){
      const {data}=await supabase.from("categories").update(payload).eq("id",editCatId).select().single()
      if(data) setCats(p=>({...p,[t]:p[t].map(c=>c.id===editCatId?data:c)}))
    } else {
      const {data}=await supabase.from("categories").insert(payload).select().single()
      if(data) setCats(p=>({...p,[t]:[...p[t],data]}))
    }
    setCatMod(false)
  }
  const deleteCat=async(id,type)=>{
    await supabase.from("categories").delete().eq("id",id)
    setCats(p=>({...p,[type]:p[type].filter(c=>c.id!==id)}))
  }

  // ── AI
  const triggerAI=async tx=>{
    setAiLoad(true); setAiTip("loading")
    const cat=allCats.find(c=>c.id===tx.category_id)
    try{
      const { data, error } = await supabase.functions.invoke("ai-tip", {
        body: {
          prompt: `Lançamento: ${R(tx.amount)} em "${cat?.name}". Receita mês: ${R(summary.incomeReceived)}. Despesas: ${R(summary.expensePaid)}. ${tx.recurrent?"É recorrente.":""} Dê uma dica financeira curta e prática.`
        }
      })
      if(error) throw error
      setAiTip(data?.tip || "Continue acompanhando suas finanças!")
    } catch(e) {
      setAiTip("Registrar todos os gastos é o primeiro passo para o controle financeiro!")
    }
    setAiLoad(false)
  }

  const nav=[
    {id:"dashboard",   label:"Visão Geral", icon:"🏠"},
    {id:"transactions",label:"Lançamentos", icon:"📋"},
    {id:"cards",       label:"Cartões",     icon:"💳"},
    {id:"categories",  label:"Categorias",  icon:"🏷️"},
    {id:"reports",     label:"Relatórios",  icon:"📊"},
  ]

  return(
    <div className="min-h-screen flex" style={{background:"#F8FAFC"}}>
      {/* Sidebar desktop */}
      <div className="hidden md:flex w-56 flex-shrink-0 flex-col" style={{background:"#0F172A"}}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-base" style={{background:"linear-gradient(135deg,#10B981,#059669)"}}>💰</div>
            <div>
              <p className="text-white font-bold text-sm">FinançasCasa</p>
              <p className="text-gray-500 text-xs truncate">{session.user.user_metadata?.name||session.user.email?.split("@")[0]}</p>
            </div>
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
          <button onClick={()=>supabase.auth.signOut()} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer">
            <span>🚪</span>Sair
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="bg-white border-b border-gray-100 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm md:text-base font-bold text-gray-900 truncate">{nav.find(n=>n.id===scr)?.icon} {nav.find(n=>n.id===scr)?.label}</p>
            <p className="text-xs text-gray-400 hidden md:block">{monthLabel(month)}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 border border-gray-200 rounded-xl overflow-hidden">
              <button onClick={()=>setMonth(shiftMonth(month,-1))} className="px-2 md:px-3 py-2 text-gray-400 hover:bg-gray-50 cursor-pointer">‹</button>
              <span className="px-2 md:px-3 text-xs md:text-sm font-medium text-gray-700 whitespace-nowrap">{monthLabel(month)}</span>
              <button onClick={()=>setMonth(shiftMonth(month,1))} className="px-2 md:px-3 py-2 text-gray-400 hover:bg-gray-50 cursor-pointer">›</button>
            </div>
            <GreenBtn sm onClick={openAddTx}>➕ <span className="hidden md:inline">Lançamento</span></GreenBtn>
          </div>
        </div>

        <div className="flex-1 p-3 md:p-6 overflow-auto pb-20 md:pb-6">
          {dataLoading?(
            <div className="flex items-center justify-center h-64"><p className="text-gray-400 animate-pulse">Carregando dados...</p></div>
          ):(
            <>
              {scr==="dashboard"&&<Dashboard summary={summary} nextSummary={nextSummary} nextMonth={nextMonth} allCats={allCats} cards={cards} onToggle={toggleTx}/>}
              {scr==="transactions"&&<Transactions summary={summary} allCats={allCats} cards={cards} txns={txns} month={month} onEdit={openEditTx} onDelete={deleteTx} onToggle={toggleTx} onCancelRecurrence={cancelRecurrence}/>}
              {scr==="cards"&&<CardsScreen cards={cards} txns={txns} allCats={allCats} month={month} onAdd={openAddCard} onEdit={openEditCard} onDelete={deleteCard}/>}
              {scr==="categories"&&<CatsScreen cats={cats} onAdd={openAddCat} onEdit={openEditCat} onDelete={deleteCat}/>}
              {scr==="reports"&&<Reports txns={txns} cards={cards} cats={cats} month={month}/>}
            </>
          )}
        </div>
      </div>

      {/* Modal Lançamento */}
      {txMod&&(
        <Modal title={editTxId?"Editar Lançamento":"Novo Lançamento"} onClose={()=>setTxMod(false)} wide>
          <Tabs opts={[["expense","Despesa"],["income","Receita"]]} val={txF.type} onChange={v=>setTxF({...txF,type:v,category_id:""})}/>
          <Inp label="Descrição" placeholder="Ex: Supermercado" value={txF.description} onChange={e=>setTxF({...txF,description:e.target.value})}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Valor (R$)" type="number" placeholder="0,00" value={txF.amount} onChange={e=>setTxF({...txF,amount:e.target.value})}/>
            <Inp label="Data" type="date" value={txF.date} onChange={e=>setTxF({...txF,date:e.target.value})}/>
          </div>
          <Sel label="Categoria" value={txF.category_id} onChange={e=>setTxF({...txF,category_id:e.target.value})}>
            <option value="">Selecione...</option>
            {cats[txF.type].map(c=><option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </Sel>
          <div className="grid grid-cols-2 gap-3">
            <Sel label="Status" value={txF.status} onChange={e=>setTxF({...txF,status:e.target.value})}>
              {txF.type==="expense"?<><option value="pending">Pendente</option><option value="paid">Pago</option></>:<><option value="pending">A receber</option><option value="received">Recebido</option></>}
            </Sel>
            {txF.type==="expense"&&(
              <Sel label="Cartão (opcional)" value={txF.card_id||""} onChange={e=>setTxF({...txF,card_id:e.target.value||null,installments:"1"})}>
                <option value="">Débito / Dinheiro</option>
                {cards.map(c=><option key={c.id} value={c.id}>💳 {c.name}</option>)}
              </Sel>
            )}
          </div>
          {txF.type==="expense"&&txF.card_id&&!txF.recurrent&&(
            <div className="rounded-xl border border-blue-100 p-4 space-y-2" style={{background:"#EFF6FF"}}>
              <p className="text-sm font-semibold text-blue-800">💳 Parcelamento</p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <Sel label="Número de parcelas" value={txF.installments} onChange={e=>setTxF({...txF,installments:e.target.value})}>
                  {Array.from({length:24},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}x {n>1?`de ${R(parseFloat(txF.amount||0)/n)}`:"(à vista)"}</option>)}
                </Sel>
                <div>
                  <p className="text-xs text-blue-600 font-medium">Valor por parcela</p>
                  <p className="text-lg font-bold text-blue-800">{R(parseFloat(txF.amount||0)/Math.max(1,parseInt(txF.installments)||1))}</p>
                </div>
              </div>
              {parseInt(txF.installments)>1&&(
                <p className="text-xs text-blue-500">📅 {txF.installments} parcelas a partir de {new Date(txF.date+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</p>
              )}
            </div>
          )}
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
              <>
                <Sel label="Frequência" value={txF.recurrence_type} onChange={e=>setTxF({...txF,recurrence_type:e.target.value})}>
                  {RECURRENCE_OPTS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                </Sel>
                <div className="w-full">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Encerrar em (opcional)</label>
                  <input type="month" value={txF.recurrence_end||""} onChange={e=>setTxF({...txF,recurrence_end:e.target.value})}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-emerald-400 bg-white"
                    placeholder="Sem data de encerramento"/>
                  {txF.recurrence_end&&(
                    <p className="text-xs text-orange-500 mt-1">⚠️ Última cobrança em {monthLabel(txF.recurrence_end)}</p>
                  )}
                </div>
              </>
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
          <Inp label="Limite (R$)" type="number" value={cardF.limit_amount} onChange={e=>setCardF({...cardF,limit_amount:e.target.value})}/>
          <div className="grid grid-cols-2 gap-3">
            <Inp label="Dia Fechamento" type="number" min="1" max="31" value={cardF.closing_day} onChange={e=>setCardF({...cardF,closing_day:e.target.value})}/>
            <Inp label="Dia Vencimento" type="number" min="1" max="31" value={cardF.due_day} onChange={e=>setCardF({...cardF,due_day:e.target.value})}/>
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
          <div className="flex gap-3 pt-1">
            <GhostBtn full onClick={()=>setCardMod(false)}>Cancelar</GhostBtn>
            <GreenBtn full onClick={saveCard}>Salvar</GreenBtn>
          </div>
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
          <div className="flex gap-3 pt-1">
            <GhostBtn full onClick={()=>setCatMod(false)}>Cancelar</GhostBtn>
            <GreenBtn full onClick={saveCat}>Salvar</GreenBtn>
          </div>
        </Modal>
      )}

      {/* Bottom nav mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 flex z-40" style={{paddingBottom:"env(safe-area-inset-bottom)"}}>
        {nav.map(n=>(
          <button key={n.id} onClick={()=>setScr(n.id)} className="flex-1 flex flex-col items-center py-2.5 gap-0.5 cursor-pointer"
            style={{color:scr===n.id?"#10B981":"#9CA3AF"}}>
            <span className="text-xl leading-none">{n.icon}</span>
            <span className="text-xs font-medium">{n.label.split(" ")[0]}</span>
          </button>
        ))}
        <button onClick={()=>supabase.auth.signOut()} className="flex-1 flex flex-col items-center py-2.5 gap-0.5 cursor-pointer text-gray-300">
          <span className="text-xl leading-none">🚪</span>
          <span className="text-xs font-medium">Sair</span>
        </button>
      </div>

      {aiTip&&<AiTip tip={aiTip} loading={aiLoad} onClose={()=>setAiTip(null)}/>}
    </div>
  )
}