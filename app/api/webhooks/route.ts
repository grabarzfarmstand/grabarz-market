import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";

export const dynamic = "force-dynamic";

// This background listener automatically updates your store quantities the exact second a payment clears
export async function POST(request: Request) {
  try {
    const payload = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
      return Response.json({ error: "Webhook system initialization failed." }, { status: 500 });
    }

    // Command Stripe to securely verify this message came from them and wasn't faked by a bot
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const [timestampPart, sigPart] = signature.split(",");
    const t = timestampPart.split("=")[1];
    const v1 = sigPart.split("=")[1];
    const signedPayload = `${t}.${payload}`;

    const isValid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      new Uint8Array(v1.match(/.{1,2}/g)!.map(byte => parseInt(blob, 16))),
      new TextEncoder().encode(signedPayload)
    );

    if (!isValid) {
      return Response.json({ error: "Invalid cryptograph signature." }, { status: 400 });
    }

    const event = JSON.parse(payload) as { type: string; data: { object: { metadata: { product_id?: string; quantity_ordered?: string } } } };

    // Upon a confirmed, successful payment, instantly reduce inventory counts automatically
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const productId = session.metadata.product_id;
      const quantityOrdered = parseInt(session.metadata.quantity_ordered ?? "0");

      if (productId && quantityOrdered > 0) {
        await getDb()
          .update(products)
          .set({
            quantity: sql`${products.quantity} - ${quantityOrdered}`,
            updatedAt: Date.now()
          })
          .where(eq(products.id, productId));
      }
    }

    return Response.json({ received: true });

  } catch (error) {
    return Response.json({ error: "Internal automation webhook loop failure." }, { status: 500 });
  }
}
