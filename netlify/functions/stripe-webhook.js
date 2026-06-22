function env(name) {
  return process.env[name] || globalThis.Netlify?.env?.get?.(name);
}

function normalizePlanId(value) {
  const plan = String(value || "").toLowerCase();
  if (plan === "independent") return "solo";
  if (plan === "company") return "starter";
  if (["solo", "starter", "pro"].includes(plan)) return plan;
  return "";
}

function inferPlanFromAmount(amount = 0) {
  const amountInDollars = Number(amount || 0) / 100;
  if (amountInDollars <= 0) return "solo";
  if (amountInDollars < 15) return "solo";
  if (amountInDollars < 50) return "starter";
  return "pro";
}

function isActivatingPaymentStatus(status) {
  return ["paid", "complete", "active", "trialing"].includes(String(status || "").toLowerCase());
}

function normalizeBillingCycle(value) {
  const billing = String(value || "").toLowerCase();
  if (["year", "annual", "yearly"].includes(billing)) return "annual";
  return "monthly";
}

async function paymentRecordFromStripeEvent(stripe, stripeEvent) {
  const object = stripeEvent.data.object;
  let email = object.customer_details?.email || object.customer_email || object.email || "";
  let customerId = object.customer || object.id;
  let subscriptionId = object.subscription || (object.object === "subscription" ? object.id : "");
  let paymentStatus = object.payment_status || object.status;
  let planId = normalizePlanId(object.metadata?.plan || object.metadata?.plan_id);
  let billingCycle = normalizeBillingCycle(
    object.metadata?.billing ||
    object.metadata?.billing_cycle ||
    object.lines?.data?.[0]?.price?.recurring?.interval
  );

  if ((!email || !planId) && subscriptionId && stripe) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      planId = planId || normalizePlanId(subscription.metadata?.plan || subscription.metadata?.plan_id);
      billingCycle = normalizeBillingCycle(
        subscription.metadata?.billing ||
        subscription.metadata?.billing_cycle ||
        subscription.items?.data?.[0]?.price?.recurring?.interval ||
        billingCycle
      );
      customerId = customerId || subscription.customer;
    } catch (err) {
      console.warn("Could not enrich Stripe subscription:", err.message);
    }
  }

  if (!email && customerId && stripe) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      email = customer.email || "";
    } catch (err) {
      console.warn("Could not enrich Stripe customer:", err.message);
    }
  }

  if (!planId) {
    planId = inferPlanFromAmount(object.amount_total || object.amount_paid || object.total || 0);
  }

  return {
    email,
    planId,
    customerId,
    subscriptionId,
    sessionId: object.id,
    paymentStatus,
    billingCycle
  };
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const sig = event.headers["stripe-signature"];
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  const stripeSecretKey = env("STRIPE_SECRET_KEY");
  const allowUnsignedWebhook = env("ALLOW_UNSIGNED_STRIPE_WEBHOOKS") === "true";
  const stripe = stripeSecretKey ? require("stripe")(stripeSecretKey) : null;
  let stripeEvent;

  try {
    if (!webhookSecret || !sig) {
      if (!allowUnsignedWebhook) {
        console.error("Stripe webhook signature verification is not configured.");
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Stripe webhook signature verification is not configured." })
        };
      }

      stripeEvent = JSON.parse(event.body);
      console.warn("WARNING: Webhook signature verification skipped by ALLOW_UNSIGNED_STRIPE_WEBHOOKS.");
    } else {
      if (!stripe) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Stripe secret key is not configured." })
        };
      }
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
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
    const { email, planId, customerId, subscriptionId, sessionId, paymentStatus, billingCycle } = await paymentRecordFromStripeEvent(stripe, stripeEvent);

    if (!email) {
      console.error("Stripe payment event is missing customer email.");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Stripe payment event is missing customer email." })
      };
    }

    if (!isActivatingPaymentStatus(paymentStatus)) {
      console.log(`Ignoring Stripe event with non-activating status: ${paymentStatus}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, ignored: true })
      };
    }

    console.log(`Saving Stripe payment for ${email}: plan=${planId}, customer=${customerId}`);
    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase environment variables are missing.");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Supabase environment variables are missing." })
      };
    }

    try {
      const url = new URL(`${supabaseUrl}/rest/v1/stripe_payments`);
      url.searchParams.set("on_conflict", "session_id");

      const response = await fetch(url, {
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
          payment_status: paymentStatus,
          billing_cycle: billingCycle
        })
      });

      console.log("Supabase insert status:", response.status);
      if (response.status >= 300) {
        const errText = await response.text();
        console.error("Failed to insert payment to Supabase:", errText);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Failed to save Stripe payment." })
        };
      }
    } catch (e) {
      console.error("Error saving payment to Supabase:", e);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Error saving Stripe payment." })
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
