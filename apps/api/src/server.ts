import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.API_PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  process.stdout.write(`Eminent Jay API listening on port ${port}\n`);
});
