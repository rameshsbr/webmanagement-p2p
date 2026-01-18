import { expireIdrV4Vas, reconcileFazzAccept, reconcileFazzSend } from "../services/providers/fazz-poller.js";

const task = process.argv[2];

async function run() {
  switch (task) {
    case "reconcile-fazz-accept":
      await reconcileFazzAccept();
      break;
    case "reconcile-fazz-send":
      await reconcileFazzSend();
      break;
    case "expire-v4-vas":
      await expireIdrV4Vas();
      break;
    default:
      console.error("Usage: tsx src/scripts/run-tasks.ts <reconcile-fazz-accept|reconcile-fazz-send|expire-v4-vas>");
      process.exit(1);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
