import { Request, Response, NextFunction } from "express"
import { tracer, addAttributesToCurrentSpan, wrapAsyncFunctionsToRunInSpan } from "@services/tracing"
import { baseLogger } from "@services/logger";

export const logRequest = (req: Request, resp: Response, next: NextFunction) => {
    delete req.body.webhookSecret
    baseLogger.info(req.body, "IbexWebhook") // Todo: move this to Honeycomb
    next();
};

