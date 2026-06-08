const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const sig = event.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  try {
    if (webhookSecret && sig) {
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
    } else {
      // Direct parse if webhook secret is not configured (for initial testing/dev)
      stripeEvent = JSON.parse(event.body);
      console.warn("WARNING: Webhook signature verification skipped. Configure STRIPE_WEBHOOK_SECRET in Netlify.");
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook Error: ${err.message}` })
    };
  }

  console.log("Stripe Webhook received event:", stripeEvent.type);

  if (
    stripeEvent.type === "checkout.session.completed" ||
    stripeEvent.type === "invoice.paid" ||
    stripeEvent.type === "customer.subscription.updated"
  ) {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email || session.customer_email || session.email;
    const customerId = session.customer;
    const subscriptionId = session.subscription;
    const sessionId = session.id;
    const paymentStatus = session.payment_status || session.status;

    // Determine plan
    let planId = session.metadata?.plan || session.metadata?.plan_id;
    if (!planId) {
      const amountTotal = session.amount_total || session.amount_paid || 0;
      const amountInDollars = amountTotal / 100;
      if (amountInDollars > 0) {
        if (amountInDollars < 15) planId = "solo";
        else if (amountInDollars < 50) planId = "starter";
        else planId = "pro";
      } else {
        planId = "solo";
      }
    }

    if (email) {
      console.log(`Saving Stripe payment for ${email}: plan=${planId}, customer=${customerId}`);
      const supabaseUrl = process.env.SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (supabaseUrl && serviceRoleKey) {
        try {
          const response = await fetch(`${supabaseUrl}/rest/v1/stripe_payments`, {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates"
            },
            body: JSON.stringify({
              email: email.toLowerCase(),
              plan_id: planId,
              customer_id: customerId,
              subscription_id: subscriptionId,
              session_id: sessionId,
              payment_status: paymentStatus
            })
          });

          console.log("Supabase insert status:", response.status);
          if (response.status >= 300) {
            const errText = await response.text();
            console.error("Failed to insert payment to Supabase:", errText);
          }
        } catch (e) {
          console.error("Error saving payment to Supabase:", e);
        }
      } else {
        console.error("Supabase environment variables are missing.");
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
