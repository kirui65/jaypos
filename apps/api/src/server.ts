import "dotenv/config";
import { createApp } from "./app.js";
import { createPaymentPoller } from "./payments/routes.js";

const port = Number(process.env.API_PORT ?? 3001);
const app = createApp();
createPaymentPoller();

app.listen(port, () => {
  process.stdout.write(`Eminent Jay API listening on port ${port}\n`);
});
