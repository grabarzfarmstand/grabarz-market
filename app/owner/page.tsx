import { desc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { products, settings } from "@/db/schema";
import OwnerDashboard from "./owner-dashboard";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  const user = await requireChatGPTUser("/owner");
  const db = getDb();
  const owner = await db.select().from(settings).where(eq(settings.id, "owner_user_id")).limit(1);
  if (!owner.length) await db.insert(settings).values({ id: "owner_user_id", value: user.userId }).onConflictDoNothing();
  const confirmed = await db.select().from(settings).where(eq(settings.id, "owner_user_id")).limit(1);
  if (!confirmed.length || confirmed[0].value !== user.userId) return <main className="owner-page"><div className="wrap owner-main"><div className="owner-card"><h1>Owner access only</h1><p>This dashboard belongs to the store owner.</p></div></div></main>;
  const items = await db.select().from(products).orderBy(desc(products.createdAt));
  return <OwnerDashboard initialItems={items} displayName={user.displayName} />;
}
