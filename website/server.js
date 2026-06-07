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
      req.on("end", () => {
        body = Buffer.concat(body);

        let event;
        const signature = req.headers["stripe-signature"];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        try {
          if (webhookSecret && signature) {
            const stripeInstance = new (require("stripe"))(process.env.STRIPE_SECRET_KEY);
            event = stripeInstance.webhooks.constructEvent(body, signature, webhookSecret);
          } else {
            // Dev mode fallback
            event = JSON.parse(body.toString());
            console.warn("WARNING: Webhook signature verification skipped. Configure STRIPE_WEBHOOK_SECRET in .env.");
          }
        } catch (err) {
          console.error("Webhook signature verification failed:", err.message);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }

        console.log("Stripe Webhook received event:", event.type);

        if (event.type === "checkout.session.completed" || event.type === "invoice.paid" || event.type === "customer.subscription.updated") {
          const session = event.data.object;
          const email = session.customer_details?.email || session.customer_email || session.email;
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const sessionId = session.id;
          const paymentStatus = session.payment_status || session.status;
          
          // Determine the plan (solo, starter, pro)
          let planId = session.metadata?.plan || session.metadata?.plan_id;
          if (!planId) {
            const amountTotal = session.amount_total || session.amount_paid || 0;
            const amountInDollars = amountTotal / 100;
            if (amountInDollars > 0) {
              if (amountInDollars < 15) planId = "solo";
              else if (amountInDollars < 50) planId = "starter";
              else planId = "pro";
            } else {
              planId = "solo"; // default fallback
            }
          }

          if (email) {
            console.log(`Saving Stripe payment for ${email}: plan=${planId}, customer=${customerId}`);
            const supabaseUrl = process.env.SUPABASE_URL;
            const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

            if (supabaseUrl && serviceRoleKey) {
              const url = new URL(`${supabaseUrl}/rest/v1/stripe_payments`);
              const payload = JSON.stringify({
                email: email.toLowerCase(),
                plan_id: planId,
                customer_id: customerId,
                subscription_id: subscriptionId,
                session_id: sessionId,
                payment_status: paymentStatus
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
                  }
                });
              });

              dbReq.on("error", (e) => {
                console.error("Error saving payment to Supabase:", e);
              });

              dbReq.write(payload);
              dbReq.end();
            } else {
              console.error("Supabase environment variables are missing. Cannot save payment.");
            }
          }
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
