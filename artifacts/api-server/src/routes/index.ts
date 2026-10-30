import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import adminContactsRouter from "./admin-contacts";
import adminMessagesRouter from "./admin-messages";
import adminWalletRouter from "./admin-wallet";
import authRouter from "./auth";
import connectionRouter from "./connection";
import contactsRouter from "./contacts";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import messagesRouter from "./messages";
import notificationsRouter from "./notifications";
import profileRouter from "./profile";
import walletRouter from "./wallet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(adminContactsRouter);
router.use(adminMessagesRouter);
router.use(adminWalletRouter);
router.use(profileRouter);
router.use(walletRouter);
router.use(dashboardRouter);
router.use(contactsRouter);
router.use(connectionRouter);
router.use(messagesRouter);
router.use(notificationsRouter);

export default router;
