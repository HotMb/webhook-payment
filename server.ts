import express from "express";
import { verifyWebhookSignature } from "./signature";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) throw new Error("Set WEBHOOK_SECRET before starting webhook-payment.");

const app = express();

type WebhookEvent = {
    id: string;
    type: string;
    data: {
        orderId: string;
        amount: number;
        email: string;
    }
};

type QueueItem = {
    event: WebhookEvent;
    attempt: number;
};

type Status = "pending" | "processed" | "dead";

type TrackedEvent = WebhookEvent & {
    status: Status;
    attempts: number;
};

// Queue d’ingestion -> worker en arrière-plan
const queue: QueueItem[] = [];

// Idempotence + tracking
const eventsById = new Map<string, TrackedEvent>();
const deadLetterQueue: TrackedEvent[] = [];

app.use(express.json({
    verify: (req: any, _res, buf) => {
        req.rawBody = buf;
    }
}));

function verifyRequestSignature(req: any, res: any): boolean {
    const signature = req.header("x-webhook-signature");

    if (!signature) {
        res.status(401).send("Missing signature");
        return false;
    }

    if (!Buffer.isBuffer(req.rawBody)) {
        res.status(400).send("Missing raw body");
        return false;
    }

    if (!verifyWebhookSignature(signature, req.rawBody, WEBHOOK_SECRET)) {
        res.status(401).send("Invalid signature");
        return false;
    }

    return true;
}

async function processEvent(event: WebhookEvent): Promise<void> {
    // Test : force une erreur pour valider le retry
    if (event.type === "FAIL") {
        throw new Error(`Simulated processing error for event ${event.id}`);
    }

    // simulation d’un traitement long
    await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    console.log(`Processing event: ${event.id}`);
    console.log(`Finish Processing event: ${event.id}`);
}

app.post("/webhook/payment", async (req: any, res: any) => {
    const content = req.body as WebhookEvent;

    const ok = verifyRequestSignature(req, res);
    if (!ok) return;

    if (!content || !content.id) {
        return res.status(400).send("Bad Request: Missing ID");
    }

    // Anti-doublon (idempotence)
    const tracked = eventsById.get(content.id);
    if (tracked?.status === "processed" || tracked?.status === "dead") {
        return res.status(200).send("already processed");
    }

    // Ajout/initialisation du tracking si nécessaire
    if (!tracked) {
        eventsById.set(content.id, {
            ...content,
            status: "pending",
            attempts: 0
        });
    }

    // event -> ajouté à la queue
    queue.push({ event: content, attempt: 0 });

    res.status(200).send("ok");
});

// Worker : consomme la queue en arrière-plan
setInterval(async () => {
    if (queue.length === 0) return;

    const item = queue.shift()!;
    const tracked = eventsById.get(item.event.id);
    if (!tracked) return;

    try {
        await processEvent(item.event);

        tracked.status = "processed";
        eventsById.set(item.event.id, tracked);

    } catch (err) {
        console.log("Error processing event:", (err as Error).message);

        // retry max 3 tentatives
        tracked.attempts += 1;

        if (item.attempt < 2) {
            queue.push({ event: item.event, attempt: item.attempt + 1 });
        } else {
            tracked.status = "dead";
            deadLetterQueue.push(tracked);
            console.log(`Giving up after 3 attempts for event ${item.event.id}`);
        }

        eventsById.set(item.event.id, tracked);
    }
}, 1000);

app.get("/events", (_req: any, res: any) => {
    const events = Array.from(eventsById.values());
    res.json({
        processed: events.filter((event) => event.status === "processed").length,
        pending: events.filter((event) => event.status === "pending").length,
        deadLetter: deadLetterQueue.length
    });
});

app.listen(3009, () => {
    console.log("Server running on port 3009");
});

