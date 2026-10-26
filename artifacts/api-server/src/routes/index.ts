import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import connectionRouter from "./connection";
import contactsRouter from "./contacts";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import messagesRouter from "./messages";
import profileRouter from "./profile";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adminRouter);
router.use(profileRouter);
router.use(dashboardRouter);
router.use(contactsRouter);
router.use(connectionRouter);
router.use(messagesRouter);

export default router;
