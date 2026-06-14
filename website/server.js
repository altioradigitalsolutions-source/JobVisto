require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");

const port = Number(process.env.PORT || 4177);
const root = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png"
};

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

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";

    // Handle Stripe webhook POST requests
    if (req.method === "POST" && urlPath === "/api/stripe/webhook") {
      let body = [];
      req.on("data", (chunk) => {
        body.push(chunk);
      });
      req.on("end", async () => {
        body = Buffer.concat(body);

        let event;
        const signature = req.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const allowUnsignedWebhook = process.env.ALLOW_UNSIGNED_STRIPE_WEBHOOKS === "true";
        const stripeInstance = process.env.STRIPE_SECRET_KEY ? new (require("stripe"))(process.env.STRIPE_SECRET_KEY) : null;

        try {
          if (!webhookSecret || !signature) {
            if (!allowUnsignedWebhook) {
              console.error("Stripe webhook signature verification is not configured.");
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Stripe webhook signature verification is not configured." }));
              return;
            }

            event = JSON.parse(body.toString());
            console.warn("WARNING: Webhook signature verification skipped by ALLOW_UNSIGNED_STRIPE_WEBHOOKS.");
          } else {
            if (!stripeInstance) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Stripe secret key is not configured." }));
              return;
            }
            event = stripeInstance.webhooks.constructEvent(body, signature, webhookSecret);
          }
        } catch (err) {
          console.error("Webhook signature verification failed:", err.message);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }

        console.log("Stripe Webhook received event:", event.type);

        if (event.type === "checkout.session.completed" || event.type === "invoice.paid" || event.type === "customer.subscription.updated") {
          const { email, planId, customerId, subscriptionId, sessionId, paymentStatus, billingCycle } = await paymentRecordFromStripeEvent(stripeInstance, event);

          if (!email) {
            console.error("Stripe payment event is missing customer email.");
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Stripe payment event is missing customer email." }));
            return;
          }

          if (!isActivatingPaymentStatus(paymentStatus)) {
            console.log(`Ignoring Stripe event with non-activating status: ${paymentStatus}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ received: true, ignored: true }));
            return;
          }

          console.log(`Saving Stripe payment for ${email}: plan=${planId}, customer=${customerId}`);
          const supabaseUrl = process.env.SUPABASE_URL;
          const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

          if (!supabaseUrl || !serviceRoleKey) {
            console.error("Supabase environment variables are missing. Cannot save payment.");
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Supabase environment variables are missing." }));
            return;
          }

          const url = new URL(`${supabaseUrl}/rest/v1/stripe_payments`);
          url.searchParams.set("on_conflict", "session_id");
          const payload = JSON.stringify({
            email: email.toLowerCase(),
            plan_id: planId,
            customer_id: customerId,
            subscription_id: subscriptionId,
            session_id: sessionId,
            payment_status: paymentStatus,
            billing_cycle: billingCycle
          });

          const options = {
            method: "POST",
            headers: {
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates"
            }
          };

          const dbReq = https.request(url, options, (dbRes) => {
            let dbData = "";
            dbRes.on("data", (chunk) => dbData += chunk);
            dbRes.on("end", () => {
              console.log("Supabase insert status:", dbRes.statusCode);
              if (dbRes.statusCode >= 300) {
                console.error("Failed to insert payment to Supabase:", dbData);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Failed to save Stripe payment." }));
                return;
              }

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ received: true }));
            });
          });

          dbReq.on("error", (e) => {
            console.error("Error saving payment to Supabase:", e);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Error saving Stripe payment." }));
          });

          dbReq.write(payload);
          dbReq.end();
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
      return;
    }

    // Serve static files
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "text/plain" });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`JobVisto preview running at http://127.0.0.1:${port}`);
  });
