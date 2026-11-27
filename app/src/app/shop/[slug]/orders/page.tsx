import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase-server";
import { SAR, num, ORDER_STATUS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyOrders({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/login?next=/shop/${slug}/orders`);
  const { data: store } = await sb.rpc("shop_store", { p_slug: slug });
  const { data } = await sb.from("orders").select("id,number,status,total,created_at,customers!inner(user_id)")
    .eq("store_id", store?.id).eq("customers.user_id", user.id).order("created_at", { ascending: false }).limit(50);
  return (<>
    <header className="shop-top"><div className="in"><h1>طلباتي</h1><Link href={`/shop/${slug}`}>المتجر</Link></div></header>
    <div className="shop" style={{ marginTop: 14 }}>
      {(data ?? []).map((o) => (
        <Link key={o.id} href={`/shop/${slug}/orders/${o.id}`} className="row card" style={{ textDecoration: "none" }}>
          <div><div className="t">طلب #{num(o.number)}</div><div className="s">{new Date(o.created_at).toLocaleString("ar-SA")}</div></div>
          <div className="chips" style={{ alignItems: "center" }}><span>{SAR(o.total)}</span><span className={`pill ${ORDER_STATUS[o.status][1]}`}>{ORDER_STATUS[o.status][0]}</span></div>
        </Link>))}
      {!data?.length && <p className="muted">لا طلبات بعد.</p>}
    </div>
  </>);
}
