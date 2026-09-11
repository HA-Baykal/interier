import { db, mutate, uid, now } from "./db";
import type { DbShape, Package, Payment, User } from "./types";
import { RequestError } from "./errors";
import { cleanConnectionValue } from "./env";

export type YooKassaConfig = {
  enabled: boolean;
  shopId: string;
  secretKey: string;
  testMode: boolean;
  isConfigured: boolean;
};

export async function getYooKassaConfig(): Promise<YooKassaConfig> {
  const d = await db();
  const get = (k: string, envK: string, def = "") => {
    const s = d.settings.find((x) => x.key === k)?.value;
    const envVal = cleanConnectionValue(process.env[envK]);
    return s || envVal || def;
  };

  const enabled = get("yookassa_enabled", "YOOKASSA_ENABLED", "1") !== "0";
  const shopId = get("yookassa_shop_id", "YOOKASSA_SHOP_ID", "");
  const secretKey = get("yookassa_secret_key", "YOOKASSA_SECRET_KEY", "");
  const testMode = get("yookassa_test_mode", "YOOKASSA_TEST_MODE", "0") === "1" || !shopId || !secretKey;

  return {
    enabled,
    shopId,
    secretKey,
    testMode,
    isConfigured: !!(shopId && secretKey),
  };
}

export type CreatePaymentResult = {
  ok: boolean;
  paymentId: string;
  confirmationUrl: string | null;
  isTest: boolean;
  creditsAdded?: number;
};

export async function createPaymentOrder(
  user: User,
  pkg: Package,
  baseUrl: string
): Promise<CreatePaymentResult> {
  const config = await getYooKassaConfig();
  if (!config.enabled) {
    throw new RequestError("payments_disabled", "Приём платежей временно отключён администратором.", 503);
  }

  const paymentId = uid("pay");
  const returnUrl = `${baseUrl.replace(/\/+$/, "")}/account?payment=success&id=${paymentId}`;

  // If YooKassa credentials are provided and testMode is false, call YooKassa v3 API
  if (config.isConfigured && !config.testMode) {
    const authHeader = "Basic " + Buffer.from(`${config.shopId}:${config.secretKey}`).toString("base64");
    const idempotenceKey = uid("idemp");

    const payload = {
      amount: {
        value: Number(pkg.price).toFixed(2),
        currency: "RUB",
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: returnUrl,
      },
      description: `Оплата тарифа «${pkg.name.ru || pkg.name.en}» (${pkg.credits} генераций)`,
      metadata: {
        paymentId,
        userId: user.id,
        packageId: pkg.id,
      },
    };

    const res = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "Idempotence-Key": idempotenceKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[YooKassa API Error]", res.status, errBody);
      throw new RequestError("yookassa_error", `Ошибка платёжного шлюза ЮKassa: ${res.statusText}`, 502);
    }

    const data = await res.json();
    const providerPaymentId = data.id || null;
    const confirmationUrl = data.confirmation?.confirmation_url || null;

    if (!confirmationUrl) {
      throw new RequestError("yookassa_no_url", "ЮKassa не вернула ссылку на оплату.", 502);
    }

    await mutate((draft: DbShape) => {
      draft.payments = draft.payments || [];
      draft.payments.push({
        id: paymentId,
        userId: user.id,
        packageId: pkg.id,
        amount: pkg.price,
        credits: pkg.credits,
        provider: "yookassa",
        providerPaymentId,
        status: "pending",
        confirmationUrl,
        createdAt: now(),
        updatedAt: now(),
      });
    });

    return {
      ok: true,
      paymentId,
      confirmationUrl,
      isTest: false,
    };
  }

  // Otherwise, run in Test Mode: immediately credit user's account for testing
  await mutate((draft: DbShape) => {
    draft.payments = draft.payments || [];
    draft.payments.push({
      id: paymentId,
      userId: user.id,
      packageId: pkg.id,
      amount: pkg.price,
      credits: pkg.credits,
      provider: "test",
      providerPaymentId: `test_${paymentId}`,
      status: "succeeded",
      confirmationUrl: null,
      createdAt: now(),
      updatedAt: now(),
    });

    const targetUser = draft.users.find((u) => u.id === user.id);
    if (targetUser) {
      targetUser.credits += pkg.credits;
    }
  });

  return {
    ok: true,
    paymentId,
    confirmationUrl: null,
    isTest: true,
    creditsAdded: pkg.credits,
  };
}

export async function verifyAndSettlePayment(
  paymentId: string,
  userId: string
): Promise<{
  ok: boolean;
  status: string;
  creditsAdded: number;
  newCredits: number;
}> {
  const config = await getYooKassaConfig();
  const d = await db();
  const payment = (d.payments || []).find(
    (p) => (p.id === paymentId || p.providerPaymentId === paymentId) && p.userId === userId
  );
  if (!payment) {
    const user = d.users.find((u) => u.id === userId);
    return { ok: false, status: "not_found", creditsAdded: 0, newCredits: user?.credits ?? 0 };
  }

  if (payment.status === "succeeded") {
    const user = d.users.find((u) => u.id === userId);
    return { ok: true, status: "succeeded", creditsAdded: payment.credits, newCredits: user?.credits ?? 0 };
  }

  // If provider is yookassa and we have shopId/secretKey and providerPaymentId, query YooKassa API:
  if (payment.provider === "yookassa" && payment.providerPaymentId && config.shopId && config.secretKey) {
    try {
      const authHeader = "Basic " + Buffer.from(`${config.shopId}:${config.secretKey}`).toString("base64");
      const res = await fetch(`https://api.yookassa.ru/v3/payments/${payment.providerPaymentId}`, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === "succeeded") {
          const outcome = await mutate((draft: DbShape) => {
            const p = draft.payments.find((x) => x.id === payment.id);
            if (p && p.status !== "succeeded") {
              p.status = "succeeded";
              p.updatedAt = now();
              const u = draft.users.find((x) => x.id === userId);
              if (u) {
                u.credits += p.credits;
                return { creditsAdded: p.credits, newCredits: u.credits };
              }
            }
            const u = draft.users.find((x) => x.id === userId);
            return { creditsAdded: 0, newCredits: u?.credits ?? 0 };
          });
          return { ok: true, status: "succeeded", ...outcome };
        } else if (data.status === "canceled") {
          await mutate((draft: DbShape) => {
            const p = draft.payments.find((x) => x.id === payment.id);
            if (p) {
              p.status = "canceled";
              p.updatedAt = now();
            }
          });
          const user = (await db()).users.find((u) => u.id === userId);
          return { ok: false, status: "canceled", creditsAdded: 0, newCredits: user?.credits ?? 0 };
        }
      }
    } catch (err) {
      console.error("[YooKassa verify error]", err);
    }
  }

  const user = (await db()).users.find((u) => u.id === userId);
  return { ok: false, status: payment.status, creditsAdded: 0, newCredits: user?.credits ?? 0 };
}

export async function syncPendingPayments(userId: string): Promise<number> {
  const d = await db();
  const pending = (d.payments || []).filter(
    (p) => p.userId === userId && p.status === "pending" && p.provider === "yookassa"
  );
  let totalAdded = 0;
  for (const p of pending) {
    const res = await verifyAndSettlePayment(p.id, userId);
    if (res.ok && res.creditsAdded > 0) {
      totalAdded += res.creditsAdded;
    }
  }
  return totalAdded;
}

export async function handleYooKassaWebhookEvent(eventPayload: any): Promise<{ ok: boolean; message: string }> {
  if (!eventPayload || typeof eventPayload !== "object") {
    throw new RequestError("bad_webhook", "Некорректный payload вебхука", 400);
  }

  const eventType = eventPayload.event;
  const paymentObj = eventPayload.object;

  if (eventType !== "payment.succeeded" || !paymentObj) {
    return { ok: true, message: "Ignored non-success event" };
  }

  const paymentId = paymentObj.metadata?.paymentId;
  const providerPaymentId = paymentObj.id;

  const result = await mutate((draft: DbShape) => {
    draft.payments = draft.payments || [];
    let payment = draft.payments.find(
      (p) => (paymentId && p.id === paymentId) || (providerPaymentId && p.providerPaymentId === providerPaymentId)
    );

    if (!payment) {
      // Create record if not found
      const userId = paymentObj.metadata?.userId;
      const packageId = paymentObj.metadata?.packageId;
      const amount = Number(paymentObj.amount?.value) || 0;
      const targetPkg = draft.packages.find((p) => p.id === packageId);
      const credits = targetPkg?.credits || 0;

      if (!userId || !credits) {
        return { ok: false, error: "Payment metadata missing userId or package" };
      }

      payment = {
        id: paymentId || uid("pay"),
        userId,
        packageId: packageId || "",
        amount,
        credits,
        provider: "yookassa",
        providerPaymentId,
        status: "succeeded",
        createdAt: now(),
        updatedAt: now(),
      };
      draft.payments.push(payment);

      const user = draft.users.find((u) => u.id === userId);
      if (user) {
        user.credits += credits;
      }
      return { ok: true, userCredited: true, credits };
    }

    if (payment.status === "succeeded") {
      return { ok: true, already: true };
    }

    payment.status = "succeeded";
    payment.updatedAt = now();

    const user = draft.users.find((u) => u.id === payment!.userId);
    if (user) {
      user.credits += payment.credits;
    }
    return { ok: true, userCredited: true, credits: payment.credits };
  });

  return { ok: true, message: "Payment processed successfully" };
}
