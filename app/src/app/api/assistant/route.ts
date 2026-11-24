import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer } from "@/lib/supabase-server";
import { storeSnapshot } from "@/lib/store-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSTRUCTIONS = `أنت المساعد الذكي لنظام "بقالتي الذكية"، تساعد مالك بقالة حي في السعودية على فهم متجره واتخاذ قرارات عملية.

- أجب بالعربية الفصحى المبسطة، باختصار ووضوح، وابدأ بالجواب مباشرة.
- اعتمد فقط على بيانات المتجر المرفقة. لا تخترع أرقامًا أو منتجات أو عملاء. إن لم تكفِ البيانات للإجابة، قل ذلك واذكر ما ينقص.
- اذكر الأرقام بالريال السعودي (ر.س) مع الوحدة، ووضّح الفترة الزمنية التي تتحدث عنها.
- عند التوصية، اذكر السبب من البيانات وما يجب فعله في النظام (مثلًا: صفحة الذكاء والتحليلات لتطبيق خصم، أو صفحة المشتريات لاعتماد أمر).
- استخدم قوائم قصيرة أو جدولًا صغيرًا عند المقارنة. لا تستخدم عناوين كبيرة.
- forecast_7d هو توقع الكمية المباعة في الأيام السبعة القادمة، days_cover عدد الأيام التي يكفيها المخزون، abc تصنيف الأصناف حسب مساهمتها في الإيراد.`;

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response("سجّل الدخول أولًا", { status: 401 });
  const { data: m } = await sb.from("store_members").select("role, stores(id,name)").eq("user_id", user.id).limit(1).maybeSingle();
  if (!m || (m.role !== "owner" && m.role !== "manager")) return new Response("المساعد متاح للمالك والمدير فقط", { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response("المساعد غير مفعّل: أضف المتغير ANTHROPIC_API_KEY في إعدادات الخادم.", { status: 503 });

  let messages: Msg[];
  try {
    const body = await req.json();
    messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter((x: Msg) => (x.role === "user" || x.role === "assistant") && typeof x.content === "string" && x.content.trim())
      .slice(-20).map((x: Msg) => ({ role: x.role, content: x.content.slice(0, 4000) }));
  } catch { return new Response("طلب غير صالح", { status: 400 }); }
  if (!messages.length || messages[messages.length - 1].role !== "user") return new Response("اكتب سؤالك", { status: 400 });

  const s = m.stores as unknown as { id: string; name: string };
  const snapshot = await storeSnapshot({ sb, storeId: s.id, storeName: s.name, role: m.role, userId: user.id });

  const client = new Anthropic();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const run = client.beta.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium" },
          system: [
            { type: "text", text: INSTRUCTIONS },
            { type: "text", text: `بيانات المتجر الحالية (JSON):\n${JSON.stringify(snapshot)}`, cache_control: { type: "ephemeral" } },
          ],
          messages,
        });
        for await (const ev of run) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
        }
        const final = await run.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(enc.encode("\n\nتعذّر الإجابة عن هذا السؤال. جرّب صياغة أخرى."));
        else if (final.stop_reason === "max_tokens") controller.enqueue(enc.encode("\n\n(انقطعت الإجابة لطولها. اطلب ملخصًا أقصر.)"));
      } catch (e) {
        const msg = e instanceof Anthropic.RateLimitError ? "المساعد مشغول الآن، حاول بعد دقيقة."
          : e instanceof Anthropic.AuthenticationError ? "مفتاح ANTHROPIC_API_KEY غير صالح."
          : e instanceof Anthropic.APIConnectionError ? "تعذّر الاتصال بخدمة الذكاء الاصطناعي."
          : e instanceof Anthropic.APIError ? `خطأ من خدمة الذكاء الاصطناعي (${e.status}).` : "حدث خطأ غير متوقع.";
        controller.enqueue(enc.encode(`\n\n${msg}`));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
