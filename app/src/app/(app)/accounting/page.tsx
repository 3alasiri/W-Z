import { requireStore } from "@/lib/supabase-server";
import { SAR, num } from "@/lib/format";
import AccountingForms from "./AccountingForms";

type Bal = { code: string; name: string; type: string; debit: number; credit: number };
const TABS = [["pl", "الأرباح والخسائر"], ["vat", "الضريبة"], ["tb", "ميزان المراجعة"], ["je", "القيود"]] as const;

export default async function Accounting({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { sb, storeId, role } = await requireStore();
  if (role !== "owner" && role !== "manager") return <div className="card">المحاسبة متاحة للمالك والمدير فقط.</div>;

  const now = new Date();
  const from = sp.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = sp.to ?? now.toISOString().slice(0, 10);
  const tab = sp.tab ?? "pl";

  const [{ data: period }, { data: all }, { data: entries }] = await Promise.all([
    sb.rpc("account_balances", { p_store: storeId, p_from: from, p_to: to }),
    sb.rpc("account_balances", { p_store: storeId, p_from: "2000-01-01", p_to: to }),
    tab === "je" ? sb.from("journal_entries").select("id,number,entry_date,memo,journal_lines(debit,credit,accounts(code,name))").eq("store_id", storeId)
      .gte("entry_date", from).lte("entry_date", to).order("number", { ascending: false }).limit(100) : Promise.resolve({ data: null }),
  ]);
  const P = (period ?? []) as Bal[]; const A = (all ?? []) as Bal[];
  const net = (b: Bal) => (b.type === "asset" || b.type === "expense" ? b.debit - b.credit : b.credit - b.debit);
  const g = (rows: Bal[], code: string) => { const b = rows.find((x) => x.code === code); return b ? net(b) : 0; };

  const revenue = g(P, "4100"), cogs = g(P, "5100");
  const expenses = P.filter((b) => b.type === "expense" && b.code !== "5100" && net(b) !== 0);
  const totalExp = expenses.reduce((a, b) => a + net(b), 0);
  const gross = revenue - cogs, profit = gross - totalExp;
  const vatOut = P.find((x) => x.code === "2200")?.credit ?? 0, vatIn = P.find((x) => x.code === "1400")?.debit ?? 0;

  const q = (t: string) => `?tab=${t}&from=${from}&to=${to}`;
  return (<>
    <div className="head"><div><h1>المحاسبة</h1><div className="sub">كل عملية بيع واستلام وسداد وتالف تُقيَّد تلقائيًا بقيد مزدوج.</div></div>
      <form className="chips" style={{ alignItems: "end" }}>
        <input type="hidden" name="tab" value={tab} />
        <div className="field"><label htmlFor="f">من</label><input id="f" type="date" name="from" defaultValue={from} /></div>
        <div className="field"><label htmlFor="t">إلى</label><input id="t" type="date" name="to" defaultValue={to} /></div>
        <button className="btn">عرض</button>
      </form></div>
    <div className="grid g4">
      <div className="card kpi"><div className="l">صافي المبيعات</div><div className="v">{SAR(revenue)}</div></div>
      <div className="card kpi"><div className="l">مجمل الربح</div><div className="v">{SAR(gross)}</div><div className="muted" style={{ fontSize: 12 }}>هامش {revenue ? num(Math.round(gross / revenue * 1000) / 10) : 0}٪</div></div>
      <div className="card kpi"><div className="l">صافي الربح</div><div className="v" style={{ color: profit < 0 ? "var(--bad)" : "var(--ok)" }}>{SAR(profit)}</div></div>
      <div className="card kpi"><div className="l">النقد المتاح (صندوق + بنك)</div><div className="v">{SAR(g(A, "1100") + g(A, "1110"))}</div></div>
    </div>
    <div className="chips">{TABS.map(([k, t]) => <a key={k} className={`btn sm ${tab === k ? "" : "ghost"}`} href={q(k)}>{t}</a>)}</div>

    {tab === "pl" && <div className="card" style={{ maxWidth: 640 }}><h2>قائمة الدخل من {from} إلى {to}</h2>
      <div className="total"><span>المبيعات (قبل الضريبة)</span><span>{SAR(revenue)}</span></div>
      <div className="total"><span>تكلفة البضاعة المباعة</span><span>({SAR(cogs)})</span></div>
      <div className="total big"><span>مجمل الربح</span><span>{SAR(gross)}</span></div>
      {expenses.map((b) => <div className="total" key={b.code}><span>{b.name}</span><span>({SAR(net(b))})</span></div>)}
      <div className="total big"><span>صافي الربح</span><span>{SAR(profit)}</span></div>
    </div>}

    {tab === "vat" && <div className="card" style={{ maxWidth: 640 }}><h2>إقرار ضريبة القيمة المضافة من {from} إلى {to}</h2>
      <div className="total"><span>المبيعات الخاضعة للضريبة</span><span>{SAR(revenue)}</span></div>
      <div className="total"><span>ضريبة المخرجات (على المبيعات)</span><span>{SAR(vatOut)}</span></div>
      <div className="total"><span>ضريبة المدخلات (على المشتريات والمصروفات)</span><span>({SAR(vatIn)})</span></div>
      <div className="total big"><span>{vatOut - vatIn >= 0 ? "الضريبة المستحقة للسداد" : "رصيد ضريبي مسترد"}</span><span>{SAR(Math.abs(vatOut - vatIn))}</span></div>
      <p className="muted" style={{ fontSize: 12 }}>أرقام استرشادية من دفاترك. راجعها قبل تقديم الإقرار لهيئة الزكاة والضريبة والجمارك.</p>
    </div>}

    {tab === "tb" && <div className="card tbl"><h2>ميزان المراجعة حتى {to}</h2><table><thead><tr><th>الرمز</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
      <tbody>{A.filter((b) => b.debit || b.credit).map((b) => <tr key={b.code}><td>{b.code}</td><td>{b.name}</td><td>{SAR(b.debit)}</td><td>{SAR(b.credit)}</td><td><b>{SAR(net(b))}</b></td></tr>)}
        <tr><td></td><td><b>المجموع</b></td><td><b>{SAR(A.reduce((a, b) => a + Number(b.debit), 0))}</b></td><td><b>{SAR(A.reduce((a, b) => a + Number(b.credit), 0))}</b></td><td></td></tr></tbody></table></div>}

    {tab === "je" && <div className="card"><h2>القيود من {from} إلى {to}</h2><div className="list">
      {((entries ?? []) as unknown as { id: string; number: number; entry_date: string; memo: string; journal_lines: { debit: number; credit: number; accounts: { code: string; name: string } }[] }[]).map((e) => (
        <div key={e.id} className="row" style={{ alignItems: "flex-start" }}><div style={{ flex: 1, minWidth: 0 }}>
          <div className="t">#{num(e.number)} · {e.memo}</div><div className="s">{e.entry_date}</div>
          <div className="tbl"><table><tbody>{e.journal_lines.map((l, i) => <tr key={i}><td>{l.accounts.name}</td><td>{Number(l.debit) ? SAR(l.debit) : ""}</td><td>{Number(l.credit) ? SAR(l.credit) : ""}</td></tr>)}</tbody></table></div>
        </div></div>))}
      {!entries?.length && <p className="muted">لا قيود في هذه الفترة.</p>}
    </div></div>}

    <AccountingForms storeId={storeId} isOwner={role === "owner"} />
  </>);
}
