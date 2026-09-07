import { getSetting } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Public offer / requisites page.
 *
 * Payment providers (ЮKassa and alike) refuse to connect a site that has no
 * user agreement, requisites (full name + INN) and an explanation of how the
 * buyer receives a digital purchase. This page provides all three; the values
 * come from the admin panel so the owner edits them without code.
 */
export default async function OfferPage() {
  const [name, innSetting, email, phone] = await Promise.all([
    getSetting("legal_name"),
    getSetting("legal_inn"),
    getSetting("legal_email"),
    getSetting("legal_phone"),
  ]);
  // The owner asked to publish the INN without the full personal name.
  const inn = innSetting || "381113216450";

  const h = "2.5rem";
  return (
    <div className="container" style={{ paddingTop: 44, paddingBottom: 70, maxWidth: 860 }}>
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>Публичная оферта и реквизиты</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Сервис «Interier» — генерация дизайн-проекта интерьера по фотографии и подбор
        товаров с ценами и ссылками на магазины.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: h }}>1. Исполнитель и реквизиты</h2>
      <p style={{ lineHeight: 1.7 }}>
        {name ? <>Услугу оказывает: <b>{name}</b>.</> : <>Услугу оказывает самозанятый.</>}{" "}
        ИНН: <b>{inn}</b>.
        {phone && <> Телефон: {phone}.</>}
        {email && <> Электронная почта: {email}.</>}
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: h }}>2. Предмет оферты</h2>
      <p style={{ lineHeight: 1.7 }}>
        Исполнитель предоставляет доступ к сервису генерации дизайн-проектов интерьера
        и подбору товаров. Оплата тарифа зачисляет на учётную запись покупателя
        соответствующее количество генераций. Цены указаны в рублях и публикуются на
        странице «Тарифы».
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: h }}>3. Как получить заказ</h2>
      <p style={{ lineHeight: 1.7 }}>
        Услуга цифровая и оказывается онлайн: после оплаты генерации зачисляются на
        аккаунт автоматически, результат (изображения и список товаров) доступен в
        личном кабинете, в Telegram-боте или в мини-приложении. Доставка физического
        товара не требуется.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: h }}>4. Порядок оплаты и возвраты</h2>
      <p style={{ lineHeight: 1.7 }}>
        Оплата производится онлайн через платёжного провайдера. Если услуга не была
        оказана по технической причине, неиспользованные генерации восстанавливаются;
        для возврата средств напишите на {email || "почту исполнителя"} с указанием
        платежа.
      </p>

      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: h }}>5. Персональные данные</h2>
      <p style={{ lineHeight: 1.7 }}>
        Регистрируясь, вы соглашаетесь на обработку e-mail и имени для предоставления
        услуги. Данные не передаются третьим лицам, кроме платёжного провайдера
        (только для проведения оплаты).
      </p>
    </div>
  );
}
