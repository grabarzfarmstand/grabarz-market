import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";

export const dynamic = "force-dynamic";

// This backend engine triggers the secure Stripe credit card window for your neighbors
export async function POST(request: Request) {
  try {
    const { productId, quantityRequested } = await request.json() as { productId: string; quantityRequested: number };
    const db = getDb();

    // 1. Verify the product exists and check live inventory
    const product = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product.length) {
      return Response.json({ error: "This farmhouse item is no longer available." }, { status: 404 });
    }

    const item = product[0];
    if (item.quantity < quantityRequested || item.status !== "published") {
      return Response.json({ error: `Sorry, only ${item.quantity} available right now.` }, { status: 400 });
    }

    // 2. Safeguard: Ensure your private Stripe Secret Key is loaded in your Cloudflare dashboard
    if (!env.STRIPE_SECRET_KEY) {
      return Response.json({ error: "Store checkout integration is currently offline." }, { status: 500 });
    }

    // 3. Command Stripe to generate a secure hosted checkout portal session
    const stripeResponse = await fetch("https://stripe.com", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        "mode": "payment",
        "success_url": `${request.url.split("/api")[0]}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
        "cancel_url": `${request.url.split("/api")[0]}/?canceled=true`,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": item.name,
        "line_items[0][price_data][product_data][description]": item.description,
        "line_items[0][price_data][unit_amount]": String(item.priceCents),
        "line_items[0][quantity]": String(quantityRequested),
        // Securely pass metadata so we know which item to subtract from inventory upon successful payment
        "metadata[product_id]": item.id,
        "metadata[quantity_ordered]": String(quantityRequested)
      })
    });

    const session = await stripeResponse.json() as { url?: string; error?: { message: string } };

    if (!stripeResponse.ok || !session.url) {
      return Response.json({ error: session.error?.message ?? "Stripe initialization failed." }, { status: 400 });
    }

    // Return the secure window link to the customer's browser screen
    return Response.json({ url: session.url });

  } catch (error) {
    return Response.json({ error: "We could not open checkout. Please try again." }, { status: 500 });
  }
}
