import { Router, type IRouter } from "express";
import {
  DisconnectWhatsAppResponse,
  GetConnectionStatusResponse,
  RequestPairingCodeBody,
  RequestPairingCodeResponse,
  RequestWhatsAppQrCodeResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  disconnectWhatsApp,
  getWhatsAppStatus,
  requestWhatsAppPairingCode,
  requestWhatsAppQrCode,
  WhatsAppConnectionError,
} from "../lib/whatsapp";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/connection/status", async (_req, res): Promise<void> => {
  const status = await getWhatsAppStatus(res.locals.userId as string);
  res.json(GetConnectionStatusResponse.parse(status));
});

router.post("/connection/pairing-code", async (req, res): Promise<void> => {
  const parsed = RequestPairingCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const pairing = await requestWhatsAppPairingCode(
      res.locals.userId as string,
      parsed.data.phone,
    );
    res.json(RequestPairingCodeResponse.parse({
      status: "awaiting_link",
      ...pairing,
    }));
  } catch (error) {
    if (error instanceof WhatsAppConnectionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/connection/qr", async (_req, res): Promise<void> => {
  try {
    const qr = await requestWhatsAppQrCode(res.locals.userId as string);
    res.json(RequestWhatsAppQrCodeResponse.parse(qr));
  } catch (error) {
    if (error instanceof WhatsAppConnectionError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post("/connection/disconnect", async (_req, res): Promise<void> => {
  const userId = res.locals.userId as string;
  await disconnectWhatsApp(userId);
  const status = await getWhatsAppStatus(userId);
  res.json(DisconnectWhatsAppResponse.parse(status));
});

export default router;
