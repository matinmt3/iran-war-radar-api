import { app } from "./app.js";
import { config } from "./config.js";

const server = app.listen(config.port, config.host, () => {
  console.log(`Iran War Radar API listening on http://${config.host}:${config.port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
