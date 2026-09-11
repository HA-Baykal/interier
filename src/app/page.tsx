import Link from "next/link";
import Image from "next/image";
import { getLocale } from "@/lib/locale";
import { t } from "@/lib/i18n";
import { activeStyles, activePackages } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";
import PricingSection from "@/components/PricingSection";
import { ClientPackage } from "@/components/types";

export default async function HomePage() {
  const locale = getLocale();
  const styles = await activeStyles();
  const packages = await activePackages();
  const user = await getSessionUser();
  const studioHref = user ? "/studio" : "/register";

  const clientPackages: ClientPackage[] = packages.map((p) => ({
    id: p.id,
    slug: p.slug,
    nameRu: p.name.ru,
    nameEn: p.name.en,
    descRu: p.description.ru,
    descEn: p.description.en,
    credits: p.credits,
    price: p.price,
    badgeRu: p.badge?.ru || "",
    badgeEn: p.badge?.en || "",
    active: p.active,
  }));

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <span className="hero-badge">
            <span className="dot" />
            {t(locale, "free_gen")}
          </span>
          <h1>{t(locale, "hero_title")}</h1>
          <p>{t(locale, "hero_subtitle")}</p>
          <div className="hero-actions">
            <Link href={studioHref} className="btn btn-primary">
              {t(locale, "cta_start")} →
            </Link>
            <Link href="/#how" className="btn btn-ghost">
              {t(locale, "cta_demo")}
            </Link>
          </div>

          <div className="hero-demo reveal">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, maxWidth: 900, margin: "0 auto" }}>
              {styles.slice(0, 3).map((s, i) => (
                <div
                  key={s.id}
                  className={"gen-result" + (i === 1 ? " featured" : "")}
                >
                  <Image
                    src={s.preview}
                    alt={s.name[locale]}
                    width={400}
                    height={260}
                    style={{ width: "100%", height: "auto", display: "block" }}
                  />
                  <span className="demo-badge">{s.name[locale].toUpperCase()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Styles */}
      <section className="section" id="styles">
        <div className="container">
          <h2 className="section-title">{t(locale, "styles_title")}</h2>
          <p className="section-sub">{t(locale, "styles_subtitle")}</p>
          <div className="styles-grid">
            {styles.map((s) => (
              <Link href={`/studio?style=${s.slug}`} key={s.id} className="style-card">
                <div className="thumb">
                  <Image
                    src={s.preview}
                    alt={s.name[locale]}
                    fill
                    sizes="(max-width: 768px) 50vw, 260px"
                    style={{ objectFit: "cover" }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      bottom: 12,
                      background: "rgba(11,13,18,0.72)",
                      color: "#fff",
                      borderRadius: 999,
                      padding: "4px 11px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {s.name[locale].toUpperCase()}
                  </span>
                </div>
                <div className="body">
                  <h3>{s.name[locale]}</h3>
                  <p>{s.description[locale]}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section" id="how">
        <div className="container">
          <h2 className="section-title">{t(locale, "how_title")}</h2>
          <div className="how-grid" style={{ marginTop: 34 }}>
            {[1, 2, 3].map((n) => (
              <div className="how-card" key={n}>
                <div className="how-num">{n}</div>
                <h3>{t(locale, `how_${n}`)}</h3>
                <p>{t(locale, `how_${n}d`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing with interactive Buy buttons */}
      <PricingSection
        packages={clientPackages}
        locale={locale}
        isLoggedIn={!!user}
      />

      {/* Final CTA */}
      <section className="section" id="cta">
        <div className="container">
          <div className="cta-band">
            <h2>{t(locale, "hero_title")}</h2>
            <p>{t(locale, "hero_subtitle")}</p>
            <div className="hero-actions">
              <Link href={studioHref} className="btn btn-primary">
                {t(locale, "cta_start")} →
              </Link>
              <Link href="/#how" className="btn btn-ghost">
                {t(locale, "cta_demo")}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
