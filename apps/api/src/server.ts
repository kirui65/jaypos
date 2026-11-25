import "dotenv/config";
import { createApp } from "./app.js";
import { createPaymentPoller } from "./payments/routes.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
const app = createApp();
createPaymentPoller();

app.listen(port, "0.0.0.0", () => {
  process.stdout.write(`Retail POS API listening on port ${port}\n`);
});
