import express from "express";
import crypto from "crypto";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
console.log("WEBHOOK_SECRET:", WEBHOOK_SECRET);

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
        req.rawBody = buf.toString();
    }
}));

function computeSignature(payload: string) {
    return crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
}

function verifySignature(req: any, res: any): boolean {
    const signature = req.header("x-webhook-signature");

    if (!signature) {
        console.log("Missing signature");
        res.status(401).send("Missing signature");
        return false;
    }

    const computedSignature = computeSignature(req.rawBody);

    if (signature !== computedSignature) {
        console.log("Invalid signature");
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

    const ok = verifySignature(req, res);
    if (!ok) return;

    console.log("Raw body:", req.rawBody);
    console.log("Parsed body:", req.body);

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
    console.log("Queued body webhook:", content);

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

app.get("/events", (req: any, res: any) => {
    res.json({
        processed: Array.from(eventsById.values()),
        dlq: deadLetterQueue
    });
});

app.listen(3009, () => {
    console.log("Server running on port 3009");
});

