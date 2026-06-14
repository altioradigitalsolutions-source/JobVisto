require("dotenv").config();
const { spawn } = require("child_process");
const path = require("path");

const apiKey = process.env.STRIPE_SECRET_KEY;
const shimPath = path.join(__dirname, "../node_modules/@stripe/cli/bin/shim.js");

if (!apiKey || apiKey === "STRIPE_SECRET_KEY_HERE" || apiKey === "pk_live_o_pk_test" || apiKey.includes("your_")) {
  console.error("\n❌ ERROR: Debes configurar tu STRIPE_SECRET_KEY real (de pruebas, ej: sk_test_...) en tu archivo .env antes de correr este comando.\n");
  process.exit(1);
}

console.log("🚀 Iniciando Stripe CLI usando la clave API de tu archivo .env...\n");

const args = [
  "listen",
  "--forward-to",
  "localhost:4177/api/stripe/webhook",
  "--api-key",
  apiKey
];

const cli = spawn("node", [shimPath, ...args], { stdio: "inherit", shell: true });

cli.on("close", (code) => {
  process.exit(code);
});
