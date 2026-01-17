// apps/server/src/routes/webhooks/didit.ts
// Re-export the Didit webhook handler for route-level wiring.
import { handleDiditWebhook } from "../../services/didit.js";

export { handleDiditWebhook };
export default handleDiditWebhook;
